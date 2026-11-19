/**
 * Seeded value noise for the climate (pure, deterministic). Integer hashing with Math.imul only, so the
 * same seed gives bit-identical values on every JS engine; the shaping uses IEEE +, -, * (no trig).
 */
function hashU32(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function lattice1(i: number, seed: number): number {
  return hashU32(i, seed) / 4294967296;
}

function lattice2(i: number, j: number, seed: number): number {
  return hashU32(Math.imul(i | 0, 0x1b873593) ^ Math.imul(j | 0, 0x2545f491), seed) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth 1D value noise in [0, 1): one new random value per unit of `t`. */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const u = fade(t - i);
  const a = lattice1(i, seed);
  return a + (lattice1(i + 1, seed) - a) * u;
}

/** Smooth 2D value noise in [0, 1): one new random value per unit of x and z. */
export function noise2(x: number, z: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const u = fade(x - i);
  const v = fade(z - j);
  const a = lattice2(i, j, seed);
  const b = lattice2(i + 1, j, seed);
  const c = lattice2(i, j + 1, seed);
  const d = lattice2(i + 1, j + 1, seed);
  const top = a + (b - a) * u;
  return top + (c + (d - c) * u - top) * v;
}
