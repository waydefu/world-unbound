import { describe, expect, it } from 'vitest';
import { HEIGHT_OFFSET, HEIGHT_QUANTUM, TOWN_RADIUS, TOWN_X, TOWN_Z, WORLD_MIN } from '../src/world/constants';
import { heightAt } from '../src/world/heightField';
import { findManMadeStone } from '../src/world/manMadeStone';
import {
  HEATH_LIMIT_M, ROCK_SLOPE_DEG, TREELINE_M, buildVegetation, maskDim,
} from '../src/world/vegetationMask';
import { buildTerrainTextures, materialDim } from '../src/world/terrainTextures';

const APRON = 8;
const N = 65;
const PAD = N + 2 * APRON;

/** Padded quantised lattice of a height function h(x, z) in metres, x and z in lattice cells from 0. */
function lattice(height: (x: number, z: number) => number): Int16Array {
  const out = new Int16Array(PAD * PAD);
  for (let j = 0; j < PAD; j++) {
    for (let i = 0; i < PAD; i++) out[j * PAD + i] = Math.round((height(i - APRON, j - APRON) - HEIGHT_OFFSET) / HEIGHT_QUANTUM);
  }
  return out;
}

const classic = (): Uint8Array => new Uint8Array(N * N * 4).fill(0);
const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);
/** Texel values at lattice point (i, j) of the result. */
function at(masks: { vegetation: Uint8Array }, material: Uint8Array, i: number, j: number) {
  const o = (j * N + i) * 4;
  return {
    meadow: masks.vegetation[o] / 255, heath: masks.vegetation[o + 1] / 255, tree: masks.vegetation[o + 2] / 255,
    bare: masks.vegetation[o + 3] / 255, sand: material[o] / 255, rock: material[o + 1] / 255, stone: material[o + 2] / 255,
  };
}
const ORIGIN = { originX: 1000, originZ: 1000 };

describe('vegetation rules', () => {
  const slope = (deg: number) => {
    const material = classic();
    const masks = buildVegetation(lattice((x) => 10 + x * 2 * tan(deg)), PAD, APRON, 1, material, ORIGIN);
    return at(masks, material, 32, 32);
  };

  it('keeps a 30 degree slope vegetated and makes a 60 degree slope bare rock', () => {
    const gentle = slope(30);
    expect(gentle.meadow).toBeGreaterThan(0.9);
    expect(gentle.bare).toBeLessThan(0.05);
    expect(gentle.rock).toBe(0);
    const steep = slope(60);
    expect(steep.meadow).toBe(0);
    expect(steep.bare).toBe(1);
    expect(steep.rock).toBe(1);
  });

  it('puts the rock threshold at ROCK_SLOPE_DEG with a short ramp: 40 degrees is still green, 50 is rock', () => {
    expect(ROCK_SLOPE_DEG).toBe(42);
    expect(slope(40).rock).toBeLessThan(0.02);
    expect(slope(40).meadow).toBeGreaterThan(0.95);
    expect(slope(45).rock).toBeGreaterThan(0.2);
    expect(slope(45).rock).toBeLessThan(0.9);
    expect(slope(50).rock).toBeGreaterThan(0.95);
    expect(slope(36).rock).toBeLessThanOrEqual(slope(40).rock);
  });

  it('makes a wide flat field meadow, with no trees and no bare ground', () => {
    const material = classic();
    const masks = buildVegetation(lattice(() => 30), PAD, APRON, 1, material, ORIGIN);
    const v = at(masks, material, 32, 32);
    expect(v.meadow).toBeGreaterThan(0.98);
    expect(v.bare).toBe(0);
    expect(v.tree).toBe(0);
    expect(v.heath).toBe(0);
  });

  it('grows birch forest on moderate slopes below the treeline, and heath above it', () => {
    const forest = (base: number) => {
      const material = classic();
      const masks = buildVegetation(lattice((x) => base + x * 2 * tan(25)), PAD, APRON, 1, material, ORIGIN);
      return at(masks, material, 32, 32);
    };
    expect(forest(100).tree).toBeGreaterThan(0.5);
    const high = forest(TREELINE_M + 80);
    expect(high.tree).toBe(0);
    expect(high.heath).toBeGreaterThan(0.5);
    expect(forest(TREELINE_M + 80).meadow).toBeLessThan(forest(100).meadow);
    // Above the heath limit it is bare.
    expect(HEATH_LIMIT_M).toBe(TREELINE_M + 300);
    const summit = forest(HEATH_LIMIT_M + 220);
    expect(summit.bare).toBeGreaterThan(0.95);
    expect(summit.meadow).toBe(0);
  });

  it('lowers grass density on the village lawn', () => {
    const at0 = (x: number, z: number) => {
      const material = classic();
      const masks = buildVegetation(lattice(() => 3), PAD, APRON, 1, material, { originX: x - 64, originZ: z - 64 });
      return at(masks, material, 32, 32).meadow;
    };
    expect(at0(TOWN_X, TOWN_Z)).toBeLessThan(0.8);
    expect(at0(TOWN_X, TOWN_Z)).toBeGreaterThan(0.7);
    expect(at0(TOWN_X + TOWN_RADIUS * 2, TOWN_Z)).toBeGreaterThan(0.98);
  });

  it('is deterministic and works on a 4 m texel grid', () => {
    const h = lattice((x, z) => 5 + Math.sin(x * 0.3) * 3 + z * 0.6);
    const a = buildVegetation(h, PAD, APRON, 1, classic());
    const b = buildVegetation(h, PAD, APRON, 1, classic());
    expect(a.vegetation).toEqual(b.vegetation);
    expect(a.wetness).toEqual(b.wetness);
    const coarse = buildVegetation(h, PAD, APRON, 2, new Uint8Array(maskDim(N, 2) ** 2 * 4));
    expect(coarse.dim).toBe(33);
    expect(coarse.vegetation.length).toBe(33 * 33 * 4);
  });

  it('marks hollows wetter than ridges', () => {
    const bowl = lattice((x, z) => 20 + ((x - 32) ** 2 + (z - 32) ** 2) * 0.02);
    const masks = buildVegetation(bowl, PAD, APRON, 1, classic(), ORIGIN);
    const ridge = lattice((x, z) => 40 - ((x - 32) ** 2 + (z - 32) ** 2) * 0.02);
    const dry = buildVegetation(ridge, PAD, APRON, 1, classic(), ORIGIN);
    expect(masks.wetness[32 * N + 32]).toBeGreaterThan(dry.wetness[32 * N + 32]);
  });
});

