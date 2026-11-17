import { WORLD_MAX, WORLD_MIN } from './constants';
import { heightAt } from './heightField';

/** Metres per texel of the sea-floor height map the ocean shader samples. */
export const SEAFLOOR_RES = 4;
/** Texels per side (512). */
export const SEAFLOOR_DIM = (WORLD_MAX - WORLD_MIN) / SEAFLOOR_RES;

/**
 * Fills `out` (SEAFLOOR_DIM x SEAFLOOR_DIM, row-major, one row per z) with the
 * ground or seabed height in metres at each texel centre. Nothing is clamped.
 * Runs in the terrain worker; ~262 k samples are too many for the main thread.
 */
export function buildSeaFloor(out: Float32Array): Float32Array {
  for (let j = 0; j < SEAFLOOR_DIM; j++) {
    const z = WORLD_MIN + (j + 0.5) * SEAFLOOR_RES;
    const row = j * SEAFLOOR_DIM;
    for (let i = 0; i < SEAFLOOR_DIM; i++) {
      out[row + i] = heightAt(WORLD_MIN + (i + 0.5) * SEAFLOOR_RES, z);
    }
  }
  return out;
}
