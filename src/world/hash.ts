/**
 * Deterministic integer hashing and value noise.
 * Only uses Math.imul, floor and IEEE +,-,* so results are bit-identical across
 * JS engines; Math.sin/cos/pow are intentionally avoided in authoritative code.
 */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function lattice(ix: number, iz: number, seed: number): number {
  return hash2(ix, iz, seed) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/** Fractal value noise in [0, 1). Lacunarity 2, gain 0.5. */
export function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let fx = x;
  let fz = z;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(fx, fz, seed + o * 1013);
    norm += amplitude;
    amplitude *= 0.5;
    // Offset each octave to hide lattice alignment.
    fx = fx * 2 + 17.31;
    fz = fz * 2 - 9.73;
  }
  return sum / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** FNV-1a over an Int16Array, for golden determinism checks. */
export function fnv1a16(data: Int16Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] & 0xffff;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 8), 0x01000193);
  }
  return h >>> 0;
}
