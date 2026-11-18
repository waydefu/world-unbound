/** Pure helpers of the CDLOD node selection (world/cdlod.ts): distance ranges, morph bands, frustum planes, edge codes. */

/** Distance (m) at which level `level` stops being drawn: `lod0Distance` doubled per level. */
export function lodRange(lod0Distance: number, level: number): number {
  return lod0Distance * 2 ** level;
}

/** Distance at which level `level` starts morphing towards its parent: the last 30 % of its band. */
export function morphStart(lod0Distance: number, level: number): number {
  if (level === 0) return 0.7 * lod0Distance;
  const inner = lodRange(lod0Distance, level - 1);
  return inner + 0.7 * (lodRange(lod0Distance, level) - inner);
}

/** Distance at which a level has fully morphed to its parent's grid. */
export function morphEnd(lod0Distance: number, level: number): number {
  return lodRange(lod0Distance, level);
}

/**
 * Six frustum planes (inside is `n . p + d >= 0`) as `(nx, ny, nz, d)` from a column-major clip matrix
 * (projection x view). Normalised. The planes live in whatever space the matrix maps from.
 * @hot
 */
export function frustumPlanes(m: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1;
    const sign = (p & 1) === 0 ? 1 : -1;
    let a = m[3] + sign * m[axis];
    let b = m[7] + sign * m[4 + axis];
    let c = m[11] + sign * m[8 + axis];
    let d = m[15] + sign * m[12 + axis];
    const inv = 1 / Math.hypot(a, b, c);
    a *= inv;
    b *= inv;
    c *= inv;
    d *= inv;
    out[p * 4] = a;
    out[p * 4 + 1] = b;
    out[p * 4 + 2] = c;
    out[p * 4 + 3] = d;
  }
  return out;
}

/** Edge relation codes in `edges`: 0 same level, 1 neighbour one level coarser, 2 one level finer. */
export const EDGE_SAME = 0;
export const EDGE_COARSER = 1;
export const EDGE_FINER = 2;

/** Decodes one edge (0 north = -z, 1 east, 2 south, 3 west) from a node's packed edge code. */
export function edgeState(code: number, edge: number): number {
  return Math.floor(code / 3 ** edge) % 3;
}
