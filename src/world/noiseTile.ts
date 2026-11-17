import { hash2 } from './hash';

/**
 * Tileable noise texture data shared by the ocean and the terrain shaders (G1.4.1).
 *
 * RGBA8, `size` x `size`, every channel periodic in both axes:
 *   R, G  surface slope (dh/dx, dh/dz) of the height field B, centred on 128 (decode: c * 2 - 1,
 *         dimensionless; rms about 0.3, so a decoded slope is "unit-ish" and the shader scales it);
 *   B     the periodic multi-octave height itself, stretched to the full 0..255 range;
 *   A     an independent periodic value noise for breakup and grain, contrast-stretched around 0.5.
 * Row j is the +z direction and column i the +x direction.
 */
export const NOISE_TILE_SIZE = 256;
const HEIGHT_SEED = 0x5eed1;
const GRAIN_SEED = 0xa11ce;
/** Lattice cells across the tile for the first octave; every octave doubles it (all wrap at the tile edge). */
const BASE_CELLS = 4;
const HEIGHT_OCTAVES = 5;
const HEIGHT_GAIN = 0.5;
const GRAIN_OCTAVES = 3;
/** Decoded slope reaches +-1 at this many rms. */
const SLOPE_RMS_RANGE = 3.5;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Value noise in [0, 1) whose lattice wraps every `period` cells, so the field tiles with period `period`. */
export function periodicNoise(x: number, z: number, period: number, seed: number): number {
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const u = fade(x - fx);
  const v = fade(z - fz);
  const x0 = ((fx % period) + period) % period;
  const z0 = ((fz % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const z1 = (z0 + 1) % period;
  const a = hash2(x0, z0, seed) / 4294967296;
  const b = hash2(x1, z0, seed) / 4294967296;
  const c = hash2(x0, z1, seed) / 4294967296;
  const d = hash2(x1, z1, seed) / 4294967296;
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/** Periodic fractal value noise in [0, 1): `octaves` octaves, lacunarity 2, the given gain. */
function periodicFbm(i: number, j: number, size: number, octaves: number, gain: number, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let cells = BASE_CELLS;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * periodicNoise((i * cells) / size, (j * cells) / size, cells, seed + o * 1013);
    norm += amplitude;
    amplitude *= gain;
    cells *= 2;
  }
  return sum / norm;
}

const toByte = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

/**
 * Generates the tile (deterministic: integer hashing and IEEE arithmetic only).
 * @amortized once at startup: ~0.5 M value-noise evaluations
 */
export function generateNoiseTile(size = NOISE_TILE_SIZE): Uint8Array {
  const count = size * size;
  const height = new Float32Array(count);
  const grain = new Float32Array(count);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = periodicFbm(i, j, size, HEIGHT_OCTAVES, HEIGHT_GAIN, HEIGHT_SEED);
      height[j * size + i] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
      grain[j * size + i] = periodicFbm(i, j, size, GRAIN_OCTAVES, 0.6, GRAIN_SEED);
    }
  }
  const hScale = 1 / (hMax - hMin);
  // Central differences on the wrapped grid, in height per tile (the texel step is 1 / size of the tile).
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  let sumSq = 0;
  for (let j = 0; j < size; j++) {
    const jm = ((j - 1 + size) % size) * size;
    const jp = ((j + 1) % size) * size;
    for (let i = 0; i < size; i++) {
      const im = (i - 1 + size) % size;
      const ip = (i + 1) % size;
      const dx = ((height[j * size + ip] - height[j * size + im]) * hScale * size) / 2;
      const dz = ((height[jp + i] - height[jm + i]) * hScale * size) / 2;
      gx[j * size + i] = dx;
      gz[j * size + i] = dz;
      sumSq += dx * dx + dz * dz;
    }
  }
  const slopeScale = 1 / (SLOPE_RMS_RANGE * Math.sqrt(sumSq / (2 * count)));
  let gMin = Infinity;
  let gMax = -Infinity;
  for (let k = 0; k < count; k++) {
    if (grain[k] < gMin) gMin = grain[k];
    if (grain[k] > gMax) gMax = grain[k];
  }
  const out = new Uint8Array(count * 4);
  for (let k = 0; k < count; k++) {
    out[k * 4] = toByte(0.5 + 0.5 * gx[k] * slopeScale);
    out[k * 4 + 1] = toByte(0.5 + 0.5 * gz[k] * slopeScale);
    out[k * 4 + 2] = toByte((height[k] - hMin) * hScale);
    out[k * 4 + 3] = toByte((grain[k] - gMin) / (gMax - gMin));
  }
  return out;
}
