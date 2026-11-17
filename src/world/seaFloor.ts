import { WORLD_MAX, WORLD_MIN } from './constants';
import { heightAt } from './heightField';

/** Metres per texel of the sea-floor height map the ocean shader samples. */
export const SEAFLOOR_RES = 4;
/** Texels per side (1024). */
export const SEAFLOOR_DIM = (WORLD_MAX - WORLD_MIN) / SEAFLOOR_RES;

/** Metres per texel of the fine coast map (ocean fragment shader only, G1.4.1 phase G). */
export const COAST_RES = 2;
/** Texels per side of the coast map (2048; 8 MiB as half floats). */
export const COAST_DIM = (WORLD_MAX - WORLD_MIN) / COAST_RES;

function fill(out: Float32Array, dim: number, res: number): Float32Array {
  for (let j = 0; j < dim; j++) {
    const z = WORLD_MIN + (j + 0.5) * res;
    const row = j * dim;
    for (let i = 0; i < dim; i++) {
      out[row + i] = heightAt(WORLD_MIN + (i + 0.5) * res, z);
    }
  }
  return out;
}

/**
 * Fills `out` (SEAFLOOR_DIM x SEAFLOOR_DIM, row-major, one row per z) with the
 * ground or seabed height in metres at each texel centre. Nothing is clamped.
 * Runs in the terrain worker; ~262 k samples are too many for the main thread.
 */
export function buildSeaFloor(out: Float32Array): Float32Array {
  return fill(out, SEAFLOOR_DIM, SEAFLOOR_RES);
}

/** Same at COAST_RES (4.2 M samples, ~1.5 s: worker only). */
export function buildCoastFloor(out: Float32Array): Float32Array {
  return fill(out, COAST_DIM, COAST_RES);
}
