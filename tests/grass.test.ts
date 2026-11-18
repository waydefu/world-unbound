import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera } from 'three/webgpu';
import { QUALITY } from '../src/app/quality';
import { parseParams } from '../src/app/params';
import { frustumPlanes } from '../src/world/cdlod';
import { WORLD_MIN } from '../src/world/constants';
import { CELL_M, GrassCells, MAX_CARD_CELLS, MAX_DENSE_CELLS, MAX_THIN_CELLS, WORLD_CELLS } from '../src/world/grassCells';
import { HEIGHT_DIM, buildTerrainTextures, materialDim } from '../src/world/terrainTextures';
import { createTerrainTextures } from '../src/render/terrainTextures';
import { createBladeGeometry, createCardGeometry } from '../src/render/grassGeometry';
import { GrassLayer } from '../src/render/grass';
import { WindTexture } from '../src/render/windTexture';
import { createNoiseTexture } from '../src/render/noiseTextures';

/** A flat meadow world: height 5 m, meadow density `meadow` everywhere, on a 2 m / 4 m lattice. */
function meadowGround(meadow: number, step = 2) {
  const dim = HEIGHT_DIM;
  const vdim = materialDim(step as 1 | 2);
  const vegetation = new Uint8Array(vdim * vdim * 4);
  for (let k = 0; k < vdim * vdim; k++) vegetation[k * 4] = meadow;
  return { height: new Float32Array(dim * dim).fill(5), heightDim: dim, vegetation, vegetationDim: vdim, vegetationStep: step };
}

const RINGS = { nearM: 40, midM: 100, cardInnerM: 32 };

describe('grass cells', () => {
  it('tiles the world in 8 m cells on a grid snapped to the cell size and classifies by distance', () => {
    expect(CELL_M).toBe(8);
    expect(WORLD_CELLS).toBe(512);
    const cells = new GrassCells(meadowGround(255), RINGS);
    cells.select(100.5, 100.5, 100.5, null);
    expect(cells.changed).toBe(true);
    expect(cells.denseCount).toBeGreaterThan(0);
    expect(cells.thinCount).toBeGreaterThan(0);
    expect(cells.cardCount).toBeGreaterThan(0);
    for (const list of [[cells.dense, cells.denseCount], [cells.thin, cells.thinCount], [cells.cards, cells.cardCount]] as const) {
      for (let c = 0; c < list[1]; c++) {
        expect((list[0][c * 4] - WORLD_MIN) % CELL_M).toBe(0);
        expect((list[0][c * 4 + 1] - WORLD_MIN) % CELL_M).toBe(0);
      }
    }
    // Dense cells have their centre within nearM / 2, thin ones beyond; cards start inside the blade ring.
    for (let c = 0; c < cells.denseCount; c++) {
      expect(Math.hypot(cells.dense[c * 4] + 4 - 100.5, cells.dense[c * 4 + 1] + 4 - 100.5)).toBeLessThan(20);
    }
    for (let c = 0; c < cells.thinCount; c++) {
      expect(Math.hypot(cells.thin[c * 4] + 4 - 100.5, cells.thin[c * 4 + 1] + 4 - 100.5)).toBeGreaterThanOrEqual(20);
    }
    let innermost = Infinity;
    let outermost = 0;
    for (let c = 0; c < cells.cardCount; c++) {
      const d = Math.hypot(cells.cards[c * 4] + 4 - 100.5, cells.cards[c * 4 + 1] + 4 - 100.5);
      innermost = Math.min(innermost, d);
      outermost = Math.max(outermost, d);
    }
    expect(innermost).toBeGreaterThanOrEqual(RINGS.cardInnerM - 6);
    expect(outermost).toBeLessThanOrEqual(RINGS.midM + 6);
  });

  it('has no blades on the low tier: cards from the eye out to the mid limit', () => {
    const cells = new GrassCells(meadowGround(255, 2), { nearM: 0, midM: 60, cardInnerM: 0 });
    cells.select(0, 5, 0, null);
    expect(cells.denseCount).toBe(0);
    expect(cells.thinCount).toBe(0);
    expect(cells.cardCount).toBeGreaterThan(100);
    expect(cells.overflow).toBe(false);
  });

  it('drops cells without meadow (water, rock) and culls cells outside the frustum', () => {
    const bare = new GrassCells(meadowGround(0), RINGS);
    bare.select(0, 5, 0, null);
    expect(bare.denseCount + bare.thinCount + bare.cardCount).toBe(0);

    const all = new GrassCells(meadowGround(255), RINGS);
    all.select(0, 5, 0, null);
    const camera = new PerspectiveCamera(60, 16 / 9, 0.3, 500);
    camera.position.set(0, 0, 0);
    camera.lookAt(1, 0, 0);
    camera.updateMatrixWorld();
    const planes = frustumPlanes(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, new Float32Array(24));
    const culled = new GrassCells(meadowGround(255), RINGS);
    culled.select(0, 5, 0, planes);
    expect(culled.cardCount).toBeLessThan(all.cardCount * 0.45);
    expect(culled.cardCount).toBeGreaterThan(0);
    // Everything kept is east of the eye (looking along +x): a cell's far corner has x >= 0.
    for (let c = 0; c < culled.cardCount; c++) expect(culled.cards[c * 4] + CELL_M).toBeGreaterThan(-1);
  });

  it('skips the work while the eye cell and the frustum stay the same, and is deterministic', () => {
    const a = new GrassCells(meadowGround(255), RINGS);
    const b = new GrassCells(meadowGround(255), RINGS);
    a.select(10, 5, 10, null);
    b.select(10, 5, 10, null);
    expect(Array.from(a.cards.subarray(0, a.cardCount * 4))).toEqual(Array.from(b.cards.subarray(0, b.cardCount * 4)));
    a.select(11, 5, 11, null);
    expect(a.changed).toBe(false);
    a.select(30, 5, 10, null);
    expect(a.changed).toBe(true);
  });

  it('never overflows its lists at the largest tier with no culling', () => {
    const cells = new GrassCells(meadowGround(255), { nearM: 60, midM: 150, cardInnerM: 48 });
    cells.select(0, 5, 0, null);
    expect(cells.overflow).toBe(false);
    expect(cells.denseCount).toBeLessThanOrEqual(MAX_DENSE_CELLS);
    expect(cells.thinCount).toBeLessThanOrEqual(MAX_THIN_CELLS);
    expect(cells.cardCount).toBeLessThanOrEqual(MAX_CARD_CELLS);
  });
});

