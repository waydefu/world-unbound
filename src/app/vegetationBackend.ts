import type { Camera, DataTexture, DirectionalLight } from 'three/webgpu';
import { DAYS_PER_YEAR, normaliseDay } from '../env/calendar';
import {
  type ClimateState, computeClimate, createClimateState, temperatureAtAltitude, vegetationSeason, windFromDeg,
} from '../env/climate';
import { windDirX, windDirZ } from '../env/wind';
import { WEATHER_WETNESS, type Weather } from '../env/weather';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import type { SlidingRate } from '../perf/slidingRate';
import { GrassLayer } from '../render/grass';
import type { Ocean } from '../render/ocean';
import { WIND_BYTES, WindTexture } from '../render/windTexture';
import { WORLD_SEED } from '../world/constants';
import { CdlodBackend } from './cdlodBackend';
import type { ResolvedCamera } from './cameras';
import type { QualityTier } from './quality';
import type { AppState } from './report';
import type { TerrainBackend } from './terrainBackend';

/** Climate and grass fields of AppState before the first tick. */
export function initialVegetationState(): Pick<
  AppState, 'windDirDeg' | 'windSpeedMs' | 'temperatureC' | 'season01' | 'grassEnabled' | 'grassCells' | 'grassBlades'
  | 'grassCards' | 'grassTris' | 'grassMs' | 'windUpdates'
> {
  return {
    windDirDeg: 0, windSpeedMs: 0, temperatureC: 0, season01: 0, grassEnabled: false, grassCells: 0, grassBlades: 0,
    grassCards: 0, grassTris: 0, grassMs: 0, windUpdates: 0,
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
  private wind: WindTexture | null = null;
  private day = 0;
  private hour = 12;
  private weather: Weather = 'clear';
  private startMs = -1;
  private lastMs = 0;
  private readonly seasonWeights = new Float32Array(3);

  constructor(private readonly options: VegetationOptions) {}

  /** Camera cut or parameter change: the calendar and the weather the climate follows. */
  configure(day: number, hour: number, weather: Weather): void {
    this.day = day;
    this.hour = hour;
    this.weather = weather;
    this.startMs = -1;
    const w = vegetationSeason(normaliseDay(day + hour / 24) / DAYS_PER_YEAR, this.seasonWeights);
    this.options.terrain.setSeason(w[0], w[1], w[2]);
    this.grass?.setSeason(w[0], w[1], w[2]);
    this.grass?.setWetness(WEATHER_WETNESS[weather]);
  }

  /**
   * Builds the wind texture and the grass once the CDLOD terrain textures exist (CDLOD only; the chunk path and
   * `?grass=0` have no grass). Call before warm-up so the grass pipelines compile with the rest.
   * @amortized once at start-up
   */
  prepare(): void {
    const { terrain, tier, memory, noise, ocean, uploads } = this.options;
    if (!(terrain instanceof CdlodBackend) || !terrain.gpu || !terrain.data?.masks) return;
    // Calm harbour basins (phase D): the ocean shader reads the worker's openness map.
    ocean.setOpenness(terrain.data.masks.openness);
    uploads.add(performance.now(), terrain.data.masks.openness.byteLength);
    if (!this.options.grass) return;
    const wind = terrain.carpetWind ?? new WindTexture(terrain.data.masks.windChannel);
    const sward = this.options.sward === true;
    // Spend more placements in the foreground. Cards and baked coverage fill the shorter blade ring.
    const settings = sward && tier.name !== 'low'
      ? { ...tier.grass, nearM: 11, midM: 12, bladesPerM2: tier.name === 'med' ? 14 : 19 }
      : tier.grass;
    const grass = new GrassLayer({
      textures: terrain.gpu, data: terrain.data, noise, wind: wind.texture, settings,
      motion: terrain.carpetWind ? terrain.carpetMotion : undefined,
      shadows: this.options.shadows && tier.name !== 'low', lite: tier.name === 'low', sward,
    });
    grass.account(memory);
    if (grass.tuftUploadBytes) uploads.add(performance.now(), grass.tuftUploadBytes);
    memory.add(MemoryPartition.Gpu, WIND_BYTES);
    memory.add(MemoryPartition.CpuRetained, WIND_BYTES);
    grass.setSeason(this.seasonWeights[0], this.seasonWeights[1], this.seasonWeights[2]);
    grass.setWetness(WEATHER_WETNESS[this.weather]);
    terrain.root.add(grass.root);
    terrain.setGrassRange(settings.midM);
    this.wind = wind;
    this.grass = grass;
  }

  /**
   * Game time: the calendar day and hour of the camera preset plus the real seconds since it was set, so the
   * wind keeps evolving while the sky stays at the preset hour.
   * @hot
   */
  private gameTimeSeconds(nowMs: number): number {
    if (this.startMs < 0) this.startMs = nowMs;
    return (this.day * 24 + this.hour) * 3600 + (nowMs - this.startMs) / 1000;
  }

  /** @hot */
  update(nowMs: number, eye: ResolvedCamera, camera: Camera): void {
    const { ocean, sun, uploads } = this.options;
    const climate = computeClimate(WORLD_SEED, this.gameTimeSeconds(nowMs), this.weather, this.day + this.hour / 24, this.climate);
    const dirX = windDirX(climate.windDirRad);
    const dirZ = windDirZ(climate.windDirRad);
    ocean.setWind(dirX, dirZ, climate.windSpeedMs);
    const dt = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const grass = this.grass;
    const wind = this.wind;
    if (grass === null || wind === null) return;
    if (wind.update(nowMs, eye.x, eye.z, climate)) uploads.add(nowMs, WIND_BYTES);
    grass.setWind(dirX, dirZ, climate.windSpeedMs, climate.gust01);
    const p = sun.position;
    const inv = 1 / Math.max(1e-6, Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z));
    grass.setSun(p.x * inv, p.y * inv, p.z * inv, sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity);
    grass.update(eye.x, eye.y, eye.z, camera, nowMs / 1000, dt);
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
    state.grassEnabled = grass !== null;
    state.windUpdates = this.wind?.updates ?? 0;
    if (grass === null) return;
    state.grassCells = grass.stats.cells;
    state.grassBlades = grass.stats.blades;
    state.grassCards = grass.stats.cards;
    state.grassTris = grass.stats.triangles;
    state.grassMs = grass.stats.ms;
  }
}
