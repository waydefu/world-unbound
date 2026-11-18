import { Frustum, Matrix4, PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { CAMERAS, resolveCamera, type ResolvedCamera } from '../src/app/cameras';
import {
  CdlodSelector, EDGE_COARSER, EDGE_FINER, MAX_NODES, edgeState, frustumPlanes, lodRange, morphEnd, morphStart,
} from '../src/world/cdlod';
import {
  LEAF_SIZE, LEVELS, LEVEL_OFFSET, NODES_PER_SIDE, PYRAMID_NODES, buildHeightPyramid, nodeSize,
} from '../src/world/cdlodPyramid';
import { WORLD_MIN } from '../src/world/constants';
import { HEIGHT_DIM, buildHeightTexture } from '../src/world/terrainTextures';

function syntheticPyramid(f: (x: number, z: number) => number): Float32Array {
  const heights = new Float32Array(HEIGHT_DIM * HEIGHT_DIM);
  for (let j = 0; j < HEIGHT_DIM; j++) for (let i = 0; i < HEIGHT_DIM; i++) heights[j * HEIGHT_DIM + i] = f(WORLD_MIN + 2 * i, WORLD_MIN + 2 * j);
  return buildHeightPyramid(heights);
}

const flat = syntheticPyramid(() => 0);
const sloped = syntheticPyramid((x, z) => 0.35 * x + 0.1 * z);
/** A 500 m cliff running north-south at x = 100 and a spike: tall boxes next to flat ones. */
const cliff = syntheticPyramid((x, z) => 500 * Math.min(1, Math.max(0, (x - 100) / 6)) + (Math.hypot(x + 400, z) < 40 ? 300 : 0));
const real = buildHeightPyramid(buildHeightTexture());

const TIERS = [
  { name: 'low', lod0: 110, shadow: 600 },
  { name: 'med', lod0: 150, shadow: 1000 },
  { name: 'high', lod0: 200, shadow: 1600 },
];
const EYES: Array<[number, number, number]> = [
  [0, 5, 0], [150, 3, -170], [-100, 230, 60], [-2000, 40, -2000], [2040, 10, 2040], [900, 300, -1300], [0, 3000, 0],
  [-3500, 20, 100], [64, 2, 64], [1.5, 1000, -2047],
];

/** Cells covered per node; also checks each node is aligned and inside the square. */
function coverage(sel: CdlodSelector, list: 'nodes' | 'casters' = 'nodes'): Int32Array {
  const cells = new Int32Array(NODES_PER_SIDE * NODES_PER_SIDE);
  const count = list === 'nodes' ? sel.count : sel.casterCount;
  const array = sel[list];
  for (let n = 0; n < count; n++) {
    const [x, z, size, level] = array.subarray(n * 4, n * 4 + 4);
    expect(size).toBe(nodeSize(level));
    expect((x - WORLD_MIN) % size).toBe(0);
    expect((z - WORLD_MIN) % size).toBe(0);
    const c0 = (x - WORLD_MIN) / LEAF_SIZE;
    const r0 = (z - WORLD_MIN) / LEAF_SIZE;
    const span = size / LEAF_SIZE;
    for (let r = r0; r < r0 + span; r++) for (let c = c0; c < c0 + span; c++) cells[r * NODES_PER_SIDE + c]++;
  }
  return cells;
}

function levelMap(sel: CdlodSelector): Int8Array {
  const map = new Int8Array(NODES_PER_SIDE * NODES_PER_SIDE).fill(-1);
  for (let n = 0; n < sel.count; n++) {
    const [x, z, size, level] = sel.nodes.subarray(n * 4, n * 4 + 4);
    const c0 = (x - WORLD_MIN) / LEAF_SIZE;
    const r0 = (z - WORLD_MIN) / LEAF_SIZE;
    for (let r = r0; r < r0 + size / LEAF_SIZE; r++) for (let c = c0; c < c0 + size / LEAF_SIZE; c++) map[r * NODES_PER_SIDE + c] = level;
  }
  return map;
}

describe('height pyramid', () => {
  it('has min/max per node, including shared border lattice points', () => {
    expect(PYRAMID_NODES).toBe(4096 + 1024 + 256 + 64 + 16 + 4 + 1);
    // Linear slope in x: leaf (0, 0) spans x = -2048 .. -1984 inclusive.
    const o = LEVEL_OFFSET[0] * 2;
    expect(sloped[o]).toBeCloseTo(0.35 * -2048 + 0.1 * -2048, 2);
    expect(sloped[o + 1]).toBeCloseTo(0.35 * -1984 + 0.1 * -1984, 2);
    const root = LEVEL_OFFSET[LEVELS - 1] * 2;
    expect(sloped[root]).toBeCloseTo(0.35 * -2048 + 0.1 * -2048, 2);
    expect(sloped[root + 1]).toBeCloseTo(0.35 * 2048 + 0.1 * 2048, 1);
    expect(flat[root]).toBe(0);
    expect(flat[root + 1]).toBe(0);
  });
});

describe('morph and range tables', () => {
  for (const tier of TIERS) {
    it(`${tier.name}: ranges double, morph bands sit inside each level's range and rise monotonically`, () => {
      expect(lodRange(tier.lod0, 0)).toBe(tier.lod0);
      expect(morphStart(tier.lod0, 0)).toBeCloseTo(0.7 * tier.lod0, 9);
      for (let level = 0; level < LEVELS; level++) {
        const end = morphEnd(tier.lod0, level);
        const start = morphStart(tier.lod0, level);
        expect(end).toBe(lodRange(tier.lod0, level));
        expect(start).toBeLessThan(end);
        const inner = level === 0 ? 0 : lodRange(tier.lod0, level - 1);
        expect(start).toBeGreaterThanOrEqual(inner);
        expect(end - start).toBeCloseTo(0.3 * (end - inner), 9);
        if (level > 0) {
          expect(lodRange(tier.lod0, level)).toBe(2 * lodRange(tier.lod0, level - 1));
          expect(start).toBeGreaterThan(morphStart(tier.lod0, level - 1));
          expect(end).toBeGreaterThan(morphEnd(tier.lod0, level - 1));
        }
      }
      // The closed form the shader uses: 0.85 x range for levels above 0, 0.7 x range for level 0.
      for (let level = 1; level < LEVELS; level++) expect(morphStart(tier.lod0, level)).toBeCloseTo(0.85 * lodRange(tier.lod0, level), 9);
    });
  }
});

describe('CDLOD selection', () => {
  const shapes: Array<[string, Float32Array]> = [['flat', flat], ['sloped', sloped], ['cliff', cliff]];
  for (const [shape, pyramid] of shapes) {
    for (const tier of TIERS) {
      it(`${shape}/${tier.name}: nodes tile the square with no gap or overlap, neighbours differ by <= 1 level`, () => {
        const sel = new CdlodSelector(pyramid, tier.lod0, tier.shadow);
        for (const [x, y, z] of EYES) {
          sel.select(x, y, z, null);
          expect(sel.overflow).toBe(false);
          expect(sel.count).toBeLessThanOrEqual(MAX_NODES);
          const cells = coverage(sel);
          expect(cells.every((v) => v === 1)).toBe(true);
          const map = levelMap(sel);
          for (let r = 0; r < NODES_PER_SIDE; r++) {
            for (let c = 0; c < NODES_PER_SIDE; c++) {
              if (c + 1 < NODES_PER_SIDE) expect(Math.abs(map[r * 64 + c] - map[r * 64 + c + 1])).toBeLessThanOrEqual(1);
              if (r + 1 < NODES_PER_SIDE) expect(Math.abs(map[r * 64 + c] - map[(r + 1) * 64 + c])).toBeLessThanOrEqual(1);
            }
          }
          expect(sel.culled).toBe(0);
          expect(sel.perLevel.reduce((a, b) => a + b, 0)).toBe(sel.count);
        }
      });
    }
  }

  it('a camera at the village sees the finest level close up and the root level only when far away', () => {
    const sel = new CdlodSelector(flat, 150, 1000);
    sel.select(150, 2, -170, null);
    expect(sel.perLevel[0]).toBeGreaterThan(8);
    expect(sel.perLevel[ROOT_LEVEL_INDEX]).toBe(0);
    sel.select(0, 60000, 0, null);
    expect(sel.count).toBe(1);
    expect(sel.nodes[2]).toBe(4096);
    expect(sel.nodes[3]).toBe(6);
  });

  it('edge codes name the coarser and finer neighbours exactly', () => {
    const sel = new CdlodSelector(sloped, 150, 1000);
    sel.select(150, 5, -170, null);
    const map = levelMap(sel);
    let coarser = 0;
    let finer = 0;
    for (let n = 0; n < sel.count; n++) {
      const [x, z, size, level] = sel.nodes.subarray(n * 4, n * 4 + 4);
      const c0 = (x - WORLD_MIN) / LEAF_SIZE;
      const r0 = (z - WORLD_MIN) / LEAF_SIZE;
      const span = size / LEAF_SIZE;
      const neighbours = [[c0, r0 - 1], [c0 + span, r0], [c0, r0 + span], [c0 - 1, r0]];
      neighbours.forEach(([c, r], edge) => {
        const state = edgeState(sel.edges[n], edge);
        if (c < 0 || r < 0 || c >= NODES_PER_SIDE || r >= NODES_PER_SIDE) {
          expect(state).toBe(0);
          return;
        }
        const other = map[r * NODES_PER_SIDE + c];
        expect(state).toBe(other > level ? EDGE_COARSER : other < level ? EDGE_FINER : 0);
        if (state === EDGE_COARSER) coarser++;
        if (state === EDGE_FINER) finer++;
      });
    }
    expect(coarser).toBeGreaterThan(0);
    // Each coarse edge faces two finer nodes, each of which sees one coarser edge.
    expect(coarser).toBe(2 * finer);
  });

  it('node count stays <= 400 at every acceptance camera on every tier (real terrain)', () => {
    const eye: ResolvedCamera = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, fovDeg: 55 };
    for (const tier of TIERS) {
      const sel = new CdlodSelector(real, tier.lod0, tier.shadow);
      for (const spec of CAMERAS) {
        resolveCamera(spec, eye);
        sel.select(eye.x, eye.y, eye.z, null);
        expect(sel.count, `${tier.name}/${spec.name} drawn`).toBeLessThanOrEqual(400);
        expect(sel.casterCount, `${tier.name}/${spec.name} casters`).toBeLessThanOrEqual(400);
        expect(sel.overflow).toBe(false);
        expect(coverage(sel).every((v) => v === 1)).toBe(true);
      }
    }
  });

  it('is stable: an unchanged eye and frustum report no change, a moved eye does', () => {
    const sel = new CdlodSelector(real, 150, 1000);
    sel.select(151.3, 5, -170.7, null);
    expect(sel.nodesChanged).toBe(true);
    sel.select(151.3, 5, -170.7, null);
    expect(sel.nodesChanged).toBe(false);
    expect(sel.castersChanged).toBe(false);
    sel.select(151.3, 5, -100.7, null);
    expect(sel.nodesChanged).toBe(true);
    // A small move inside the same selection rewrites identical nodes: no upload needed.
    sel.select(151.3001, 5, -100.7, null);
    expect(sel.nodesChanged).toBe(false);
  });
});

