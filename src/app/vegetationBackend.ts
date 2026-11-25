import type { DataTexture, DirectionalLight, PerspectiveCamera } from 'three/webgpu';
import { DAYS_PER_YEAR, normaliseDay } from '../env/calendar';
import {
  type ClimateState, computeClimate, createClimateState, temperatureAtAltitude, vegetationSeason, windFromDeg,
} from '../env/climate';
import { windDirX, windDirZ } from '../env/wind';
import { WEATHER_WETNESS, type Weather } from '../env/weather';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import type { SlidingRate } from '../perf/slidingRate';
import { GrassLayer } from '../render/grass';
import { loadFullSod } from '../render/fullSod';
import { GUST_WAVELENGTH_M } from '../render/grassWind';
import { GroundSod } from '../render/groundSod';
import type { Ocean } from '../render/ocean';
import type { RendererHandle } from '../render/renderer';
import type { TurfRibbonTrial } from '../render/turfRibbonGeometry';
import { TurfRibbonLod } from '../render/turfRibbonLod';
import { WorldTurf } from '../render/worldTurf';
import { loadTurfMaster } from '../render/worldTurfAssets';
import { combineWorldTurfMetrics } from '../render/worldTurfMetrics';
import { WIND_BYTES, WindTexture } from '../render/windTexture';
import { WORLD_SEED } from '../world/constants';
import { SOD_LEAVES_PER_M2 } from '../world/sodRoots';
import type { TurfBenchmark, TurfTrial } from '../world/turfPopulation';
import { CdlodBackend } from './cdlodBackend';
import { type ResolvedCamera, SOD_ORIGIN, sodBaseY } from './cameras';
import type { TurfDrawOff } from './params';
import type { QualityTier } from './quality';
import type { AppState } from './report';
import type { TerrainBackend } from './terrainBackend';

/** Climate and grass fields of AppState before the first tick. */
export function initialVegetationState(): Pick<
  AppState, 'windDirDeg' | 'windSpeedMs' | 'temperatureC' | 'season01' | 'grassEnabled' | 'grassCells' | 'grassBlades'
  | 'grassCards' | 'grassTris' | 'grassMs' | 'grassSodTiles' | 'grassSodTris' | 'grassSodCrowns' | 'grassDensityM2' | 'windUpdates' | 'worldTurf'
> {
  return {
    windDirDeg: 0, windSpeedMs: 0, temperatureC: 0, season01: 0, grassEnabled: false, grassCells: 0, grassBlades: 0,
    grassCards: 0, grassTris: 0, grassMs: 0, grassSodTiles: 0, grassSodTris: 0, grassSodCrowns: 0, grassDensityM2: 0, windUpdates: 0, worldTurf: null,
  };
}

export interface VegetationOptions {
  readonly ocean: Ocean;
  readonly sun: DirectionalLight;
  readonly terrain: TerrainBackend;
  readonly tier: QualityTier;
  readonly memory: MemoryRegistry;
  readonly uploads: SlidingRate;
  readonly noise: DataTexture;
  /** `?grass=0` turns the grass off. */
  readonly grass: boolean;
  readonly sward?: boolean;
  readonly fullSod: boolean;
  readonly worldTurf: boolean;
  readonly turfStats: boolean;
  readonly surfaceFrame: boolean;
  readonly captureMs: number | null;
  readonly turfBench: TurfBenchmark | null;
  readonly turfLod: 20 | 30 | null;
  readonly turfTrial: TurfTrial | null;
  readonly turfOff: TurfDrawOff | null;
  readonly turfCull: boolean;
  readonly turfRibbon: TurfRibbonTrial | null;
  readonly turfReference: { x: number; z: number } | null;
  /** Sun shadows are on (blades receive them on the med and high tiers). */
  readonly shadows: boolean;
}

/**
 * Climate, wind and grass wiring for the app (spec G2.1). Keeps App.ts small: the app calls `configure` on camera
 * cuts, `prepare` once the terrain textures exist, `update` every frame and `sample` at the telemetry tick.
 */
