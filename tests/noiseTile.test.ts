import { describe, expect, it } from 'vitest';
import { NOISE_TILE_SIZE, generateNoiseTile, periodicNoise } from '../src/world/noiseTile';

const N = NOISE_TILE_SIZE;
const tile = generateNoiseTile();
const at = (channel: number, i: number, j: number): number => tile[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4 + channel];

/** Mean |difference| between horizontally (or vertically) adjacent texels, optionally only across the wrap seam. */
function meanStep(channel: number, axis: 'x' | 'z', seamOnly: boolean): number {
  let sum = 0;
  let n = 0;
  for (let a = 0; a < N; a++) {
    for (let b = seamOnly ? N - 1 : 0; b < (seamOnly ? N : N - 1); b++) {
      sum += axis === 'x' ? Math.abs(at(channel, b + 1, a) - at(channel, b, a)) : Math.abs(at(channel, a, b + 1) - at(channel, a, b));
      n++;
    }
  }
  return sum / n;
}

describe('generateNoiseTile', () => {
  it('has the right size and is deterministic', () => {
    expect(tile.length).toBe(N * N * 4);
    const again = generateNoiseTile();
    expect(again).toEqual(tile);
  });

  it('uses the full range of every channel without saturating the slopes', () => {
    for (let c = 0; c < 4; c++) {
      let min = 255;
      let max = 0;
      let saturated = 0;
      for (let k = 0; k < N * N; k++) {
        const v = tile[k * 4 + c];
        if (v < min) min = v;
        if (v > max) max = v;
        if (v === 0 || v === 255) saturated++;
      }
      expect(max - min).toBeGreaterThan(150);
      if (c < 2) expect(saturated / (N * N)).toBeLessThan(0.002);
    }
  });

  it('tiles seamlessly: steps across the wrap seam match steps inside the tile', () => {
    for (const channel of [0, 1, 2, 3]) {
      for (const axis of ['x', 'z'] as const) {
        const inside = meanStep(channel, axis, false);
        const seam = meanStep(channel, axis, true);
        expect(seam).toBeLessThan(inside * 1.5 + 0.5);
      }
    }
  });

  it('keeps R and G consistent with the slope of B', () => {
    // B rises towards +x where R > 128: compare against a wide finite difference of B.
    let agree = 0;
    let total = 0;
    for (let j = 0; j < N; j += 3) {
      for (let i = 0; i < N; i += 3) {
        const slope = at(2, i + 2, j) - at(2, i - 2, j);
        const r = at(0, i, j) - 127.5;
        if (Math.abs(slope) > 4 && Math.abs(r) > 6) {
          total++;
          if (slope > 0 === r > 0) agree++;
        }
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(agree / total).toBeGreaterThan(0.95);
  });
});

describe('periodicNoise', () => {
  it('wraps at its period and stays in [0, 1)', () => {
    for (let i = 0; i < 40; i++) {
      const x = i * 0.37;
      const z = i * 0.91;
      const v = periodicNoise(x, z, 8, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(periodicNoise(x + 8, z, 8, 7)).toBeCloseTo(v, 12);
      expect(periodicNoise(x, z + 8, 8, 7)).toBeCloseTo(v, 12);
    }
  });
});
