import { DAYS_PER_YEAR, normaliseDay } from './calendar';
import { noise1 } from './seededNoise';
import type { Weather } from './weather';

/**
 * Climate state v1 (spec G2.1 phase A): a pure function of (seed, game time, weather, day of year).
 * Gameplay may read it; nothing here uses frame time or randomness.
 *
 * Game time is seconds since day 0, 00:00 (March equinox); a game day is 86400 s here, so `gameTimeSeconds`
 * mod 86400 is the local solar time of day. `dayOfYear` is the calendar day in [0, 32), fractional.
 *
 * Direction convention: `windDirRad` is the direction the wind blows TOWARDS, a compass bearing in radians
 * (0 = towards north = -z, pi/2 = towards east = +x), so the unit vector in (x east, z south) is
 * (sin a, -cos a). Telemetry and the HUD show the meteorological bearing it blows FROM (`windFromDeg`).
 */
export interface ClimateState {
  /** Fraction of the calendar year since the March equinox, [0, 1). */
  season01: number;
  /** Air temperature at sea level, degrees Celsius (see `temperatureAtAltitude`). */
  temperatureC: number;
  /** Bearing the wind blows towards, radians in [0, 2 pi). */
  windDirRad: number;
  /** Mean wind speed at the open sea surface, m/s (before channelling and shelter). */
  windSpeedMs: number;
  /** Gust factor in [0, 1]: 0 lull, 1 strongest gust; changes over seconds. */
  gust01: number;
}

export function createClimateState(): ClimateState {
  return { season01: 0, temperatureC: 0, windDirRad: 0, windSpeedMs: 0, gust01: 0 };
}

/** Mean wind speed per weather state, m/s. // unverified: tunable, not taken from Norwegian wind statistics. */
export const BASE_WIND_MS: Record<Weather, number> = { clear: 3, cloudy: 5, rain: 8, storm: 15 };
/** Prevailing bearing the wind blows towards: along the fjord, from the open fjord (NE) towards the village, 225 deg. // unverified */
export const PREVAILING_TOWARDS_RAD = (225 * Math.PI) / 180;
/** The direction wanders this far either side of the prevailing one (rad). // unverified */
const DIRECTION_SWING_RAD = (70 * Math.PI) / 180;
/** Seconds per random value of the slow direction noise (about 3 h: "changes over hours") and of the speed drift (15 min). */
const DIRECTION_PERIOD_S = 10800;
const SPEED_PERIOD_S = 900;
/** Seconds per random value of the two gust octaves. */
const GUST_PERIOD_S = 10;
const GUST_FLUTTER_PERIOD_S = 4.5;

/**
 * Seasonal mean air temperature at sea level for 62 N coastal Norway: January 0 C, July 15 C. // unverified
 * fallback (no station series was retrieved). Calendar day 10.3 is mid July, 26.3 mid January.
 */
export const TEMPERATURE_MEAN_C = 7.5;
export const TEMPERATURE_ANNUAL_AMPLITUDE_C = 7.5;
const WARMEST_DAY = 10.3;
/** Half the day-night range in clear weather, peaking at 15:00 solar time. // unverified */
const DIURNAL_AMPLITUDE_C = 3;
/** Standard-atmosphere lapse rate, degrees per kilometre of altitude. */
export const LAPSE_C_PER_KM = 6.5;
/** Offset and diurnal damping per weather state (cloud keeps nights warm and days cool). // unverified */
const WEATHER_OFFSET_C: Record<Weather, number> = { clear: 0, cloudy: -0.5, rain: -1.5, storm: -2.5 };
const WEATHER_DIURNAL: Record<Weather, number> = { clear: 1, cloudy: 0.6, rain: 0.4, storm: 0.3 };

const TWO_PI = 2 * Math.PI;

/** Air temperature at `altitudeM` for a sea-level temperature (standard lapse, -6.5 C per km). */
export function temperatureAtAltitude(seaLevelC: number, altitudeM: number): number {
  return seaLevelC - (LAPSE_C_PER_KM * altitudeM) / 1000;
}

