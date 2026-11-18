import { describe, expect, it } from 'vitest';
import { CdlodSelector, EDGE_COARSER, EDGE_FINER, edgeState, lodRange, morphStart } from '../src/world/cdlod';
import { LEAF_SIZE, NODES_PER_SIDE, PATCH, buildHeightPyramid } from '../src/world/cdlodPyramid';
import { WORLD_MAX, WORLD_MIN } from '../src/world/constants';
import { HEIGHT_DIM, buildHeightTexture } from '../src/world/terrainTextures';

/**
 * A TypeScript mirror of the vertex stage in src/render/cdlodShader.ts (same formulas, same order), used to prove
 * that the morph and edge-stitching rules close every border between nodes of different levels. The pixel-level
 * check of the real shader is the magenta-on-green render described in the G2.0 report.
 */
const heights = buildHeightTexture();
const pyramid = buildHeightPyramid(heights);
const H = (ix: number, iz: number): number => {
  const x = Math.min(HEIGHT_DIM - 1, Math.max(0, Math.trunc(ix)));
  const z = Math.min(HEIGHT_DIM - 1, Math.max(0, Math.trunc(iz)));
  return heights[z * HEIGHT_DIM + x];
};

interface Node { x: number; z: number; size: number; level: number; code: number }

function vertex(node: Node, i: number, j: number, eye: number[], lod0: number): [number, number, number] {
  const gx = node.x + (i / PATCH) * node.size;
  const gz = node.z + (j / PATCH) * node.size;
  const ix = (gx - WORLD_MIN) / 2;
  const iz = (gz - WORLD_MIN) / 2;
  const quad = node.size / (2 * PATCH);
  const oddX = i & 1;
  const oddZ = j & 1;
  const hP = H(ix, iz);
  const dist = Math.hypot(gx - eye[0], hP - eye[1], gz - eye[2]);
  const range = lod0 * 2 ** node.level;
  const start = range * (node.level > 0.5 ? 0.85 : 0.7);
  let k = Math.min(1, Math.max(0, (dist - start) / (range - start))) * (node.level < 5.5 ? 1 : 0);
  const states = [edgeState(node.code, 0), edgeState(node.code, 1), edgeState(node.code, 2), edgeState(node.code, 3)];
  const on = [j === 0, i === PATCH, j === PATCH, i === 0];
  if (on.some((o, e) => o && states[e] === EDGE_COARSER)) k = 1;
  if (on.some((o, e) => o && states[e] === EDGE_FINER)) k = 0;
  const px = gx - oddX * k * (node.size / PATCH);
  const pz = gz - oddZ * k * (node.size / PATCH);
  const hQ = H(ix - oddX * quad, iz - oddZ * quad);
  return [px, hP + (hQ - hP) * k, pz];
}

/** The 33 vertices of one node edge as (coordinate along the edge, height). Edge 0 north, 1 east, 2 south, 3 west. */
function edgeLine(node: Node, edge: number, eye: number[], lod0: number): Array<[number, number]> {
  const line: Array<[number, number]> = [];
  for (let s = 0; s <= PATCH; s++) {
    const [i, j] = edge === 0 ? [s, 0] : edge === 1 ? [PATCH, s] : edge === 2 ? [s, PATCH] : [0, s];
    const [x, y, z] = vertex(node, i, j, eye, lod0);
    line.push([edge === 0 || edge === 2 ? x : z, y]);
  }
  return line;
}

function heightOnLine(line: Array<[number, number]>, s: number): number {
  for (let n = 0; n + 1 < line.length; n++) {
    const [s0, h0] = line[n];
    const [s1, h1] = line[n + 1];
    if (s >= s0 - 1e-6 && s <= s1 + 1e-6) return s1 - s0 < 1e-9 ? h0 : h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
  }
  throw new Error(`coordinate ${s} is outside the edge`);
}

function selection(sel: CdlodSelector): Node[] {
  const nodes: Node[] = [];
  for (let n = 0; n < sel.count; n++) {
    const [x, z, size, level] = sel.nodes.subarray(n * 4, n * 4 + 4);
    nodes.push({ x, z, size, level, code: sel.edges[n] });
  }
  return nodes;
}

