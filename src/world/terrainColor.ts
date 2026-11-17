import { WORLD_SEED } from './constants';
import { fbm, smoothstep } from './hash';
import { townMask } from './terrainShape';

/**
 * Procedural ground albedo (linear-sRGB, 0..1) from height, slope and zone.
 * Placeholder palette for the engine milestone; weathering/wetness arrive
 * with the PBR material system.
 */
const SEABED = [0.105, 0.118, 0.098];
const SAND = [0.52, 0.45, 0.31];
const GRASS_DRY = [0.21, 0.24, 0.085];
const GRASS_LUSH = [0.075, 0.16, 0.045];
const ROCK = [0.2, 0.19, 0.175];
const EARTH = [0.19, 0.15, 0.105];

function blend(out: Float32Array, c: readonly number[], w: number): void {
  out[0] += (c[0] - out[0]) * w;
  out[1] += (c[1] - out[1]) * w;
  out[2] += (c[2] - out[2]) * w;
}

export function shadeTerrain(x: number, z: number, y: number, normalY: number, out: Float32Array): void {
  const patch = fbm(x / 37, z / 37, 3, WORLD_SEED + 21);
  out[0] = GRASS_DRY[0];
  out[1] = GRASS_DRY[1];
  out[2] = GRASS_DRY[2];
  blend(out, GRASS_LUSH, smoothstep(0.35, 0.65, patch));
  blend(out, SAND, 1 - smoothstep(1.3, 2.4, y + (patch - 0.5) * 0.8));
  blend(out, SEABED, 1 - smoothstep(-2.2, -0.2, y));
  blend(out, ROCK, smoothstep(0.86, 0.72, normalY));
  blend(out, EARTH, townMask(x, z, 30) * 0.85);
  const grain = 0.86 + 0.28 * fbm(x / 5.3, z / 5.3, 2, WORLD_SEED + 22);
  out[0] *= grain;
  out[1] *= grain;
  out[2] *= grain;
}
