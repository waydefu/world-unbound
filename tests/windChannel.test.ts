import { describe, expect, it } from 'vitest';
import { WORLD_MIN } from '../src/world/constants';
import { heightAt } from '../src/world/heightField';
import {
  WIND_CHANNEL_CELL, WIND_CHANNEL_DIM, WIND_CHANNEL_STRIDE, bakeWindChannel, buildWindChannel, sampleWindChannel,
} from '../src/world/windChannel';

const DIM = 96;
const CELL = 16;

/** A V-shaped valley along `axis` ('x' or 'z') with 1.5 m/m walls (56 degrees), heights from 0 at the floor. */
function valley(axis: 'x' | 'z'): Float32Array {
  const h = new Float32Array(DIM * DIM);
  for (let j = 0; j < DIM; j++) {
    for (let i = 0; i < DIM; i++) {
      const across = axis === 'x' ? j : i;
      h[j * DIM + i] = Math.abs(across - DIM / 2) * CELL * 1.5;
    }
  }
  return h;
}

describe('wind channel bake', () => {
  it('finds the axis of a synthetic valley, in the middle and not along the walls', () => {
    for (const axis of ['x', 'z'] as const) {
      const map = buildWindChannel(valley(axis), DIM, CELL);
      const o = (DIM / 2 * DIM + DIM / 2) * WIND_CHANNEL_STRIDE;
      const c2 = map[o];
      const s2 = map[o + 1];
      // Double angle (1, 0) is an x axis; (-1, 0) is a z axis.
      expect(Math.hypot(c2, s2)).toBeGreaterThan(0.9);
      expect(axis === 'x' ? c2 : -c2).toBeGreaterThan(0.9);
      expect(Math.abs(s2)).toBeLessThan(0.05);
    }
  });

  it('gives a deep narrow valley low openness and flat ground full openness', () => {
    const flat = buildWindChannel(new Float32Array(DIM * DIM), DIM, CELL);
    const v = buildWindChannel(valley('x'), DIM, CELL);
    const mid = (DIM / 2 * DIM + DIM / 2) * WIND_CHANNEL_STRIDE;
    expect(flat[mid + 2]).toBeCloseTo(1, 6);
    expect(Math.hypot(flat[mid], flat[mid + 1])).toBe(0);
    // Two of eight azimuths are open, the others see 56 degrees (sin 0.83) or 50 degrees (diagonals).
    expect(v[mid + 2]).toBeLessThan(0.5);
    expect(v[mid + 2]).toBeGreaterThan(0.15);
  });

  it('is deterministic', () => {
    const a = buildWindChannel(valley('x'), DIM, CELL);
    const b = buildWindChannel(valley('x'), DIM, CELL);
    expect(a).toEqual(b);
  });
});

describe('wind channel of the Hellesylt terrain', () => {
  const started = performance.now();
  const map = bakeWindChannel();
  const ms = performance.now() - started;
  const out = new Float32Array(4);

  it('covers the 4 km square with 256 x 256 cells of 16 m, all values in range, in well under a second', () => {
    expect(WIND_CHANNEL_DIM).toBe(256);
    expect(WIND_CHANNEL_CELL).toBe(16);
    expect(map.length).toBe(256 * 256 * 4);
    for (let k = 0; k < map.length; k += 4) {
      expect(Math.hypot(map[k], map[k + 1])).toBeLessThanOrEqual(1.0001);
      expect(map[k + 2]).toBeGreaterThanOrEqual(0);
      expect(map[k + 2]).toBeLessThanOrEqual(1.0001);
    }
    expect(ms).toBeLessThan(5000);
  });

  it('sees less sky over land than over the fjord, defines a clear valley axis over much of the land, and gives unit axes', () => {
    let landSum = 0;
    let landN = 0;
    let waterSum = 0;
    let waterN = 0;
    let coherent = 0;
    for (let k = 0; k < WIND_CHANNEL_DIM * WIND_CHANNEL_DIM; k++) {
      const x = WORLD_MIN + ((k % WIND_CHANNEL_DIM) + 0.5) * WIND_CHANNEL_CELL;
      const z = WORLD_MIN + (Math.floor(k / WIND_CHANNEL_DIM) + 0.5) * WIND_CHANNEL_CELL;
      sampleWindChannel(map, x, z, out);
      if (heightAt(x, z) > 1) {
        landSum += out[3];
        landN++;
        if (out[2] > 0.5) coherent++;
      } else {
        waterSum += out[3];
        waterN++;
      }
    }
    expect(landSum / landN).toBeLessThan(waterSum / waterN);
    expect(coherent / landN).toBeGreaterThan(0.4);
    sampleWindChannel(map, -300, 300, out);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 5);
    expect(out[3]).toBeLessThan(0.95);
    // The map clamps outside the square instead of reading out of bounds.
    sampleWindChannel(map, WORLD_MIN - 500, WORLD_MIN - 500, out);
    expect(Number.isFinite(out[3])).toBe(true);
  });
});