describe('grass geometry and tiers', () => {
  it('blades: 3 segments are 7 vertices and 5 triangles, 1 segment is a 4-vertex quad; cards are 3 triangles', () => {
    const near = createBladeGeometry(10, 3, new Float32Array(8));
    expect(near.trianglesPerInstance).toBe(50);
    expect(near.geometry.getAttribute('position').count).toBe(70);
    const far = createBladeGeometry(10, 1, new Float32Array(8));
    expect(far.trianglesPerInstance).toBe(20);
    expect(far.geometry.getAttribute('position').count).toBe(40);
    const card = createCardGeometry(5, new Float32Array(8));
    expect(card.trianglesPerInstance).toBe(15);
    expect(card.geometry.getAttribute('part').count).toBe(45);
    // Blade index goes in z; every index is below the vertex count (16-bit indices).
    const pos = near.geometry.getAttribute('position');
    expect(pos.getZ(69)).toBe(9);
    expect(Math.max(...Array.from(near.geometry.index?.array ?? []))).toBe(69);
  });

  it('tiers match the spec: blades per m2 low 8 / med 16 / high 28 near, cards only on low out to 60 m', () => {
    expect(QUALITY.low.grass.nearM).toBe(0);
    expect(QUALITY.low.grass.midM).toBe(60);
    expect(QUALITY.med.grass).toMatchObject({ nearM: 40, midM: 100, bladesPerM2: 16 });
    expect(QUALITY.high.grass).toMatchObject({ nearM: 60, midM: 150, bladesPerM2: 28 });
  });

  it('phase F density: the boosted blade count per cell still fits 16-bit indices at every tier, cards keep their ring order', () => {
    const cell = CELL_M * CELL_M;
    for (const tier of [QUALITY.low, QUALITY.med, QUALITY.high]) {
      const g = tier.grass;
      const blades = Math.min(5000, Math.round(cell * g.bladesPerM2 * g.bladeBoost));
      expect(blades * 7).toBeLessThanOrEqual(65535);
      expect(Math.min(7000, Math.round(cell * g.cardsPerM2)) * 9).toBeLessThanOrEqual(65535);
      expect(g.midM).toBeGreaterThan(g.nearM);
    }
    // Blades per m2 at the eye: more than the base figure on med and high (the first density read as sparse).
    expect(QUALITY.med.grass.bladesPerM2 * QUALITY.med.grass.bladeBoost).toBeGreaterThan(16);
    expect(QUALITY.high.grass.bladesPerM2 * QUALITY.high.grass.bladeBoost).toBeGreaterThan(28);
  });

  it('?grass=0 turns the grass off, on by default', () => {
    expect(parseParams('?grass=0').grass).toBe(false);
    expect(parseParams('?cam=2').grass).toBe(true);
  });
});

describe('grass layer on the Hellesylt terrain', () => {
  const data = buildTerrainTextures(2);
  const textures = createTerrainTextures(data);
  const noise = createNoiseTexture().texture;
  const wind = new WindTexture(data.masks?.windChannel ?? null);

  for (const tier of ['low', 'med', 'high'] as const) {
    it(`${tier}: builds its materials and selects cells around the village meadow`, () => {
      const layer = new GrassLayer({
        textures, data, noise, wind: wind.texture, settings: QUALITY[tier].grass, shadows: tier !== 'low', lite: tier === 'low',
      });
      const camera = new PerspectiveCamera(60, 16 / 9, 0.3, 1000);
      camera.position.set(0, 0, 0);
      camera.lookAt(-1, 0, 1);
      camera.updateMatrixWorld();
      layer.update(20, 3, -40, camera, 1, 0.016);
      expect(layer.stats.cells).toBeGreaterThan(0);
      expect(layer.stats.cards).toBeGreaterThan(0);
      expect(layer.stats.triangles).toBeGreaterThan(0);
      if (tier === 'low') expect(layer.stats.blades).toBe(0);
      else expect(layer.stats.blades).toBeGreaterThan(0);
      expect(layer.bytes).toBeGreaterThan(0);
      expect(layer.root.children.length).toBe(tier === 'low' ? 1 : 3);
    });
  }
});
