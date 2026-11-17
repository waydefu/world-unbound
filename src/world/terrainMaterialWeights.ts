import { smoothstep } from './hash';

/** Slope (normal.y) above which sand is faded out: 20 degrees. */
const SAND_FLAT = 0.94;
const SAND_STEEP = 0.88;

/**
 * Writes material weights for one vertex into out[0..2]: sand, rock, earth.
 * Grass = 1 - sum. Each in [0, 1], sum <= 1. Sand is a narrow strand just
 * above the waterline; earth (paving) is reserved for G2 and is 0 for now.
 * Seabed and lush/dry grass are derived in the shader.
 */
export function classifyTerrain(_x: number, _z: number, y: number, normalY: number, out: Float32Array): void {
  let sand = 1 - smoothstep(0.4, 1.6, y);
  const rock = smoothstep(0.86, 0.72, normalY);
  sand *= smoothstep(SAND_STEEP, SAND_FLAT, normalY);
  sand *= 1 - rock;
  out[0] = sand;
  out[1] = rock;
  out[2] = 0;
}
