import { sampleQuantized } from './heightField';
import { AO_APRON } from './terrainAo';
import { TERRAIN_SAMPLES, terrainGrid } from './terrainData';

/** Lattice points per side of the height texture (the 2 m grid, WORLD_MIN to WORLD_MAX inclusive). */
export const LATTICE_DIM = TERRAIN_SAMPLES + 1;

export const PAD_DIM = LATTICE_DIM + 2 * AO_APRON;

/**
 * Quantised lattice with an AO_APRON border, so AO and normals can read neighbours without bounds checks.
 * Inside the baked square the rows are copied; outside it holds the open-water value `sampleQuantized` returns.
 */
export function buildPaddedLattice(): Int16Array {
  const outside = sampleQuantized(-100000, -100000);
  const grid = terrainGrid;
  if (grid === null) throw new Error('terrain data is not installed (installTerrain was not called)');
  const padded = new Int16Array(PAD_DIM * PAD_DIM).fill(outside);
  for (let row = 0; row < TERRAIN_SAMPLES; row++) {
    padded.set(grid.subarray(row * TERRAIN_SAMPLES, (row + 1) * TERRAIN_SAMPLES), (row + AO_APRON) * PAD_DIM + AO_APRON);
  }
  return padded;
}

/**
 * Separable box filter of the padded lattice in quantised units, with running sums. Texels closer than `radius`
 * to the padded border keep the raw value; the classification only reads texels at least AO_APRON (8) in, so
 * `radius` must stay below that. `padDim` is the side of `padded` (PAD_DIM unless a test passes a smaller lattice).
 */
export function boxFiltered(padded: Int16Array, radius: number, padDim = PAD_DIM): Float32Array {
  const out = new Float32Array(padDim * padDim);
  const tmp = new Float32Array(padDim * padDim);
  for (let k = 0; k < padded.length; k++) tmp[k] = padded[k];
  out.set(tmp);
  const inv = 1 / (2 * radius + 1);
  const span = 2 * radius + 1;
  for (let j = 0; j < padDim; j++) {
    const row = j * padDim;
    let sum = 0;
    for (let i = 0; i < span; i++) sum += padded[row + i];
    for (let i = radius; i < padDim - radius; i++) {
      tmp[row + i] = sum * inv;
      if (i + radius + 1 < padDim) sum += padded[row + i + radius + 1] - padded[row + i - radius];
    }
  }
  for (let i = 0; i < padDim; i++) {
    let sum = 0;
    for (let j = 0; j < span; j++) sum += tmp[j * padDim + i];
    for (let j = radius; j < padDim - radius; j++) {
      out[j * padDim + i] = sum * inv;
      if (j + radius + 1 < padDim) sum += tmp[(j + radius + 1) * padDim + i] - tmp[(j - radius) * padDim + i];
    }
  }
  return out;
}