const ROOT_LEVEL_INDEX = LEVELS - 1;

describe('frustum culling', () => {
  it('frustumPlanes agrees with three.js', () => {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.3, 7000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0.4, -0.1, -0.9);
    camera.updateMatrixWorld();
    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const planes = frustumPlanes(vp.elements, new Float32Array(24));
    const frustum = new Frustum().setFromProjectionMatrix(vp);
    // three orders its planes right, left, bottom, top, far, near; ours are left, right, bottom, top, near, far.
    const threeIndex = [1, 0, 2, 3, 5, 4];
    for (let p = 0; p < 6; p++) {
      const plane = frustum.planes[threeIndex[p]];
      expect(planes[p * 4]).toBeCloseTo(plane.normal.x, 5);
      expect(planes[p * 4 + 1]).toBeCloseTo(plane.normal.y, 5);
      expect(planes[p * 4 + 2]).toBeCloseTo(plane.normal.z, 5);
      expect(planes[p * 4 + 3]).toBeCloseTo(plane.constant, 3);
    }
  });

  it('with only a near plane at the eye, culling removes exactly the nodes entirely behind the camera', () => {
    const sel = new CdlodSelector(sloped, 150, 1000);
    const everything = new CdlodSelector(sloped, 150, 1000);
    // Planes: inside is x >= eye.x (camera-relative x >= 0); the other five never reject.
    const planes = new Float32Array(24);
    planes.set([1, 0, 0, 0]);
    for (let p = 1; p < 6; p++) planes.set([1, 0, 0, 1e9], p * 4);
    const ex = 150;
    sel.select(ex, 5, -170, planes);
    everything.select(ex, 5, -170, null);
    expect(sel.culled).toBeGreaterThan(0);
    expect(sel.count + sel.culled).toBe(everything.count);
    let expectedBehind = 0;
    for (let n = 0; n < everything.count; n++) {
      const x = everything.nodes[n * 4];
      const size = everything.nodes[n * 4 + 2];
      if (x + size <= ex) expectedBehind++;
    }
    expect(sel.culled).toBe(expectedBehind);
    for (let n = 0; n < sel.count; n++) expect(sel.nodes[n * 4] + sel.nodes[n * 4 + 2]).toBeGreaterThan(ex);
    // The selection itself is unchanged by culling: casters (no frustum) are identical.
    expect(sel.casterCount).toBe(everything.casterCount);
    expect(Array.from(sel.casters.subarray(0, sel.casterCount * 4))).toEqual(Array.from(everything.casters.subarray(0, everything.casterCount * 4)));
  });

  it('a real camera frustum keeps every node that contains a point on the view axis', () => {
    const eye: ResolvedCamera = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, fovDeg: 55 };
    resolveCamera(CAMERAS[5], eye);
    const camera = new PerspectiveCamera(eye.fovDeg, 16 / 9, 0.3, 7000);
    camera.lookAt(eye.targetX - eye.x, eye.targetY - eye.y, eye.targetZ - eye.z);
    camera.updateMatrixWorld();
    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const planes = frustumPlanes(vp.elements, new Float32Array(24));
    const sel = new CdlodSelector(real, 150, 1000);
    sel.select(eye.x, eye.y, eye.z, planes);
    expect(sel.culled).toBeGreaterThan(0);
    expect(sel.count).toBeGreaterThan(5);
    // The look-at target is on the axis: its node must be drawn.
    const hit = (tx: number, tz: number): boolean => {
      for (let n = 0; n < sel.count; n++) {
        const [x, z, size] = sel.nodes.subarray(n * 4, n * 4 + 3);
        if (tx >= x && tx <= x + size && tz >= z && tz <= z + size) return true;
      }
      return false;
    };
    expect(hit(eye.targetX, eye.targetZ)).toBe(true);
  });
});

