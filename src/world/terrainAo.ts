import { CELL_SIZE, CHUNK_CELLS, CHUNK_SAMPLES, HEIGHT_QUANTUM } from './constants';
import { sampleQuantized } from './heightField';

/** Baked horizon-based ambient occlusion for terrain vertices. */
export const AO_APRON = 8;
export const AO_DIM = CHUNK_SAMPLES + 2 * AO_APRON;

const STEPS = [1, 2, 4, 8];
const DIRS_X = [1, 1, 0, -1, -1, -1, 0, 1];
const DIRS_Z = [0, 1, 1, 1, 0, -1, -1, -1];

/** Fills an AO_DIM² height tile (same units as generateTile) for chunk (cx, cz). */
export function generateAoTile(cx: number, cz: number, out: Int16Array): Int16Array {
  const baseX = cx * CHUNK_CELLS - AO_APRON;
  const baseZ = cz * CHUNK_CELLS - AO_APRON;
  for (let j = 0; j < AO_DIM; j++) {
    const row = j * AO_DIM;
    for (let i = 0; i < AO_DIM; i++) out[row + i] = sampleQuantized(baseX + i, baseZ + j);
  }
  return out;
}

/** Squared ground distance (m) of every (direction, step) pair, precomputed once. */
const DIST2 = new Float64Array(8 * 4);
for (let d = 0; d < 8; d++) {
  const diag = DIRS_X[d] !== 0 && DIRS_Z[d] !== 0 ? Math.SQRT2 : 1;
  for (let s = 0; s < 4; s++) {
    const dist = STEPS[s] * CELL_SIZE * diag;
    DIST2[d * 4 + s] = dist * dist;
  }
}

/**
 * Horizon-based AO for chunk-local sample (i, j) in [0, CHUNK_SAMPLES-1];
 * returns [0.25, 1], 1 = open sky.
 */
export function vertexAo(tile: Int16Array, dim: number, apron: number, i: number, j: number): number {
  const base = (j + apron) * dim + (i + apron);
  const h0 = tile[base];
  let sum = 0;
  for (let d = 0; d < 8; d++) {
    const stride = DIRS_Z[d] * dim + DIRS_X[d];
    let best = 0;
    for (let s = 0; s < 4; s++) {
      const dq = tile[base + stride * STEPS[s]] - h0;
      // Only ground rising above the point can raise the horizon (the offset cancels in differences).
      if (dq <= 0) continue;
      const dh = dq * HEIGHT_QUANTUM;
      const sinElev = dh / Math.sqrt(dh * dh + DIST2[d * 4 + s]);
      if (sinElev > best) best = sinElev;
    }
    sum += best;
  }
  const ao = 1 - sum / 8;
  return ao < 0.25 ? 0.25 : ao;
}