/** Largest height difference between neighbouring nodes' edge polylines over a selection, and how many stretches were compared. */
function worstCrack(sel: CdlodSelector, eye: number[], lod0: number, stripRules: boolean): { worst: number; pairs: number } {
  const nodes = selection(sel).map((n) => (stripRules ? { ...n, code: 0 } : n));
  // Which node covers each 64 m cell.
  const cells = new Int32Array(NODES_PER_SIDE * NODES_PER_SIDE).fill(-1);
  nodes.forEach((n, idx) => {
    for (let r = (n.z - WORLD_MIN) / LEAF_SIZE; r < (n.z - WORLD_MIN + n.size) / LEAF_SIZE; r++) {
      for (let c = (n.x - WORLD_MIN) / LEAF_SIZE; c < (n.x - WORLD_MIN + n.size) / LEAF_SIZE; c++) cells[r * NODES_PER_SIDE + c] = idx;
    }
  });
  const lines = nodes.map((n) => [0, 1, 2, 3].map((e) => edgeLine(n, e, eye, lod0)));
  let worst = 0;
  let pairs = 0;
  nodes.forEach((a, ia) => {
    const c0 = (a.x - WORLD_MIN) / LEAF_SIZE;
    const r0 = (a.z - WORLD_MIN) / LEAF_SIZE;
    const span = a.size / LEAF_SIZE;
    for (let edge = 0; edge < 4; edge++) {
      for (let t = 0; t < span; t++) {
        // The neighbour cell just outside the edge at 64 m stretch t.
        const [c, r] = edge === 0 ? [c0 + t, r0 - 1] : edge === 1 ? [c0 + span, r0 + t] : edge === 2 ? [c0 + t, r0 + span] : [c0 - 1, r0 + t];
        if (c < 0 || r < 0 || c >= NODES_PER_SIDE || r >= NODES_PER_SIDE) continue;
        const ib = cells[r * NODES_PER_SIDE + c];
        const opposite = (edge + 2) % 4;
        const along = edge === 0 || edge === 2 ? a.x : a.z;
        const lo = along + t * LEAF_SIZE;
        const hi = lo + LEAF_SIZE;
        // Every vertex of A inside the stretch against B's polyline, and B's against A's.
        for (const [from, to] of [[lines[ia][edge], lines[ib][opposite]], [lines[ib][opposite], lines[ia][edge]]]) {
          for (const [s, h] of from) {
            if (s < lo - 1e-6 || s > hi + 1e-6) continue;
            worst = Math.max(worst, Math.abs(heightOnLine(to, s) - h));
          }
        }
        pairs++;
      }
    }
  });
  return { worst, pairs };
}

describe('CDLOD seams (vertex stage mirror)', () => {
  const tiers = [{ lod0: 110, shadow: 600 }, { lod0: 150, shadow: 1000 }, { lod0: 200, shadow: 1600 }];
  const eyes: Array<[number, number, number]> = [
    [-100, 230, 60], [150, 3, -170], [20, 5, -40], [900, 400, -1300], [-1500, 900, 700], [64, 2, 64], [500, 30, 400], [-300, 80, -900],
  ];

  for (const tier of tiers) {
    it(`closes every border between nodes of different levels (lod0 ${tier.lod0} m) on real terrain`, () => {
      const sel = new CdlodSelector(pyramid, tier.lod0, tier.shadow);
      let pairs = 0;
      for (const eye of eyes) {
        sel.select(eye[0], eye[1], eye[2], null);
        const result = worstCrack(sel, eye, tier.lod0, false);
        expect(result.worst, `eye ${eye.join(', ')}`).toBeLessThan(1e-3);
        pairs += result.pairs;
      }
      expect(pairs).toBeGreaterThan(500);
    });
  }

  it('cracks open without the edge rules, so the check above can fail', () => {
    const sel = new CdlodSelector(pyramid, 150, 1000);
    let worst = 0;
    for (const eye of eyes) {
      sel.select(eye[0], eye[1], eye[2], null);
      worst = Math.max(worst, worstCrack(sel, eye, 150, true).worst);
    }
    expect(worst).toBeGreaterThan(0.05);
    expect(lodRange(150, 1)).toBe(300);
    expect(morphStart(150, 1)).toBeCloseTo(255, 9);
    expect(WORLD_MAX).toBe(2048);
  });
});