/**
 * Fills `out` for the given inputs. Deterministic; smooth in time (direction and speed change over minutes to
 * hours, gusts over seconds).
 * @amortized a few noise lookups and trig calls, once per frame at most
 */
export function computeClimate(
  seed: number, gameTimeSeconds: number, weather: Weather, dayOfYear: number, out: ClimateState,
): ClimateState {
  const day = normaliseDay(dayOfYear);
  out.season01 = day / DAYS_PER_YEAR;

  const secondsOfDay = ((gameTimeSeconds % 86400) + 86400) % 86400;
  const hour = secondsOfDay / 3600;
  const seasonal = TEMPERATURE_MEAN_C + TEMPERATURE_ANNUAL_AMPLITUDE_C * Math.cos((TWO_PI * (day - WARMEST_DAY)) / DAYS_PER_YEAR);
  const diurnal = DIURNAL_AMPLITUDE_C * WEATHER_DIURNAL[weather] * Math.cos((TWO_PI * (hour - 15)) / 24);
  // Weather fronts: a slow, +-1.5 C wander with a one-day period.
  const front = (noise1(gameTimeSeconds / 86400, seed + 31) - 0.5) * 3;
  out.temperatureC = seasonal + diurnal + WEATHER_OFFSET_C[weather] + front;

  const swing = (noise1(gameTimeSeconds / DIRECTION_PERIOD_S, seed + 11) - 0.5) * 2 * DIRECTION_SWING_RAD;
  const dir = (PREVAILING_TOWARDS_RAD + swing) % TWO_PI;
  out.windDirRad = dir < 0 ? dir + TWO_PI : dir;
  out.windSpeedMs = BASE_WIND_MS[weather] * (0.75 + 0.5 * noise1(gameTimeSeconds / SPEED_PERIOD_S, seed + 17));

  const g = 0.65 * noise1(gameTimeSeconds / GUST_PERIOD_S, seed + 23) + 0.35 * noise1(gameTimeSeconds / GUST_FLUTTER_PERIOD_S, seed + 29);
  // Value noise rarely reaches its extremes: stretch the middle so gusts use the whole range.
  const t = (g - 0.2) / 0.6;
  out.gust01 = t < 0 ? 0 : t > 1 ? 1 : t;
  return out;
}

/** Bearing the wind blows FROM in degrees [0, 360), the meteorological convention used by the HUD and telemetry. */
export function windFromDeg(climate: ClimateState): number {
  return (((climate.windDirRad * 180) / Math.PI + 180) % 360 + 360) % 360;
}

/**
 * Vegetation season keyframes over the year (fraction since the March equinox): weights of fresh spring green,
 * summer yellow-green and straw (autumn and dormant winter grass). Day 6, the default, sits in the fresh span so
 * the baseline look is the spring palette. // unverified: phenology is tuned by eye, not from observations.
 */
const SEASON_KEYS = [0, 0.12, 0.22, 0.4, 0.55, 0.65, 0.9, 1] as const;
const SEASON_WEIGHTS = [
  [0.5, 0, 0.5], [1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0.4, 0.6], [0, 0, 1], [0, 0, 1], [0.5, 0, 0.5],
] as const;

/**
 * Fills `out[0..2]` with the fresh / summer / straw weights (sum 1) for a season fraction; smooth, cyclic.
 * @amortized once per camera change
 */
export function vegetationSeason(season01: number, out: Float32Array): Float32Array {
  const s = ((season01 % 1) + 1) % 1;
  let k = 1;
  while (k < SEASON_KEYS.length - 1 && s > SEASON_KEYS[k]) k++;
  const t = Math.min(1, Math.max(0, (s - SEASON_KEYS[k - 1]) / (SEASON_KEYS[k] - SEASON_KEYS[k - 1])));
  const u = t * t * (3 - 2 * t);
  for (let c = 0; c < 3; c++) out[c] = SEASON_WEIGHTS[k - 1][c] + (SEASON_WEIGHTS[k][c] - SEASON_WEIGHTS[k - 1][c]) * u;
  return out;
}
