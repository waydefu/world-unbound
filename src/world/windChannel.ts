import { WORLD_MAX, WORLD_MIN } from './constants';
import { heightAt } from './heightField';

/**
 * Fjord channelling map (spec G2.1 phase A.2), baked once from the terrain in the worker. Pure.
 *
 * 256 x 256 cells of 16 m over the 4 km square. Per cell, four floats (WIND_CHANNEL_STRIDE):
 *   0, 1: the valley axis as a double angle, (cos 2a, sin 2a) times the coherence. An axis has no sign, and
 *         double-angle vectors average correctly under bilinear filtering where unit axes would cancel;
 *   2:    sky openness 0..1, the sky-view factor 1 - mean(sin horizon elevation) over 8 azimuths out to 640 m
 *         (Zaksek et al. 2011 approximation): 1 = open sky, a narrow gorge approaches 0;
 *   3:    unused.
 * The valley axis is the minor axis of the gradient structure tensor over a ~300 m window: valley walls slope
 * across the axis, so the gradients point across it. Water is flat (heights are clamped at sea level).
 */
export const WIND_CHANNEL_CELL = 16;
export const WIND_CHANNEL_DIM = (WORLD_MAX - WORLD_MIN) / WIND_CHANNEL_CELL;
export const WIND_CHANNEL_STRIDE = 4;
/** Half-width of the tensor window (19 cells = 304 m) and horizon search reach (40 cells = 640 m). */
const WINDOW = 19;
const HORIZON_STEPS = 40;
/** Eye height above the ground for the horizon search (m). */
const EYE = 2;
/** Gradients weaker than this (m per m, rms) do not define an axis. */
const FLAT_RMS = 0.02;
const AZIMUTHS = 8;
const DIR_X = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2] as const;
const DIR_Z = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2] as const;

/** Heights in metres at the 16 m cell centres, clamped at sea level (the fjord surface is flat). */
export function sampleChannelHeights(out: Float32Array = new Float32Array(WIND_CHANNEL_DIM * WIND_CHANNEL_DIM)): Float32Array {
  for (let j = 0; j < WIND_CHANNEL_DIM; j++) {
    const z = WORLD_MIN + (j + 0.5) * WIND_CHANNEL_CELL;
    for (let i = 0; i < WIND_CHANNEL_DIM; i++) {
      const h = heightAt(WORLD_MIN + (i + 0.5) * WIND_CHANNEL_CELL, z);
      out[j * WIND_CHANNEL_DIM + i] = h > 0 ? h : 0;
    }
  }
  return out;
}

/** Summed-area table (dim + 1 per side) of a per-cell quantity, so any box sum is four reads. */
function summed(dim: number, value: (index: number) => number): Float64Array {
  const side = dim + 1;
  const table = new Float64Array(side * side);
  for (let j = 0; j < dim; j++) {
    let row = 0;
    for (let i = 0; i < dim; i++) {
      row += value(j * dim + i);
      table[(j + 1) * side + i + 1] = table[j * side + i + 1] + row;
    }
  }
  return table;
}

function boxSum(table: Float64Array, side: number, i0: number, j0: number, i1: number, j1: number): number {
  return table[(j1 + 1) * side + i1 + 1] - table[j0 * side + i1 + 1] - table[(j1 + 1) * side + i0] + table[j0 * side + i0];
}

/**
 * Builds the map from square `heights` (`dim` per side, `cell` metres apart).
 * @amortized once at load, in the worker (~40 ms for 256 x 256)
 */
