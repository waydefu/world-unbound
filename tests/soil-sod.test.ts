import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseParams } from '../src/app/params';
import { decodeCrownAtlas } from '../src/render/sodCrown';
import {
  sodBarycentric, sodCrownCount, sodHash, sodTriangleSeed, sodWorldAxis, SOD_LEAVES_PER_CROWN, SOD_LEAVES_PER_M2,
} from '../src/world/sodRoots';
import { buildSoilMap, SoilWaterGrid } from '../src/world/soilWater';

const sum = (a: Float32Array) => a.reduce((s, x) => s + x, 0);

describe('Hellesylt surface water', () => {
  it('balances rainfall, evapotranspiration, percolation and both runoff destinations', () => {
    const grid = new SoilWaterGrid(buildSoilMap(new Uint8Array([2, 1, 0, 2]),
      new Float32Array([6, 5, 0, 3]), 2));
    const start = sum(grid.state);
    let external = 0;
    let exported = 0;
    for (let i = 0; i < 300; i++) {
      const f = grid.step(30, i < 240 ? 33 : 0, 0.25);
      external += f.rain - f.evaporated - f.drainage - f.exported;
      exported += f.exported;
    }
    expect(exported).toBeGreaterThan(0);
    expect(Math.abs(sum(grid.state) - start - external)).toBeLessThan(0.002);
    expect(grid.state.every(x => x >= 0 && Number.isFinite(x))).toBe(true);
  });

  it('stores, drains and dries by soil profile, and can restore a worker checkpoint', () => {
    const grid = new SoilWaterGrid(buildSoilMap(new Uint8Array([1, 2, 0, 0]), new Float32Array([3, 3, 3, 3]), 2));
    for (let i = 0; i < 120; i++) grid.step(60, 30, 0.04);
    expect(grid.state[3] / 80).toBeGreaterThan(grid.state[0] / 180);
    const wet = sum(grid.state);
    const restored = new SoilWaterGrid(grid.map, grid.state.slice());
    for (let i = 0; i < 360; i++) restored.step(60, 0, 0.45);
    expect(sum(restored.state)).toBeLessThan(wet);
    expect(restored.state[2] + restored.state[5]).toBeLessThan(grid.state[2] + grid.state[5]);
    const pixels = new Uint8Array(16);
    restored.pack(pixels);
    expect(pixels[3]).toBe(255);
    expect(pixels.slice(8)).toEqual(new Uint8Array(8));
    expect(parseParams('?soil=drained').soilPreview).toBe('drained');
    expect(parseParams('?soil=unknown').soilPreview).toBeNull();
  });
});

describe('world-space grass crowns', () => {
  it('preserves the 79,524-leaf density within 5% in 256 true square-metre windows, including slope and grid seams', () => {
    const uv = new Float64Array(2);
    let tested = 0;
    let lowest = Number.POSITIVE_INFINITY;
    let highest = 0;
    for (const [caseId, grade] of [0, 0.33, 0.7, 1].entries()) {
      const count = sodCrownCount(grade * 2, 0);
      const entries: { x: Float32Array; z: Float32Array }[] = [];
      for (let z = 1023; z <= 1025; z++) {
        for (let x = 1023; x <= 1025; x++) {
          const positions = { x: new Float32Array(2 * count), z: new Float32Array(2 * count) };
          for (let tri = 0; tri < 2; tri++) {
            const seed = sodTriangleSeed(x, z, tri);
            for (let i = 0; i < count; i++) {
              sodBarycentric(i, seed, uv);
              positions.x[tri * count + i] = sodWorldAxis(x, uv[0], tri);
              positions.z[tri * count + i] = sodWorldAxis(z, uv[1], tri);
            }
          }
          entries.push(positions);
        }
      }

      const width = 1 / Math.hypot(1, grade);
      for (let i = 0; i < 64; i++) {
        const x = i === 0 ? -0.5 : -1.8 + 4.4 * sodHash(i + 417 * caseId) / 0x100000000;
        const z = i === 0 ? -0.5 : -1.8 + 4.4 * sodHash(i + 32791 + 731 * caseId) / 0x100000000;
        const xe = x + width;
        const ze = z + 1;
        let leafCount = 0;
        for (const entry of entries) {
          for (let j = 0; j < entry.x.length; j++) {
            if (entry.x[j] >= x && entry.x[j] < xe && entry.z[j] >= z && entry.z[j] < ze) leafCount += SOD_LEAVES_PER_CROWN;
          }
        }
        lowest = Math.min(lowest, leafCount);
        highest = Math.max(highest, leafCount);
        tested++;
      }
    }
    expect(tested).toBe(256);
    expect(lowest).toBeGreaterThanOrEqual(SOD_LEAVES_PER_M2 * 0.95);
    expect(highest).toBeLessThanOrEqual(SOD_LEAVES_PER_M2 * 1.05);
    console.log(`256 square metres: ${lowest}–${highest} native leaves`);
  });

  it('loads 16 native variants with nine connected leaves and preserved root offsets', () => {
    const path = fileURLToPath(new URL('../assets/grass/sod-crowns.bin', import.meta.url));
    const atlas = decodeCrownAtlas(readFileSync(path).slice().buffer);
    expect(atlas.length).toBe(16 * 4 * 171 * 4);
    expect(atlas.every(Number.isFinite)).toBe(true);
    const row = 171 * 4;
    for (let variant = 0; variant < 16; variant++) {
      const offset = variant * row * 4;
      for (let leaf = 0; leaf < 9; leaf++) {
        const centre = offset + (leaf * 19 + 1) * 4;
        expect(atlas[centre + row * 3]).toBe(atlas[centre]);
        expect(atlas[centre + row * 3 + 1]).toBe(atlas[centre + 1]);
        expect(atlas[centre + row * 3 + 2]).toBe(atlas[centre + 2]);
      }
    }
  });
});