describe('shadow casters', () => {
  it('cover everything within the shadow range of the eye, including behind the camera, and nothing far beyond', () => {
    const sel = new CdlodSelector(flat, 150, 600);
    sel.select(0, 5, 0, null);
    expect(sel.casterCount).toBeGreaterThan(0);
    expect(sel.casterCount).toBeLessThanOrEqual(sel.count);
    const cells = coverage(sel, 'casters');
    // Cells with a caster lie within shadowFar of the eye (to a node's size), and the eye's own cell has one.
    const eyeCell = (0 - WORLD_MIN) / LEAF_SIZE;
    expect(cells[eyeCell * NODES_PER_SIDE + eyeCell]).toBe(1);
    for (let r = 0; r < NODES_PER_SIDE; r++) {
      for (let c = 0; c < NODES_PER_SIDE; c++) {
        const cx = WORLD_MIN + c * LEAF_SIZE + LEAF_SIZE / 2;
        const cz = WORLD_MIN + r * LEAF_SIZE + LEAF_SIZE / 2;
        const d = Math.hypot(cx, cz);
        if (d < 600 - 4096 / 8 && d < 400) expect(cells[r * NODES_PER_SIDE + c]).toBe(1);
        if (d > 600 + 3000) expect(cells[r * NODES_PER_SIDE + c]).toBe(0);
        expect(cells[r * NODES_PER_SIDE + c]).toBeLessThanOrEqual(1);
      }
    }
    // Both in front of and behind the eye: there are casters on each side.
    let before = 0;
    let behind = 0;
    for (let n = 0; n < sel.casterCount; n++) {
      if (sel.casters[n * 4] + sel.casters[n * 4 + 2] <= 0) behind++;
      else before++;
    }
    expect(before).toBeGreaterThan(0);
    expect(behind).toBeGreaterThan(0);
  });
});
