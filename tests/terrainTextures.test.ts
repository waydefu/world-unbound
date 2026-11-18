import { describe, expect, it } from 'vitest';
import { CELL_SIZE, CHUNK_CELLS, CHUNK_SAMPLES, TOWN_X, TOWN_Z, WORLD_MIN } from '../src/world/constants';
import { slotOf } from '../src/world/chunkGrid';
import { heightAt } from '../src/world/heightField';
import {
  HEIGHT_DIM, buildHeightTexture, buildMaterialTexture, buildTerrainTextures, materialDim, terrainTextureBytes,
} from '../src/world/terrainTextures';
import { classifyTerrain } from '../src/world/terrainMaterialWeights';
import { runTerrainJob } from '../src/world/terrainJob';
import { FloatType, LinearMipmapLinearFilter, NearestFilter, RedFormat, UnsignedByteType } from 'three/webgpu';
import { createTerrainTextures } from '../src/render/terrainTextures';

const started = performance.now();
const height = buildHeightTexture();
const material = buildMaterialTexture(1);
const buildMs = performance.now() - started;

/** Texel index of world coordinate `w` (a lattice point). */
const texel = (w: number): number => (w - WORLD_MIN) / CELL_SIZE;

describe('terrain height texture', () => {
  it('has one texel per lattice point of the 4 km square, inclusive (2049 per side)', () => {
    expect(HEIGHT_DIM).toBe(2049);
    expect(height.length).toBe(HEIGHT_DIM * HEIGHT_DIM);
    expect(materialDim(1)).toBe(2049);
    expect(materialDim(2)).toBe(1025);
  });

  it('equals heightAt (to f32 rounding) at lattice points', () => {
    const points: Array<[number, number]> = [
      [WORLD_MIN, WORLD_MIN], [0, 0], [TOWN_X, TOWN_Z], [-2046, 2046], [2046, -2046], [1000, 1000], [-644, 312],
    ];
    for (let n = 0; n < 400; n++) points.push([WORLD_MIN + 2 * ((n * 97) % 2048), WORLD_MIN + 2 * ((n * 389 + 5) % 2048)]);
    for (const [x, z] of points) {
      expect(height[texel(z) * HEIGHT_DIM + texel(x)]).toBe(Math.fround(heightAt(x, z)));
    }
  });

  it('holds the open-water value in the last row and column, which lie outside the baked square', () => {
    for (let k = 0; k < HEIGHT_DIM; k += 64) {
      expect(height[(HEIGHT_DIM - 1) * HEIGHT_DIM + k]).toBeCloseTo(-55, 5);
      expect(height[k * HEIGHT_DIM + HEIGHT_DIM - 1]).toBeCloseTo(-55, 5);
    }
    expect(height[0]).toBe(Math.fround(heightAt(WORLD_MIN, WORLD_MIN)));
  });
});

describe('terrain material texture', () => {
  it('is RGBA8 with one texel per lattice point and builds in a few seconds at most', () => {
    expect(material.length).toBe(HEIGHT_DIM * HEIGHT_DIM * 4);
    // Report only; the 1.5 s target is for the worker on desktop hardware.
    expect(buildMs).toBeLessThan(20000);
  });

  it('writes exactly the chunk path vertex colours (weights and AO) for LOD 0 chunks, edge chunks included', () => {
    for (const [cx, cz] of [[0, 0], [-1, -1], [5, -7], [-32, -32], [31, 31], [31, -3], [-20, 31]]) {
      const colors = runTerrainJob({ slot: slotOf(cx, cz), seq: 1, cx, cz, lod: 0 }).colors;
      for (let j = 0; j < CHUNK_SAMPLES; j++) {
        for (let i = 0; i < CHUNK_SAMPLES; i++) {
          const tx = cx * CHUNK_CELLS + 1024 + i;
          const tz = cz * CHUNK_CELLS + 1024 + j;
          const o = (tz * HEIGHT_DIM + tx) * 4;
          const v = (j * CHUNK_SAMPLES + i) * 4;
          expect([material[o], material[o + 1], material[o + 2], material[o + 3]]).toEqual(
            [colors[v], colors[v + 1], colors[v + 2], colors[v + 3]],
          );
        }
      }
    }
  });

  it('classifies a flat beach texel as sand and a steep wall as rock (classifyTerrain at sample points)', () => {
    const out = new Float32Array(3);
    classifyTerrain(900, 900, 0.5, 1, out);
    expect(out[0]).toBeGreaterThan(0.5);
    let rock = 0;
    for (let k = 0; k < material.length; k += 4 * 4099) if (material[k + 1] > 200) rock++;
    expect(rock).toBeGreaterThan(0);
    // Weights never exceed one in total (rounding aside) and AO stays in [0.25, 1].
    for (let k = 0; k < material.length; k += 4 * 1009) {
      expect(material[k] + material[k + 1] + material[k + 2]).toBeLessThanOrEqual(256);
      expect(material[k + 3]).toBeGreaterThanOrEqual(63);
    }
  });

  it('the low-tier 4 m texture is every second texel of the 2 m one', () => {
    const coarse = buildMaterialTexture(2);
    const dim = materialDim(2);
    expect(coarse.length).toBe(dim * dim * 4);
    for (let n = 0; n < 300; n++) {
      const i = (n * 131) % dim;
      const j = (n * 71 + 3) % dim;
      const a = (j * dim + i) * 4;
      const b = (2 * j * HEIGHT_DIM + 2 * i) * 4;
      expect(Array.from(coarse.subarray(a, a + 4))).toEqual(Array.from(material.subarray(b, b + 4)));
    }
  });
});

describe('terrain texture build', () => {
  it('buildTerrainTextures returns both arrays and reports byte sizes with the mip chain', () => {
    const data = buildTerrainTextures(2);
    expect(data.height.length).toBe(HEIGHT_DIM * HEIGHT_DIM);
    expect(data.material.length).toBe(1025 * 1025 * 4);
    expect(data.materialStep).toBe(2);
    expect(terrainTextureBytes(1).height).toBe(HEIGHT_DIM * HEIGHT_DIM * 4);
    expect(terrainTextureBytes(2).material).toBeLessThan(terrainTextureBytes(1).material / 3);
  });
});

describe('terrain texture upload objects', () => {
  const textures = createTerrainTextures({ height, material, materialStep: 1, ms: 0 });

  it('height is nearest-filtered R32F without mipmaps (read by texel fetch only)', () => {
    const t = textures.height;
    expect(t.type).toBe(FloatType);
    expect(t.format).toBe(RedFormat);
    expect(t.magFilter).toBe(NearestFilter);
    expect(t.minFilter).toBe(NearestFilter);
    expect(t.generateMipmaps).toBe(false);
    expect(t.image.width).toBe(HEIGHT_DIM);
  });

  it('material is RGBA8, linearly filtered with mipmaps, and accounted with its mip chain', () => {
    const t = textures.material;
    expect(t.type).toBe(UnsignedByteType);
    expect(t.minFilter).toBe(LinearMipmapLinearFilter);
    expect(t.generateMipmaps).toBe(true);
    expect(textures.heightBytes).toBe(HEIGHT_DIM * HEIGHT_DIM * 4);
    expect(textures.materialBytes).toBeGreaterThan(HEIGHT_DIM * HEIGHT_DIM * 4);
    expect(textures.uploadBytes).toBe(HEIGHT_DIM * HEIGHT_DIM * 8);
  });
});