export class VegetationBackend {
  readonly climate: ClimateState = createClimateState();
  private grass: GrassLayer | null = null;
  private fullSod: { leaves: number; triangles: number } | null = null;
  private groundSod: GroundSod | null = null;
  private worldTurf: WorldTurf | null = null;
  private foldedTurf: WorldTurf | null = null;
  private turfRibbonLod: TurfRibbonLod | null = null;
  private wind: WindTexture | null = null;
  private day = 0;
  private hour = 12;
  private weather: Weather = 'clear';
  private startMs = -1;
  private lastMs = 0;
  private readonly seasonWeights = new Float32Array(3);
  private canopyGustPhase = 0;

  constructor(private readonly options: VegetationOptions) {}

  /** Camera cut or parameter change: the calendar and the weather the climate follows. */
  configure(day: number, hour: number, weather: Weather): void {
    this.day = day;
    this.hour = hour;
    this.weather = weather;
    if (this.options.terrain instanceof CdlodBackend) this.options.terrain.setWeather(weather);
    this.startMs = -1;
    const w = vegetationSeason(normaliseDay(day + hour / 24) / DAYS_PER_YEAR, this.seasonWeights);
    this.options.terrain.setSeason(w[0], w[1], w[2]);
    this.grass?.setSeason(w[0], w[1], w[2]);
    this.groundSod?.setSeason(w[0], w[1], w[2]);
    this.worldTurf?.season.value.set(w[0], w[1], w[2]);
    this.foldedTurf?.season.value.set(w[0], w[1], w[2]);
    this.grass?.setWetness(WEATHER_WETNESS[weather]);
  }

  /**
   * Builds the wind texture and the grass once the CDLOD terrain textures exist (CDLOD only; the chunk path and
   * `?grass=0` have no grass). Call before warm-up so the grass pipelines compile with the rest.
   * @amortized once at start-up
   */
  async prepare(): Promise<void> {
    const { terrain, tier, memory, noise, ocean, uploads } = this.options;
    if (!(terrain instanceof CdlodBackend) || !terrain.gpu || !terrain.data?.masks) return;
    // Calm harbour basins (phase D): the ocean shader reads the worker's openness map.
    ocean.setOpenness(terrain.data.masks.openness);
    uploads.add(performance.now(), terrain.data.masks.openness.byteLength);
    if (!this.options.grass) return;
    if (this.options.fullSod) {
      const { tile, leaves, triangles, bytes } = await loadFullSod(this.options.shadows);
      tile.position.set(SOD_ORIGIN.x, sodBaseY(), SOD_ORIGIN.z);
      terrain.root.add(tile);
      memory.add(MemoryPartition.Gpu, bytes);
      memory.add(MemoryPartition.CpuRetained, bytes);
      uploads.add(performance.now(), bytes);
      this.fullSod = { leaves, triangles };
      return;
    }
    const wind = terrain.carpetWind ?? new WindTexture(terrain.data.masks.windChannel);
    const sward = this.options.sward === true;
    // The master leaf stream handles the foreground. Keep this layer for scattered tall species.
    const settings = sward && tier.name !== 'low'
      ? { ...tier.grass, nearM: 0, midM: 12, bladesPerM2: 0 }
      : tier.grass;
    // Low sward uses the filtered terrain canopy alone: legacy 60 m cards are the source of the peppered arc.
    const canopyOnly = sward && tier.name === 'low';
    const grass = canopyOnly ? null : new GrassLayer({
      textures: terrain.gpu, data: terrain.data, noise, wind: wind.texture, settings,
      motion: terrain.carpetWind ? terrain.carpetMotion : undefined,
      shadows: this.options.shadows && tier.name !== 'low', lite: tier.name === 'low', sward,
    });
    if (grass) {
      grass.account(memory);
      if (grass.tuftUploadBytes) uploads.add(performance.now(), grass.tuftUploadBytes);
      grass.setSeason(this.seasonWeights[0], this.seasonWeights[1], this.seasonWeights[2]);
      grass.setWetness(WEATHER_WETNESS[this.weather]);
      terrain.root.add(grass.root);
    }
    if (this.options.worldTurf && (!canopyOnly || this.options.turfReference) && terrain.soil) {
      const master = await loadTurfMaster();
      const meshOptions = {
        master: master.textures, height: terrain.gpu.height, water: terrain.soil.textures.water,
        wind: terrain.carpetMotion, shadows: this.options.shadows && tier.name !== 'low',
        surfaceFrame: this.options.surfaceFrame, ribbonHandoff: this.options.turfLod !== null,
      };
      const trial = this.options.turfTrial;
      this.worldTurf = new WorldTurf(terrain.root, terrain.data, meshOptions,
        this.options.turfReference ? { ...this.options.turfReference, origins: master.origins } : null,
        this.options.turfStats, this.options.turfBench, memory, trial, false,
        { drawOff: this.options.turfOff === 'full', earlyCull: this.options.turfCull });
      if (trial) {
        this.foldedTurf = new WorldTurf(terrain.root, terrain.data, meshOptions, null, this.options.turfStats, null, memory, trial, true,
          { drawOff: this.options.turfOff === 'folded', earlyCull: this.options.turfCull });
        this.foldedTurf.season.value.fromArray(this.seasonWeights);
      }
      this.worldTurf.season.value.fromArray(this.seasonWeights);
      memory.add(MemoryPartition.Gpu, master.bytes);
      memory.add(MemoryPartition.CpuRetained, master.bytes);
      uploads.add(performance.now(), master.bytes);
      if (this.options.turfLod !== null) {
        const lod = await TurfRibbonLod.load(terrain.gpu.height, terrain.data, this.options.turfLod, this.worldTurf,
          terrain.carpetMotion, this.options.shadows, trial === 'canopy', this.options.turfRibbon);
        lod.mesh.visible = this.options.turfOff !== 'ribbon';
        terrain.root.add(lod.mesh);
        this.turfRibbonLod = lod;
        memory.add(MemoryPartition.CpuRetained, lod.cpuBytes);
        memory.add(MemoryPartition.Gpu, lod.gpuBytes);
      }
    } else if (!this.options.worldTurf && sward && !canopyOnly && terrain.carpetWind && terrain.soil) {
      this.groundSod = await GroundSod.load(terrain.data, terrain.gpu.height, terrain.soil.textures.water,
        tier.name === 'high', terrain.carpetMotion, this.options.shadows);
      this.groundSod.setSeason(this.seasonWeights[0], this.seasonWeights[1], this.seasonWeights[2]);
      terrain.root.add(this.groundSod.sparse.mesh, this.groundSod.dense.mesh);
      memory.add(MemoryPartition.Gpu, this.groundSod.bytes);
      memory.add(MemoryPartition.CpuRetained, this.groundSod.bytes);
      uploads.add(performance.now(), this.groundSod.bytes);
    }
    memory.add(MemoryPartition.Gpu, WIND_BYTES);
    memory.add(MemoryPartition.CpuRetained, WIND_BYTES);
    terrain.setGrassRange(settings.midM);
    this.wind = wind;
    this.grass = grass;
  }

