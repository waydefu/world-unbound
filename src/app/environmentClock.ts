import { buildMultipleScattering, buildTransmittance } from '../env/atmosphereLuts';
import { seasonOf, type Season } from '../env/calendar';
import { computeCelestial, createCelestialState, type CelestialState } from '../env/ephemeris';
import { SkyViewBuilder } from '../env/skyView';
import type { Environment } from '../render/environment';
import type { Weather } from './params';

/** Rows of the sky-view table rebuilt per frame while a refresh is in progress. */
const ROWS_PER_FRAME = 4;
/** Exposure adaptation time constant (ms): eyes adapt over seconds, not frames. */
const ADAPT_MS = 1500;

/**
 * Time of day, season and weather -> sky tables and lights. Owns the
 * atmosphere tables (built once at boot) and the time-sliced sky-view
 * rebuild, and smooths exposure towards the environment's target.
 */
export class EnvironmentClock {
  readonly celestial: CelestialState = createCelestialState();
  readonly lutMs: number;
  exposure = 1;
  day = 0;
  hour = 12;
  season: Season = 'spring';
  weather: Weather = 'clear';
  private readonly sky: SkyViewBuilder;
  private appliedVersion = -1;

  constructor(private readonly environment: Environment) {
    const t0 = performance.now();
    const trans = buildTransmittance();
    this.sky = new SkyViewBuilder(trans, buildMultipleScattering(trans));
    this.lutMs = performance.now() - t0;
  }

  /** Camera cut or parameter change: rebuild synchronously and snap exposure. */
  configure(day: number, hour: number, weather: Weather, cameraHeightM: number): void {
    this.day = day;
    this.hour = hour;
    this.season = seasonOf(day);
    this.weather = weather;
    computeCelestial(day, hour, this.celestial);
    this.sky.buildNow(this.celestial.sunAltitude, cameraHeightM);
    this.publish();
    this.exposure = this.environment.targetExposure;
  }

  /**
   * Per frame: continue any rebuild, publish it when complete, adapt exposure.
   * @amortized at most ROWS_PER_FRAME sky rows per frame; lights change only on publish
   */
  update(dtMs: number): number {
    if (this.sky.building) this.sky.step(ROWS_PER_FRAME);
    if (this.sky.version !== this.appliedVersion) this.publish();
    const target = this.environment.targetExposure;
    const k = 1 - Math.exp(-Math.min(dtMs, 100) / ADAPT_MS);
    // Adapt in log space so bright-to-dark and dark-to-bright take equal time.
    this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(target) - Math.log(this.exposure)) * k);
    return this.exposure;
  }

  private publish(): void {
    this.appliedVersion = this.sky.version;
    this.environment.apply(this.sky.data, this.sky.summary, this.celestial, this.weather);
  }
}
