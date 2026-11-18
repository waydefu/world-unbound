import { HEIGHT_DIM } from './terrainTextures';

/**
 * Quadtree geometry shared by the CDLOD node selection and its tests (ADR-0003, spec G2.0 phase B).
 * The root node is the whole 4096 m square (level 6); leaves are 64 m (level 0). A node of level L is
 * `LEAF_SIZE << L` metres wide and is drawn with the same 32 x 32 quad patch, so a leaf has the 2 m
 * data spacing and level L has 2 m << L.
 */
export const LEAF_SIZE = 64;
/** Lattice cells (2 m) across a leaf. */
export const LEAF_CELLS = 32;
export const NODES_PER_SIDE = 64;
export const ROOT_LEVEL = 6;
export const LEVELS = ROOT_LEVEL + 1;
/** Quads per side of the shared grid patch. */
export const PATCH = 32;

/** Index of the first node of each level in the min/max pyramid (levels are stored coarse after fine). */
export const LEVEL_OFFSET = new Int32Array(LEVELS + 1);
for (let level = 0; level < LEVELS; level++) {
  LEVEL_OFFSET[level + 1] = LEVEL_OFFSET[level] + (NODES_PER_SIDE >> level) ** 2;
}
export const PYRAMID_NODES = LEVEL_OFFSET[LEVELS];

/** Width in metres of a node at `level`. */
export function nodeSize(level: number): number {
  return LEAF_SIZE << level;
}

/**
 * Min/max height pyramid: for every node (level-major, row-major inside a level) the lowest and highest
 * lattice height inside its footprint, as `[min, max]` pairs. Leaf footprints include their shared border
 * lattice points, so a mesh built on the lattice never leaves its node's box.
 * @amortized once at load
 */
export function buildHeightPyramid(heights: Float32Array, dim: number = HEIGHT_DIM, out?: Float32Array): Float32Array {
  const pyramid = out ?? new Float32Array(PYRAMID_NODES * 2);
  for (let lz = 0; lz < NODES_PER_SIDE; lz++) {
    for (let lx = 0; lx < NODES_PER_SIDE; lx++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = lz * LEAF_CELLS; j <= (lz + 1) * LEAF_CELLS; j++) {
        const row = j * dim;
        for (let i = lx * LEAF_CELLS; i <= (lx + 1) * LEAF_CELLS; i++) {
          const h = heights[row + i];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      const o = (lz * NODES_PER_SIDE + lx) * 2;
      pyramid[o] = lo;
      pyramid[o + 1] = hi;
    }
  }
  for (let level = 1; level < LEVELS; level++) {
    const side = NODES_PER_SIDE >> level;
    const childSide = side * 2;
    const base = LEVEL_OFFSET[level];
    const childBase = LEVEL_OFFSET[level - 1];
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < 4; k++) {
          const c = (childBase + (z * 2 + (k >> 1)) * childSide + x * 2 + (k & 1)) * 2;
          if (pyramid[c] < lo) lo = pyramid[c];
          if (pyramid[c + 1] > hi) hi = pyramid[c + 1];
        }
        pyramid[(base + z * side + x) * 2] = lo;
        pyramid[(base + z * side + x) * 2 + 1] = hi;
      }
    }
  }
  return pyramid;
}
