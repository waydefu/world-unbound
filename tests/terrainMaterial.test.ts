import { describe, expect, it } from 'vitest';
import { CHUNK_SAMPLES, TOWN_X, TOWN_Z, WORLD_MAX, WORLD_MIN } from '../src/world/constants';
import { lodSide } from '../src/world/chunkGrid';
import { runTerrainJob } from '../src/world/terrainJob';
import { AO_APRON, AO_DIM, vertexAo } from '../src/world/terrainAo';
import { classifyTerrain } from '../src/world/terrainMaterialWeights';

const out = new Float32Array(3);

describe('classifyTerrain', () => {
  it('is deterministic and keeps weights in [0, 1] with sum <= 1', () => {
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    for (let j = 0; j < 50; j++) {
      for (let i = 0; i < 50; i++) {
        const x = WORLD_MIN + ((WORLD_MAX - WORLD_MIN) * i) / 49;
        const z = WORLD_MIN + ((WORLD_MAX - WORLD_MIN) * j) / 49;
        const y = (i % 7) - 2;
        const ny = 0.5 + (j % 10) * 0.05;
        classifyTerrain(x, z, y, ny, a);
        classifyTerrain(x, z, y, ny, b);
        expect(Array.from(a)).toEqual(Array.from(b));
        for (let k = 0; k < 3; k++) {
          expect(a[k]).toBeGreaterThanOrEqual(0);
          expect(a[k]).toBeLessThanOrEqual(1);
        }
        expect(a[0] + a[1] + a[2]).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('classifies beach as sand, steep slopes as rock and the town centre as earth', () => {
    classifyTerrain(900, 900, 0.5, 1, out);
    expect(out[0]).toBeGreaterThan(0.5);
    classifyTerrain(900, 900, 20, 0.6, out);
    expect(out[1]).toBeGreaterThan(0.95);
    classifyTerrain(TOWN_X, TOWN_Z, 1.6, 1, out);
    expect(out[2]).toBeGreaterThanOrEqual(0.8);
  });
});

describe('vertexAo', () => {
  const flat = new Int16Array(AO_DIM * AO_DIM);

  it('is 1 on a flat tile', () => {
    expect(Math.abs(vertexAo(flat, AO_DIM, AO_APRON, 16, 16) - 1)).toBeLessThan(1e-6);
  });

  it('darkens the bottom of a deep pit and stays within [0.25, 1]', () => {
    const pit = new Int16Array(AO_DIM * AO_DIM).fill(1000); // 10 m
    pit[(16 + AO_APRON) * AO_DIM + (16 + AO_APRON)] = 0;
    expect(vertexAo(pit, AO_DIM, AO_APRON, 16, 16)).toBeLessThan(0.6);
    for (let j = 0; j < CHUNK_SAMPLES; j++) {
      for (let i = 0; i < CHUNK_SAMPLES; i++) {
        const ao = vertexAo(pit, AO_DIM, AO_APRON, i, j);
        expect(ao).toBeGreaterThanOrEqual(0.25);
        expect(ao).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('built chunk colours', () => {
  it('has baked AO below 1 on a chunk with relief and skirts copy their source RGBA', () => {
    const result = runTerrainJob({ slot: 0, seq: 0, cx: 6, cz: 5, lod: 0 });
    const n = lodSide(0);
    const c = result.colors;
    let darker = false;
    for (let v = 0; v < n * n; v++) if (c[v * 4 + 3] < 255) darker = true;
    expect(darker).toBe(true);
    // Skirts: side*n + s, source edge vertex per buildLodIndices' walk order.
    const last = n - 1;
    const src = (side: number, s: number): number =>
      side === 0 ? s : side === 1 ? s * n + last : side === 2 ? last * n + (last - s) : (last - s) * n;
    for (let side = 0; side < 4; side++) {
      for (let s = 0; s < n; s++) {
        const dst = n * n + side * n + s;
        const from = src(side, s);
        for (let k = 0; k < 4; k++) expect(c[dst * 4 + k]).toBe(c[from * 4 + k]);
      }
    }
  });
});
