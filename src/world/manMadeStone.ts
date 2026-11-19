import { HEIGHT_QUANTUM } from './constants';
import { quantize } from './heightField';

/**
 * Man-made stone detection on the 2 m lattice (spec G2.1 phase B.3): breakwaters, piers and quay walls, which
 * the baked terrain carries as thin low ridges and sheer edges next to the sea. Pure.
 *
 *  - Thin strip: a land point 0..STONE_MAX_HEIGHT_M above the sea with sea water within STONE_REACH_CELLS on two
 *    roughly opposite sides (along an axis or a diagonal). The spec says "within 4 m"; the harbour piers in the
 *    baked data are 4 to 9 m across, so the reach is 3 cells (6 m). Flagged points are dilated by one cell so the
 *    flanks of the strip are stone too.
 *  - Quay wall: a land point with sea water 1 cell away and a drop of at least QUAY_DROP_M to it (or
 *    2 x QUAY_DROP_M at 2 cells), on ground that stays level behind it: a built edge, not a beach.
 */
export const STONE_MAX_HEIGHT_M = 5;
export const STONE_REACH_CELLS = 3;
export const QUAY_DROP_M = 1.5;
/** Level ground behind a quay edge: the point one cell inland may differ by this much (m). */
const QUAY_LEVEL_M = 0.6;

const Q_SEA = quantize(0);
const Q_TOP = quantize(STONE_MAX_HEIGHT_M);
const Q_DROP = Math.round(QUAY_DROP_M / HEIGHT_QUANTUM);
const Q_LEVEL = Math.round(QUAY_LEVEL_M / HEIGHT_QUANTUM);

/**
 * Marks stone points in `flags` (one byte per lattice point, `latticeDim` per side; 1 = stone) from the padded
 * quantised lattice, and returns how many were marked.
 * @amortized once at load; only land within a few metres of the sea is examined
 */
export function findManMadeStone(padded: Int16Array, padDim: number, apron: number, latticeDim: number, flags: Uint8Array): number {
  const core = new Uint8Array(latticeDim * latticeDim);
  const dirs = [1, padDim, padDim + 1, padDim - 1];
  const reach = STONE_REACH_CELLS;
  for (let j = 0; j < latticeDim; j++) {
    for (let i = 0; i < latticeDim; i++) {
      const at = (j + apron) * padDim + i + apron;
      const h = padded[at];
      if (h < Q_SEA || h > Q_TOP) continue;
      let hit = false;
      for (let d = 0; d < 4 && !hit; d++) {
        const step = dirs[d];
        let forward = 0;
        let back = 0;
        for (let k = 1; k <= reach; k++) {
          if (forward === 0 && padded[at + k * step] < Q_SEA) forward = k;
          if (back === 0 && padded[at - k * step] < Q_SEA) back = k;
        }
        if (forward > 0 && back > 0) hit = true;
        else if (forward > 0 || back > 0) {
          // Sheer edge on one side with level ground behind it.
          const sign = forward > 0 ? 1 : -1;
          const k = forward > 0 ? forward : back;
          const drop = h - padded[at + sign * k * step];
          const behind = padded[at - sign * step];
          if (k <= 2 && drop >= Q_DROP * k && Math.abs(behind - h) <= Q_LEVEL) hit = true;
        }
      }
      if (hit) core[j * latticeDim + i] = 1;
    }
  }
  let count = 0;
  for (let j = 0; j < latticeDim; j++) {
    for (let i = 0; i < latticeDim; i++) {
      if (core[j * latticeDim + i] === 0) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= latticeDim || nj >= latticeDim) continue;
          const h = padded[(nj + apron) * padDim + ni + apron];
          if (h < Q_SEA || h > Q_TOP || flags[nj * latticeDim + ni] === 1) continue;
          flags[nj * latticeDim + ni] = 1;
          count++;
        }
      }
    }
  }
  return count;
}