  setRenderer(handle: RendererHandle): void {
    this.worldTurf?.attach(handle);
    this.foldedTurf?.attach(handle);
    this.turfRibbonLod?.setRenderer(handle);
  }

  /**
   * Game time: the calendar day and hour of the camera preset plus the real seconds since it was set, so the
   * wind keeps evolving while the sky stays at the preset hour.
   * @hot
   */
  private gameTimeSeconds(nowMs: number): number {
    if (this.startMs < 0) this.startMs = nowMs;
    return (this.day * 24 + this.hour) * 3600 + (this.options.captureMs ?? (nowMs - this.startMs)) / 1000;
  }

  /** @hot */
  update(nowMs: number, eye: ResolvedCamera, camera: PerspectiveCamera, bufferHeight: number): void {
    const { ocean, sun, uploads } = this.options;
    const climate = computeClimate(WORLD_SEED, this.gameTimeSeconds(nowMs), this.weather, this.day + this.hour / 24, this.climate);
    const dirX = windDirX(climate.windDirRad);
    const dirZ = windDirZ(climate.windDirRad);
    ocean.setWind(dirX, dirZ, climate.windSpeedMs);
    const dt = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const grass = this.grass;
    const wind = this.wind;
    if (wind === null) return;
    if (wind.update(nowMs, eye.x, eye.z, climate)) uploads.add(nowMs, WIND_BYTES);
    const p = sun.position;
    const inv = 1 / Math.max(1e-6, Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z));
    const sx = p.x * inv, sy = p.y * inv, sz = p.z * inv;
    const sr = sun.color.r * sun.intensity, sg = sun.color.g * sun.intensity, sb = sun.color.b * sun.intensity;
    this.worldTurf?.sunDir.value.set(sx, sy, sz);
    this.worldTurf?.sunColour.value.set(sr, sg, sb);
    this.foldedTurf?.sunDir.value.set(sx, sy, sz);
    this.foldedTurf?.sunColour.value.set(sr, sg, sb);
    this.worldTurf?.update(nowMs, eye.x, eye.y, eye.z, camera, bufferHeight);
    this.foldedTurf?.update(nowMs, eye.x, eye.y, eye.z, camera, bufferHeight);
    this.turfRibbonLod?.update(eye.x, eye.y, eye.z, camera);
    if (grass === null) {
      if (this.options.sward === true && this.options.tier.name === 'low' && this.options.terrain instanceof CdlodBackend) {
        const motion = this.options.terrain.carpetMotion;
        motion.wind.value.set(dirX, dirZ, climate.windSpeedMs, climate.gust01);
        if (dt > 0 && dt < 1) this.canopyGustPhase += dt * climate.windSpeedMs * 1.1 / GUST_WAVELENGTH_M;
        motion.gustPhase.value = this.options.captureMs === null ? this.canopyGustPhase
          : this.options.captureMs / 1000 * climate.windSpeedMs * 1.1 / GUST_WAVELENGTH_M;
      }
      return;
    }
    grass.setWind(dirX, dirZ, climate.windSpeedMs, climate.gust01);
    grass.setSun(sx, sy, sz, sr, sg, sb);
    grass.update(eye.x, eye.y, eye.z, camera, (this.options.captureMs ?? nowMs) / 1000, dt, this.options.captureMs !== null);
    this.groundSod?.update(eye.x, eye.y, eye.z, camera);
  }

  /** Temperature at an altitude (m) for the current climate. */
  temperatureAt(altitudeM: number): number {
    return temperatureAtAltitude(this.climate.temperatureC, altitudeM);
  }

  /** @amortized once per telemetry tick */
  sample(state: AppState): void {
    state.windDirDeg = windFromDeg(this.climate);
    state.windSpeedMs = this.climate.windSpeedMs;
    state.temperatureC = this.climate.temperatureC;
    state.season01 = this.climate.season01;
    const grass = this.grass;
    state.grassEnabled = this.wind !== null || this.fullSod !== null;
    state.grassDensityM2 = state.grassEnabled && this.options.sward ? SOD_LEAVES_PER_M2 : 0;
    const native = this.worldTurf;
    const folded = this.foldedTurf;
    state.worldTurf = native?.metrics() ?? null;
    if (native && state.worldTurf && folded && this.options.turfTrial) {
      const detail = native.detailReach.value;
      state.worldTurf = combineWorldTurfMetrics(state.worldTurf, folded.metrics(), this.options.turfTrial, detail.x, detail.y, folded.crownDivisor);
    }
    if (state.worldTurf) state.worldTurf.ribbonLod = this.turfRibbonLod?.metrics() ?? null;
    state.windUpdates = this.wind?.updates ?? 0;
    if (this.fullSod) {
      state.grassCells = 1;
      state.grassBlades = this.fullSod.leaves;
      state.grassTris = this.fullSod.triangles;
      state.grassSodTiles = 1;
      state.grassSodTris = this.fullSod.triangles;
    }
    if (grass === null) return;
    const sod = this.groundSod;
    const sparse = sod?.sparse.mesh.geometry.instanceCount ?? 0;
    const dense = sod?.dense.mesh.geometry.instanceCount ?? 0;
    state.grassSodCrowns = state.worldTurf?.submittedCrowns ?? sparse + dense;
    state.grassSodTris = state.worldTurf?.submittedTriangles ?? (sod ? sparse * sod.sparse.triangles + dense * sod.dense.triangles : 0);
    state.grassCells = grass.stats.cells;
    state.grassBlades = grass.stats.blades + (state.worldTurf?.submittedLeaves ?? state.grassSodTris / 22);
    state.grassCards = grass.stats.cards;
    state.grassTris = grass.stats.triangles + state.grassSodTris + (state.worldTurf?.ribbonLod?.triangles ?? 0);
    state.grassMs = grass.stats.ms;
  }
}