describe('man-made stone', () => {
  const strip = (width: number, sea = -6) => lattice((x) => (x >= 30 && x < 30 + width ? 2 : sea));

  it('flags a thin strip between two water bodies as stone: bare, not grass or sand', () => {
    for (const width of [1, 2]) {
      const material = classic();
      const masks = buildVegetation(strip(width), PAD, APRON, 1, material, ORIGIN);
      const v = at(masks, material, 30, 32);
      expect(v.stone).toBe(1);
      expect(v.bare).toBe(1);
      expect(v.meadow).toBe(0);
      expect(v.sand).toBe(0);
      expect(v.rock).toBe(0);
    }
  });

  it('keeps a harbour pier covered across its deck on both material grids', () => {
    for (const step of [1, 2]) {
      const dim = maskDim(N, step);
      const material = new Uint8Array(dim * dim * 4);
      buildVegetation(strip(8), PAD, APRON, step, material, ORIGIN);
      for (let x = 30; x < 38; x += step) {
        const offset = ((32 / step) * dim + x / step) * 4;
        expect(material[offset + 2]).toBe(255);
      }
    }
  });

  it('does not flag a wide island or a one-sided shore, but flags the sheer quay edge', () => {
    const island = lattice((x) => (x >= 20 && x < 50 ? 2 : -6));
    const flags = new Uint8Array(N * N);
    findManMadeStone(island, PAD, APRON, N, flags);
    expect(flags[32 * N + 35]).toBe(0);
    // Quay: level ground at 2 m ending in a sheer drop to the sea.
    const quay = lattice((x) => (x < 40 ? 2 : -6));
    const quayFlags = new Uint8Array(N * N);
    findManMadeStone(quay, PAD, APRON, N, quayFlags);
    expect(quayFlags[32 * N + 39]).toBe(1);
    expect(quayFlags[32 * N + 10]).toBe(0);
    // A gentle beach (1:10) is not a quay.
    const beach = lattice((x) => 2 - Math.max(0, x - 30) * 0.4);
    const beachFlags = new Uint8Array(N * N);
    findManMadeStone(beach, PAD, APRON, N, beachFlags);
    expect(beachFlags.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('ignores high ground: a thin ridge 30 m up between two lakes is not a pier', () => {
    const ridge = lattice((x) => (x >= 30 && x < 32 ? 30 : -6));
    const flags = new Uint8Array(N * N);
    expect(findManMadeStone(ridge, PAD, APRON, N, flags)).toBe(0);
  });
});

describe('vegetation of the Hellesylt terrain (CDLOD bake)', () => {
  const data = buildTerrainTextures(2);
  const masks = data.masks;
  const dim = materialDim(2);
  const texel = (w: number): number => (w - WORLD_MIN) / 4;

  it('delivers vegetation and wetness textures on the material lattice', () => {
    expect(masks).toBeDefined();
    expect(masks?.vegetation.length).toBe(dim * dim * 4);
    expect(masks?.wetness.length).toBe(dim * dim);
  });

  it('draws the harbour pier as stone with water on both sides, and the village meadow as grass', () => {
    const o = (texel(-100) * dim + texel(248)) * 4;
    expect(heightAt(248, -100)).toBeGreaterThan(1);
    expect(data.material[o + 2]).toBe(255);
    expect(data.material[o]).toBe(0);
    expect(masks?.vegetation[o + 3]).toBe(255);
    expect(masks?.vegetation[o]).toBe(0);
    const field = (texel(-90) * dim + texel(-60)) * 4;
    expect(data.material[field + 2]).toBe(0);
    expect(masks?.vegetation[field] ?? 0).toBeGreaterThan(100);
  });

  it('keeps moderate slopes green: far less rock than the slope-only classification, steep faces still rock', () => {
    let rock = 0;
    let steepRock = 0;
    for (let k = 0; k < data.material.length; k += 4) rock += data.material[k + 1];
    for (let k = 0; k < data.material.length; k += 4 * 31) if (data.material[k + 1] > 200) steepRock++;
    expect(steepRock).toBeGreaterThan(50);
    // The classic smoothed bake put 30 to 44 degree faces into rock; here only >= 42 degrees is.
    expect(rock / 255).toBeLessThan(dim * dim * 0.2);
  });

  it('sums the material weights to at most one and keeps AO', () => {
    for (let k = 0; k < data.material.length; k += 4 * 523) {
      expect(data.material[k] + data.material[k + 1] + data.material[k + 2]).toBeLessThanOrEqual(257);
      expect(data.material[k + 3]).toBeGreaterThanOrEqual(63);
    }
  });
});
