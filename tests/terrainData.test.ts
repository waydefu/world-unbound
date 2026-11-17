import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEIGHT_OFFSET, HEIGHT_QUANTUM, TERRAIN_VERSION } from '../src/world/constants';
import {
  TERRAIN_SAMPLES, TERRAIN_TILE_COUNT, TERRAIN_TILE_SAMPLES, decodeTile, installTerrain, terrainGrid, terrainInstalled,
} from '../src/world/terrainData';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'assets/manifests/terrain-hellesylt.json'), 'utf8')) as {
  quantum_m: number; offset_m: number; license: string; attribution: string; modifications: string; pipeline_version: string;
  grid: { samples: number; spacing_m: number; tile_samples: number };
  files: { path: string; sha256: string; origin: string; license: string; encoding: string; pipeline_version: string; bytes: number }[];
};

/** Reference encoder: the same row-delta scheme as scripts/terrain/bake-lib.mjs (deltaEncode). */
function encode(tile: Int16Array, dim: number): Uint8Array {
  const out = new Uint8Array(tile.length * 2);
  const view = new DataView(out.buffer);
  for (let j = 0; j < dim; j++) {
    let prev = 0;
    for (let i = 0; i < dim; i++) {
      const v = tile[j * dim + i];
      view.setInt16((j * dim + i) * 2, ((v - prev) << 16) >> 16, true);
      prev = v;
    }
  }
  return out;
}

describe('terrain tile codec', () => {
  it('decodes what the row-delta encoder wrote, including Int16 wrap-around', () => {
    const dim = TERRAIN_TILE_SAMPLES;
    const tile = new Int16Array(dim * dim);
    let seed = 7;
    for (let i = 0; i < tile.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      tile[i] = (seed >>> 16) - 32768; // full range, so deltas wrap
    }
    tile[0] = 32767;
    tile[1] = -32768;
    expect(decodeTile(encode(tile, dim))).toEqual(tile);
  });

  it('decodes at an unaligned byte offset and rejects wrong sizes', () => {
    const dim = TERRAIN_TILE_SAMPLES;
    const tile = new Int16Array(dim * dim).fill(-1234);
    const raw = encode(tile, dim);
    const shifted = new Uint8Array(raw.length + 1);
    shifted.set(raw, 1);
    expect(decodeTile(shifted.subarray(1))).toEqual(tile);
    expect(() => decodeTile(new Uint8Array(10))).toThrow();
  });

  it('installTerrain rejects a wrong tile count', () => {
    expect(() => installTerrain([new Int16Array(4)])).toThrow();
  });
});

describe('committed Hellesylt tiles', () => {
  it('has a complete manifest and every file is within the 2 MiB asset limit', () => {
    expect(manifest.files).toHaveLength(TERRAIN_TILE_COUNT);
    expect(manifest.license).toBe('CC-BY-4.0');
    expect(manifest.attribution).toContain('Kartverket');
    expect(manifest.modifications).toMatch(/^Modified:/);
    expect(manifest.grid).toMatchObject({ samples: TERRAIN_SAMPLES, spacing_m: 2, tile_samples: TERRAIN_TILE_SAMPLES });
    for (const f of manifest.files) {
      for (const field of ['path', 'sha256', 'origin', 'license', 'encoding', 'pipeline_version'] as const) {
        expect(f[field], `${f.path} ${field}`).toBeTruthy();
      }
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.encoding).toBe('int16-le row-delta, deflate-raw');
      const size = statSync(path.join(root, f.path)).size;
      expect(size).toBe(f.bytes);
      expect(size).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
  });

  it('declares the same quantisation as the world core', () => {
    expect(manifest.quantum_m).toBe(HEIGHT_QUANTUM);
    expect(manifest.offset_m).toBe(HEIGHT_OFFSET);
    expect(TERRAIN_VERSION).toBe(2);
  });

  it('is installed by the test setup with the sha256 of every file verified', () => {
    expect(terrainInstalled()).toBe(true);
    expect(terrainGrid?.length).toBe(TERRAIN_SAMPLES * TERRAIN_SAMPLES);
  });

  it('keeps a smooth, plausible surface: no Int16 saturation and bounded neighbour steps', () => {
    const grid = terrainGrid as Int16Array;
    const n = TERRAIN_SAMPLES;
    let steepest = 0;
    for (let j = 0; j < n; j += 3) {
      for (let i = 0; i < n - 1; i += 3) {
        const k = j * n + i;
        expect(grid[k]).toBeGreaterThan(-32768);
        expect(grid[k]).toBeLessThan(32767);
        steepest = Math.max(steepest, Math.abs(grid[k + 1] - grid[k]));
      }
    }
    // 2 m cell: even a 30 m cliff step would be 1500 quanta; real data stays below that.
    expect(steepest * manifest.quantum_m).toBeLessThan(40);
  });

  it('synthesises a smooth seabed (0.0275 d^2, then 0.55 d - 11, capped at 55 m) from the distance to land', () => {
    const grid = terrainGrid as Int16Array;
    const n = TERRAIN_SAMPLES;
    const h = (i: number, j: number): number => grid[j * n + i] * manifest.quantum_m + manifest.offset_m;
    const reach = 70; // cells; 0.55 * 140 m - 11 is already past the 55 m cap
    let seed = 99;
    let checked = 0;
    let shallow = 0;
    for (let tries = 0; tries < 4000 && checked < 60; tries++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const i = 100 + (seed % (n - 200));
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = 100 + (seed % (n - 200));
      if (h(i, j) > -3) continue;
      let best = Infinity;
      for (let dj = -reach; dj <= reach; dj++) {
        for (let di = -reach; di <= reach; di++) {
          if (h(i + di, j + dj) > -0.01) best = Math.min(best, Math.hypot(di, dj) * 2);
        }
      }
      const d = Math.max(0, best - 1);
      const expected = -Math.min(55, d < 20 ? 0.0275 * d * d : 0.55 * d - 11);
      expect(Math.abs(h(i, j) - expected)).toBeLessThan(0.05);
      checked++;
      if (expected > -50) shallow++;
    }
    expect(checked).toBeGreaterThanOrEqual(30);
    expect(shallow).toBeGreaterThan(0);
  });
});