export function buildWindChannel(heights: Float32Array, dim: number, cell: number, out?: Float32Array): Float32Array {
  const result = out ?? new Float32Array(dim * dim * WIND_CHANNEL_STRIDE);
  const gx = new Float32Array(dim * dim);
  const gz = new Float32Array(dim * dim);
  for (let j = 0; j < dim; j++) {
    for (let i = 0; i < dim; i++) {
      const at = j * dim + i;
      const west = heights[j * dim + (i > 0 ? i - 1 : i)];
      const east = heights[j * dim + (i < dim - 1 ? i + 1 : i)];
      const north = heights[(j > 0 ? j - 1 : j) * dim + i];
      const south = heights[(j < dim - 1 ? j + 1 : j) * dim + i];
      gx[at] = (east - west) / (2 * cell);
      gz[at] = (south - north) / (2 * cell);
    }
  }
  const side = dim + 1;
  const sxx = summed(dim, (k) => gx[k] * gx[k]);
  const sxz = summed(dim, (k) => gx[k] * gz[k]);
  const szz = summed(dim, (k) => gz[k] * gz[k]);
  for (let j = 0; j < dim; j++) {
    const j0 = Math.max(0, j - WINDOW);
    const j1 = Math.min(dim - 1, j + WINDOW);
    for (let i = 0; i < dim; i++) {
      const i0 = Math.max(0, i - WINDOW);
      const i1 = Math.min(dim - 1, i + WINDOW);
      const n = (i1 - i0 + 1) * (j1 - j0 + 1);
      const a = boxSum(sxx, side, i0, j0, i1, j1);
      const b = boxSum(sxz, side, i0, j0, i1, j1);
      const c = boxSum(szz, side, i0, j0, i1, j1);
      const trace = a + c;
      const spread = Math.sqrt((a - c) * (a - c) + 4 * b * b);
      // Dominant gradient axis phi: tan 2phi = 2b / (a - c). The valley axis is across it: add 90 degrees,
      // which negates the double angle. Coherence is the tensor's anisotropy, faded out on flat ground.
      const rms = Math.sqrt(trace / n);
      const anisotropy = trace > 1e-12 ? spread / trace : 0;
      const coherence = anisotropy * Math.min(1, rms / FLAT_RMS);
      const o = (j * dim + i) * WIND_CHANNEL_STRIDE;
      if (spread > 1e-12) {
        result[o] = (-(a - c) / spread) * coherence;
        result[o + 1] = (-(2 * b) / spread) * coherence;
      } else {
        result[o] = 0;
        result[o + 1] = 0;
      }
      result[o + 2] = openness(heights, dim, i, j, cell);
      result[o + 3] = 0;
    }
  }
  return result;
}

/** Sky openness at cell (i, j): 1 minus the mean sine of the horizon elevation angle over 8 azimuths. */
function openness(heights: Float32Array, dim: number, i: number, j: number, cell: number): number {
  const eye = heights[j * dim + i] + EYE;
  let sum = 0;
  for (let d = 0; d < AZIMUTHS; d++) {
    let slope = 0;
    for (let s = 1; s <= HORIZON_STEPS; s++) {
      const x = Math.round(i + DIR_X[d] * s);
      const z = Math.round(j + DIR_Z[d] * s);
      if (x < 0 || z < 0 || x >= dim || z >= dim) break;
      const dist = s * cell * (d & 1 ? Math.SQRT2 : 1);
      const rise = (heights[z * dim + x] - eye) / dist;
      if (rise > slope) slope = rise;
    }
    sum += slope / Math.sqrt(1 + slope * slope);
  }
  return 1 - sum / AZIMUTHS;
}

/**
 * Bakes the map for the installed terrain.
 * @amortized once at load, in the worker
 */
export function bakeWindChannel(): Float32Array {
  return buildWindChannel(sampleChannelHeights(), WIND_CHANNEL_DIM, WIND_CHANNEL_CELL);
}

/**
 * Bilinear lookup at world (x, z): writes the axis unit vector, coherence and openness into
 * out[0..3] = axisX, axisZ, coherence, openness. Outside the map the nearest edge cell is used.
 * @hot no allocation
 */
export function sampleWindChannel(map: Float32Array, x: number, z: number, out: Float32Array): Float32Array {
  const fx = Math.min(WIND_CHANNEL_DIM - 1.001, Math.max(0, (x - WORLD_MIN) / WIND_CHANNEL_CELL - 0.5));
  const fz = Math.min(WIND_CHANNEL_DIM - 1.001, Math.max(0, (z - WORLD_MIN) / WIND_CHANNEL_CELL - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const a = (j * WIND_CHANNEL_DIM + i) * WIND_CHANNEL_STRIDE;
  const b = a + WIND_CHANNEL_STRIDE;
  const c = a + WIND_CHANNEL_DIM * WIND_CHANNEL_STRIDE;
  const d = c + WIND_CHANNEL_STRIDE;
  const w00 = (1 - u) * (1 - v);
  const w10 = u * (1 - v);
  const w01 = (1 - u) * v;
  const w11 = u * v;
  const c2 = map[a] * w00 + map[b] * w10 + map[c] * w01 + map[d] * w11;
  const s2 = map[a + 1] * w00 + map[b + 1] * w10 + map[c + 1] * w01 + map[d + 1] * w11;
  out[3] = map[a + 2] * w00 + map[b + 2] * w10 + map[c + 2] * w01 + map[d + 2] * w11;
  const coherence = Math.sqrt(c2 * c2 + s2 * s2);
  out[2] = coherence > 1 ? 1 : coherence;
  if (coherence > 1e-6) {
    // Half angle from the double angle: cos a = sqrt((1 + cos 2a) / 2), sin a carries the sign of sin 2a.
    const cos2 = c2 / coherence;
    out[0] = Math.sqrt((1 + cos2) * 0.5);
    out[1] = Math.sqrt((1 - cos2) * 0.5) * (s2 < 0 ? -1 : 1);
  } else {
    out[0] = 1;
    out[1] = 0;
  }
  return out;
}
