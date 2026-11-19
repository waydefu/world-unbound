import { HEIGHT_OFFSET, HEIGHT_QUANTUM, WORLD_MAX, WORLD_MIN } from './constants';

/**
 * Basin openness (spec G2.1 phase D.1), baked in the terrain worker from the sea mask. Pure.
 *
 * One byte per 8 m cell of the 4 km square (512 x 512): the fraction of 16 compass directions in which open
 * water extends more than OPEN_REACH_M from the cell centre (0 = enclosed on every side, 255 = open in all
 * directions). The ocean shader reads it to keep harbour basins calm: no shore or crest foam, a narrow shallow
 * band. A cell counts as land if any lattice point of its 4 x 4 block (2 m spacing) is at or above sea level, so
 * thin breakwaters and piers close a basin even though they are narrower than a cell.
 */
export const OPENNESS_CELL_M = 8;
export const OPENNESS_DIM = (WORLD_MAX - WORLD_MIN) / OPENNESS_CELL_M;
/** Water must run this far unbroken for a direction to count as open. */
export const OPEN_REACH_M = 150;
export const OPENNESS_DIRECTIONS = 16;
/** Basins below this openness are "enclosed" (spec: 0.25). */
export const ENCLOSED_OPENNESS = 0.25;

const Q_SEA = Math.round((0 - HEIGHT_OFFSET) / HEIGHT_QUANTUM);
const STEPS = Math.ceil(OPEN_REACH_M / OPENNESS_CELL_M) + 1;

/**
 * Water mask of the 8 m cells from the padded lattice (`padDim` per side, `apron` border, `latticeDim` points of
 * the 2 m grid per side): 1 = water.
 * @amortized once at load
 */
export function buildWaterCells(padded: Int16Array, padDim: number, apron: number, dim: number, block: number): Uint8Array {
  const water = new Uint8Array(dim * dim);
  for (let j = 0; j < dim; j++) {
    for (let i = 0; i < dim; i++) {
      let wet = 1;
      for (let dj = 0; dj < block && wet === 1; dj++) {
        const row = (j * block + dj + apron) * padDim + i * block + apron;
        for (let di = 0; di < block; di++) {
          if (padded[row + di] >= Q_SEA) {
            wet = 0;
            break;
          }
        }
      }
      water[j * dim + i] = wet;
    }
  }
  return water;
}

/**
 * Openness bytes from a water mask (`dim` per side, `cell` metres per cell).
 * @amortized once at load
 */
export function buildOpenness(water: Uint8Array, dim: number, cell: number, out?: Uint8Array): Uint8Array {
  const result = out ?? new Uint8Array(dim * dim);
  const dx = new Float64Array(OPENNESS_DIRECTIONS);
  const dz = new Float64Array(OPENNESS_DIRECTIONS);
  for (let k = 0; k < OPENNESS_DIRECTIONS; k++) {
    dx[k] = Math.cos((k * 2 * Math.PI) / OPENNESS_DIRECTIONS);
    dz[k] = Math.sin((k * 2 * Math.PI) / OPENNESS_DIRECTIONS);
  }
  const steps = Math.ceil(OPEN_REACH_M / cell) + 1;
  for (let j = 0; j < dim; j++) {
    for (let i = 0; i < dim; i++) {
      if (water[j * dim + i] === 0) continue;
      let open = 0;
      for (let k = 0; k < OPENNESS_DIRECTIONS; k++) {
        let clear = true;
        for (let s = 1; s <= steps; s++) {
          const x = Math.round(i + dx[k] * s);
          const z = Math.round(j + dz[k] * s);
          // Leaving the baked square means open sea beyond the edge.
          if (x < 0 || z < 0 || x >= dim || z >= dim) break;
          if (water[z * dim + x] === 0) {
            clear = false;
            break;
          }
        }
        if (clear) open++;
      }
      result[j * dim + i] = Math.round((255 * open) / OPENNESS_DIRECTIONS);
    }
  }
  // Land cells next to water take the mean of their water neighbours, so the bilinear lookup at the waterline
  // does not blend towards zero.
  for (let j = 0; j < dim; j++) {
    for (let i = 0; i < dim; i++) {
      if (water[j * dim + i] === 1) continue;
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const x = i + di;
          const z = j + dj;
          if (x < 0 || z < 0 || x >= dim || z >= dim || water[z * dim + x] === 0) continue;
          sum += result[z * dim + x];
          n++;
        }
      }
      result[j * dim + i] = n > 0 ? Math.round(sum / n) : 0;
    }
  }
  return result;
}

/** Number of ray steps per direction (exported for the tests). */
export const OPENNESS_STEPS = STEPS;
