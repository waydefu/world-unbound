import { WORLD_MIN } from './constants';

export const SOD_LEAVES_PER_CROWN = 9;
export const SOD_CROWNS_PER_M2 = 8_836;
export const SOD_LEAVES_PER_M2 = SOD_CROWNS_PER_M2 * SOD_LEAVES_PER_CROWN;
export const SOD_TRIANGLE_M = 2;
export const SOD_ROOT_INSET_M = 0.002;

/** Stable integer scrambling for a triangle and its progressive equal-area sample sequence. @hot */
export function sodHash(value: number): number {
  let n = value | 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return (n ^ (n >>> 15)) >>> 0;
}

/** An independent seed for each authoritative triangle, including negative map coordinates. @hot */
export function sodTriangleSeed(ix: number, iz: number, upper: number): number {
  return sodHash(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ (upper * 83492791));
}

/** Count crowns against surface area rather than the horizontal projection. @hot */
export function sodCrownCount(heightX: number, heightZ: number): number {
  return Math.round(2 * Math.hypot(1, heightX * 0.5, heightZ * 0.5) * SOD_CROWNS_PER_M2);
}

/**
 * Basu–Owen-style base-four traversal of the four equal-area child triangles.
 * The least significant index digits select the coarsest children, so prefixes preserve coverage.
 * Returning the child centroid at depth 3 also supports rejecting subtrees outside the near range.
 * @hot
 */
export function sodBarycentric(index: number, seed: number, out: Float64Array, depth = 9): void {
  let scale = 1;
  let u = 0;
  let v = 0;
  for (let level = 0; level < depth; level++) {
    const child = (index ^ seed) & 3;
    index >>>= 2;
    seed >>>= 2;
    const half = scale * 0.5;
    if (child === 1 || child === 3) u += half;
    if (child === 2 || child === 3) v += half;
    scale = child === 3 ? -half : half;
  }
  out[0] = u + scale / 3;
  out[1] = v + scale / 3;
}

/** Converts the same local triangle coordinates to either side of the terrain lattice diagonal. @hot */
export function sodWorldAxis(cell: number, fraction: number, upper: number): number {
  return WORLD_MIN + (cell + (upper ? 1 - fraction : fraction)) * SOD_TRIANGLE_M;
}
