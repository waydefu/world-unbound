import { DAYS_PER_YEAR, OBLIQUITY, solarDeclination, yearFraction } from './calendar';

/**
 * Sun and moon directions for latitude 62.083° N (Hellesylt) in the world frame
 * (+x east, +y up, +z south). Hours are local apparent solar time, so the
 * sun crosses the meridian (due south, +z) at 12:00.
 */
export const LATITUDE = (62.083 * Math.PI) / 180;
/** Days per lunar cycle in the 32-day year: one cycle per season. */
export const LUNAR_PERIOD_DAYS = 8;

export interface CelestialState {
  /** Unit vector towards the sun. */
  sun: Float64Array;
  /** Unit vector towards the moon. */
  moon: Float64Array;
  /** Sun altitude above the horizon in radians. */
  sunAltitude: number;
  moonAltitude: number;
  /** Lunar phase in [0, 1): 0 new, 0.5 full. */
  moonPhase: number;
  /** Illuminated fraction of the lunar disc in [0, 1]. */
  moonIllumination: number;
  declination: number;
}

export function createCelestialState(): CelestialState {
  return {
    sun: new Float64Array(3), moon: new Float64Array(3),
    sunAltitude: 0, moonAltitude: 0, moonPhase: 0, moonIllumination: 0, declination: 0,
  };
}

/** Direction for a body at hour angle `h` (radians, 0 = meridian, positive = west) and declination `dec`. */
function horizontal(h: number, dec: number, out: Float64Array): number {
  const sinAlt = Math.sin(LATITUDE) * Math.sin(dec) + Math.cos(LATITUDE) * Math.cos(dec) * Math.cos(h);
  const east = -Math.cos(dec) * Math.sin(h);
  const north = Math.cos(LATITUDE) * Math.sin(dec) - Math.sin(LATITUDE) * Math.cos(dec) * Math.cos(h);
  out[0] = east;
  out[1] = sinAlt;
  out[2] = -north;
  const len = Math.hypot(out[0], out[1], out[2]);
  out[0] /= len;
  out[1] /= len;
  out[2] /= len;
  return Math.asin(Math.max(-1, Math.min(1, out[1])));
}

/** Fills `out` for the given day (0..32) and solar hour (0..24). */
export function computeCelestial(day: number, hour: number, out: CelestialState): CelestialState {
  const hourAngle = ((hour - 12) * Math.PI) / 12;
  out.declination = solarDeclination(day, hour);
  out.sunAltitude = horizontal(hourAngle, out.declination, out.sun);

  const phase = (((day + hour / 24) / LUNAR_PERIOD_DAYS) % 1 + 1) % 1;
  out.moonPhase = phase;
  out.moonIllumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  // The moon trails the sun by its phase angle and sits roughly opposite in the ecliptic when full.
  const moonDec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(2 * Math.PI * (yearFraction(day, hour) + phase)));
  out.moonAltitude = horizontal(hourAngle - 2 * Math.PI * phase, moonDec, out.moon);
  return out;
}

/** Hours of daylight (sun centre above the horizon) for a day; 24 or 0 near the poles. */
export function dayLengthHours(day: number): number {
  const dec = solarDeclination(day, 12);
  const x = -Math.tan(LATITUDE) * Math.tan(dec);
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (2 * Math.acos(x) * 12) / Math.PI;
}

export { DAYS_PER_YEAR };
