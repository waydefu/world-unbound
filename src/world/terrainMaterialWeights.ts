import { WORLD_SEED } from './constants';
import { fbm, smoothstep } from './hash';
import { townMask } from './terrainShape';

/**
 * Writes material weights for one vertex into out[0..2]: sand, rock, earth
 * (town ground). Grass = 1 - sum. Each in [0, 1], sum <= 1. Seabed and
 * lush/dry grass are derived in the shader.
 */
export function classifyTerrain(x: number, z: number, y: number, normalY: number, out: Float32Array): void {
  const patch = fbm(x / 37, z / 37, 3, WORLD_SEED + 21);
  let sand = 1 - smoothstep(1.3, 2.4, y + (patch - 0.5) * 0.8);
  const rock = smoothstep(0.86, 0.72, normalY);
  sand *= 1 - rock;
  const town = townMask(x, z, 30) * 0.85;
  sand *= 1 - town;
  const rockFinal = rock * (1 - town);
  out[0] = sand;
  out[1] = rockFinal;
  out[2] = town;
}
