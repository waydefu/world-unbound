import type { Weather } from './weather';

/** One Gerstner wave. Directions are unit vectors in the xz plane (+x east, +z south). */
export interface Wave {
  dirX: number;
  dirZ: number;
  wavelength: number;
  amplitude: number;
  steepness: number;
  speed: number;
}

const GRAVITY = 9.81;
const WAVELENGTHS = [42, 23, 13, 7.5] as const;
/** Angles around +z (towards the shore), degrees. */
const SPREAD_DEG = [-35, -10, 15, 40] as const;
/** Wave slope (k * A) per weather. */
const SLOPE: Record<Weather, number> = { clear: 0.035, cloudy: 0.05, rain: 0.07, storm: 0.11 };
/** Upper bound of the sum of Q k A; below 1 so crests never loop. */
const MAX_STEEPNESS_SUM = 0.8;

function build(slope: number): readonly Wave[] {
  const waves: Wave[] = [];
  for (let i = 0; i < WAVELENGTHS.length; i++) {
    const wavelength = WAVELENGTHS[i];
    const angle = (SPREAD_DEG[i] * Math.PI) / 180;
    const k = (2 * Math.PI) / wavelength;
    const amplitude = (wavelength * slope) / (2 * Math.PI);
    waves.push({
      dirX: Math.sin(angle),
      dirZ: Math.cos(angle),
      wavelength,
      amplitude,
      steepness: Math.min(1, MAX_STEEPNESS_SUM / (WAVELENGTHS.length * k * amplitude)),
      speed: Math.sqrt((GRAVITY * wavelength) / (2 * Math.PI)),
    });
  }
  return waves;
}

const SETS: Record<Weather, readonly Wave[]> = {
  clear: build(SLOPE.clear),
  cloudy: build(SLOPE.cloudy),
  rain: build(SLOPE.rain),
  storm: build(SLOPE.storm),
};

/** Four deterministic Gerstner waves for a weather state (deep-water dispersion). Constant arrays, no allocation. */
export function waveSet(weather: Weather): readonly Wave[] {
  return SETS[weather];
}

/** Wave slope (k * A) of a weather state; the shader scales its detail normals with it. */
export function waveSlope(weather: Weather): number {
  return SLOPE[weather];
}
