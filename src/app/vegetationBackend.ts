import {
  type ClimateState, computeClimate, createClimateState, temperatureAtAltitude, vegetationSeason, windFromDeg,
} from '../env/climate';
import { DAYS_PER_YEAR, normaliseDay } from '../env/calendar';
import { windDirX, windDirZ } from '../env/wind';
import type { Weather } from '../env/weather';
import type { Ocean } from '../render/ocean';
import { WORLD_SEED } from '../world/constants';
import type { AppState } from './report';
import type { TerrainBackend } from './terrainBackend';

/** Climate fields of AppState before the first tick. */
export function initialClimateState(): Pick<AppState, 'windDirDeg' | 'windSpeedMs' | 'temperatureC' | 'season01'> {
  return { windDirDeg: 0, windSpeedMs: 0, temperatureC: 0, season01: 0 };
}

/**
 * Climate, wind and (later in this file) vegetation wiring for the app (spec G2.1). Keeps App.ts small: the app
 * calls `configure` on camera cuts, `update` every frame and `sample` at the telemetry tick.
 */
export class VegetationBackend {
  readonly climate: ClimateState = createClimateState();
  private day = 0;
  private hour = 12;
  private weather: Weather = 'clear';
  private startMs = -1;

  private readonly seasonWeights = new Float32Array(3);

  constructor(private readonly ocean: Ocean, private readonly terrain: TerrainBackend) {}

  /** Camera cut or parameter change: the calendar and the weather the climate follows. */
  configure(day: number, hour: number, weather: Weather): void {
    this.day = day;
    this.hour = hour;
    this.weather = weather;
    this.startMs = -1;
    const w = vegetationSeason(normaliseDay(day + hour / 24) / DAYS_PER_YEAR, this.seasonWeights);
    this.terrain.setSeason(w[0], w[1], w[2]);
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
  update(nowMs: number): void {
    const climate = computeClimate(WORLD_SEED, this.gameTimeSeconds(nowMs), this.weather, this.day + this.hour / 24, this.climate);
    this.ocean.setWind(windDirX(climate.windDirRad), windDirZ(climate.windDirRad), climate.windSpeedMs);
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
  }
}
