import { ClampToEdgeWrapping, DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, TextureLoader, UnsignedByteType } from 'three/webgpu';
import type { Weather } from '../env/weather';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import type { SlidingRate } from '../perf/slidingRate';
import type { SoilSurfaceTextures } from '../render/soilSurface';
import { buildSoilMap, type SoilMap, SOIL_CELLS, SOIL_DIM, SoilWaterGrid } from '../world/soilWater';
import { HEIGHT_DIM, materialDim, type TerrainTextureData } from '../world/terrainTextures';
import type { SoilCommand } from './soilWorker';

export type SoilPreview = 'dry' | 'rain' | 'drained';
const PRECIPITATION_MM_H: Record<Weather, number> = { clear: 0, cloudy: 0, rain: 5, storm: 30 };
const EVAPORATION_MM_H: Record<Weather, number> = { clear: 0.45, cloudy: 0.19, rain: 0.06, storm: 0.04 };

const assets = import.meta.glob<string>('../../assets/soil/*.{bin,png}', { query: '?url', import: 'default', eager: true });

function asset(name: string): string {
  const url = assets[`../../assets/soil/${name}`];
  if (!url) throw new Error(`Missing soil asset: ${name}`);
  return url;
}

export async function loadSoilAssets() {
  const loader = new TextureLoader();
  const [albedo, relief, map] = await Promise.all([
    loader.loadAsync(asset('soil-albedo-roughness.png')),
    loader.loadAsync(asset('soil-normal-height.png')),
    fetch(asset('hellesylt-parent.bin')),
  ]);
  if (!map.ok) throw new Error(`Soil parent materials: HTTP ${map.status}`);
  const parent = new Uint8Array(await map.arrayBuffer());
  if (parent.length !== SOIL_CELLS) throw new Error('Wrong soil parent material grid size');
  for (const tex of [albedo, relief]) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.anisotropy = 4;
  }
  albedo.colorSpace = SRGBColorSpace;
  albedo.needsUpdate = true;
  return { albedo, relief, parent };
}

function sampleSoilMap(parent: Uint8Array, terrain: TerrainTextureData): SoilMap {
  const profiles = new Uint8Array(SOIL_CELLS);
  const height = new Float32Array(SOIL_CELLS);
  const dim = materialDim(terrain.materialStep);
  for (let z = 0; z < SOIL_DIM; z++) {
    for (let x = 0; x < SOIL_DIM; x++) {
      const ix = x * 8 + 4;
      const iz = z * 8 + 4;
      const i = z * SOIL_DIM + x;
      const h = terrain.height[iz * HEIGHT_DIM + ix];
      height[i] = h;
      const texel = ((iz / terrain.materialStep) * dim + ix / terrain.materialStep) * 4;
      const m = terrain.material;
      if (h <= 0.04 || m[texel] + m[texel + 1] + m[texel + 2] >= 250) continue;
      const code = parent[i];
      profiles[i] = code === 20 || code === 50 ? 1 : 2;
    }
  }
  return buildSoilMap(profiles, height);
}

export class SoilRuntime {
  readonly textures: SoilSurfaceTextures;
  readonly model: SoilWaterGrid;
  private readonly pixels = new Uint8Array(SOIL_CELLS * 4);
  private worker: Worker | null = null;
  private inFlight: SoilCommand | null = null;
  private weather: Weather = 'clear';
  private lastTick = -1;
  updates = 0;

  constructor(terrain: TerrainTextureData, source: Awaited<ReturnType<typeof loadSoilAssets>>, private readonly preview: SoilPreview | null,
    memory: MemoryRegistry, private readonly uploads: SlidingRate) {
    this.model = new SoilWaterGrid(sampleSoilMap(source.parent, terrain));
    if (preview === 'dry') this.model.reset(0.25);
    if (preview === 'rain' || preview === 'drained') {
      for (let i = 0; i < 120; i++) this.model.step(60, 30, 0.04);
      if (preview === 'drained') for (let i = 0; i < 180; i++) this.model.step(120, 0, 0.45);
    }

    const water = new DataTexture(this.pixels, SOIL_DIM, SOIL_DIM, RGBAFormat, UnsignedByteType);
    water.name = 'soil-water';
    water.wrapS = water.wrapT = ClampToEdgeWrapping;
    water.minFilter = water.magFilter = LinearFilter;
    this.textures = { albedo: source.albedo, relief: source.relief, water };
    const scanBytes = 2 * 512 * 512 * 4;
    memory.add(MemoryPartition.Gpu, Math.round(scanBytes * 4 / 3) + this.pixels.byteLength);
    memory.add(MemoryPartition.CpuRetained, scanBytes + this.pixels.byteLength + this.model.state.byteLength * 2
      + this.model.map.profile.byteLength + this.model.map.downstream.byteLength);
    this.publish();
    if (preview === null) {
      try {
        this.worker = new Worker(new URL('./soilWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<Float32Array>) => {
          this.model.state.set(data);
          this.inFlight = null;
          this.updates++;
          this.publish();
        };
        this.worker.onerror = () => this.fallback();
        this.worker.onmessageerror = () => this.fallback();
        this.worker.postMessage({ map: this.model.map, state: this.model.state } satisfies SoilCommand);
      } catch {
        this.fallback();
      }
    }
  }

  get workerActive(): boolean { return this.worker !== null; }

  setWeather(weather: Weather): void { this.weather = weather; }

  /** @amortized one update per second, worker with a recoverable CPU fallback */
  update(now: number): void {
    if (this.preview !== null || this.inFlight) return;
    if (this.lastTick < 0) { this.lastTick = now; return; }
    if (now - this.lastTick < 1000) return;
    const seconds = Math.min(2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const rain = PRECIPITATION_MM_H[this.weather];
    const evaporation = EVAPORATION_MM_H[this.weather];
    if (this.worker) {
      const request = { seconds, rain, evaporation };
      this.inFlight = request;
      try { this.worker.postMessage(request satisfies SoilCommand); }
      catch { this.fallback(); }
    } else {
      this.model.step(seconds, rain, evaporation);
      this.updates++;
      this.publish();
    }
  }

  private fallback(): void {
    this.worker?.terminate();
    this.worker = null;
    const request = this.inFlight;
    this.inFlight = null;
    if (request && 'seconds' in request) {
      this.model.step(request.seconds, request.rain, request.evaporation);
      this.updates++;
      this.publish();
    }
  }

  private publish(): void {
    this.model.pack(this.pixels);
    this.textures.water.needsUpdate = true;
    this.uploads.add(performance.now(), this.pixels.byteLength);
  }
}
