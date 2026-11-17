import { describe, expect, it, vi } from 'vitest';
import {
  CELL_SIZE, CHUNK_SIZE, HEIGHT_OFFSET, HEIGHT_QUANTUM, TILE_DIM, TOWN_RADIUS, TOWN_X, TOWN_Z, WORLD_MAX, WORLD_MIN,
} from '../src/world/constants';
import { lodIndexCount, lodSide, lodVertexCount, selectLod, slotCx, slotCz, slotOf } from '../src/world/chunkGrid';
import { fnv1a16, hash2, valueNoise } from '../src/world/hash';
import {
  dequantize, generateTile, heightAt, interpolateCell, quantize, sampleQuantized, tileIndex,
} from '../src/world/heightField';
import { buildChunkMesh, buildLodIndices, createMeshBuffers } from '../src/world/terrainMesh';

const tile = (cx: number, cz: number): Int16Array => generateTile(cx, cz, new Int16Array(TILE_DIM * TILE_DIM));

describe('deterministic noise', () => {
  it('hash2 is a pure integer function with pinned values', () => {
    // Golden values: a change here means every saved world changes shape.
    expect(hash2(0, 0, 0)).toBe(0);
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
    expect(hash2(-5, 7, 99)).toBe(hash2(-5, 7, 99) >>> 0);
  });

  it('value noise stays in [0, 1) and is continuous across lattice cells', () => {
    for (let i = 0; i < 400; i++) {
      const v = valueNoise(i * 0.37 - 50, i * 0.11 + 3, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.abs(valueNoise(3 - 1e-6, 0.5, 1) - valueNoise(3 + 1e-6, 0.5, 1))).toBeLessThan(1e-4);
  });
});

describe('authoritative height field', () => {
  it('reproduces the pinned tile hashes (terrain golden baseline, TERRAIN_VERSION 2: Hellesylt)', () => {
    const hashes = [[0, 0], [-4, -6], [7, 9], [-16, 15]].map(([cx, cz]) => fnv1a16(tile(cx, cz)));
    expect(hashes).toMatchInlineSnapshot(`
      [
        3864699462,
        3553209285,
        4108547081,
        83870858,
      ]
    `);
  });

  it('is identical on repeated generation', () => {
    expect(fnv1a16(tile(3, -5))).toBe(fnv1a16(tile(3, -5)));
  });

  it('neighbouring tiles agree on their shared border and aprons', () => {
    const a = tile(2, 1);
    const b = tile(3, 1);
    const c = tile(2, 2);
    for (let k = -1; k <= 33; k++) {
      expect(a[tileIndex(32, k)]).toBe(b[tileIndex(0, k)]);
      expect(a[tileIndex(33, k)]).toBe(b[tileIndex(1, k)]);
      expect(a[tileIndex(k, 32)]).toBe(c[tileIndex(k, 0)]);
    }
  });

  it('heightAt equals the lattice value at lattice points and is continuous inside cells', () => {
    for (const [ix, iz] of [[0, 0], [-37, 12], [200, -150], [511, 511]]) {
      expect(heightAt(ix * CELL_SIZE, iz * CELL_SIZE)).toBeCloseTo(dequantize(sampleQuantized(ix, iz)), 9);
    }
    // Across the cell diagonal both triangle formulas must meet.
    expect(interpolateCell(1, 5, 9, 2, 0.4, 0.6)).toBeCloseTo(interpolateCell(1, 5, 9, 2, 0.4 + 1e-9, 0.6), 6);
  });

  it('stays within the Int16 range over the whole world and beyond the baked square', () => {
    for (let z = WORLD_MIN; z <= WORLD_MAX; z += 16) {
      for (let x = WORLD_MIN; x <= WORLD_MAX; x += 16) {
        const q = sampleQuantized(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
        expect(Number.isInteger(q)).toBe(true);
        expect(q).toBeGreaterThanOrEqual(-32768);
        expect(q).toBeLessThanOrEqual(32767);
      }
    }
  });

  it('quantises as q * 0.02 + 600 m and round-trips', () => {
    expect(HEIGHT_QUANTUM).toBe(0.02);
    expect(HEIGHT_OFFSET).toBe(600);
    expect(dequantize(-32768)).toBeCloseTo(-55.36, 9);
    expect(dequantize(32767)).toBeCloseTo(1255.34, 9);
    for (const q of [-32768, -27500, -1, 0, 1, 12345, 32767]) expect(quantize(dequantize(q))).toBe(q);
    expect(quantize(1e6)).toBe(32767);
    expect(quantize(-1e6)).toBe(-32768);
  });

  it('throws instead of falling back to procedural heights when no terrain is installed', async () => {
    vi.resetModules();
    const fresh = await import('../src/world/heightField');
    expect(() => fresh.sampleQuantized(0, 0)).toThrow(/not installed/);
    vi.resetModules();
  });
});

describe('Hellesylt layout', () => {
  it('peaks between 1000 and 1060 m inside the baked square', () => {
    let highest = -Infinity;
    for (let iz = -1024; iz < 1024; iz += 2) for (let ix = -1024; ix < 1024; ix += 2) highest = Math.max(highest, dequantize(sampleQuantized(ix, iz)));
    expect(highest).toBeGreaterThan(1000);
    expect(highest).toBeLessThan(1060);
  });

  it('has deep fjord water to the north-east, over 10 m below sea level', () => {
    expect(heightAt(1500, -1500)).toBeLessThan(-10);
    expect(heightAt(1000, -1000)).toBeLessThan(-10);
  });

  it('has flat ground in the village disc with a mean slope under 6 degrees', () => {
    let sum = 0;
    let count = 0;
    for (let dz = -TOWN_RADIUS; dz <= TOWN_RADIUS; dz += 4) {
      for (let dx = -TOWN_RADIUS; dx <= TOWN_RADIUS; dx += 4) {
        if (Math.hypot(dx, dz) > TOWN_RADIUS) continue;
        const x = TOWN_X + dx;
        const z = TOWN_Z + dz;
        const gx = (heightAt(x + 1, z) - heightAt(x - 1, z)) / 2;
        const gz = (heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
        sum += (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
        count++;
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(sum / count).toBeLessThan(6);
    expect(heightAt(TOWN_X, TOWN_Z)).toBeGreaterThan(0.5);
    expect(heightAt(TOWN_X, TOWN_Z)).toBeLessThan(5);
  });

  it('is open deep water (-55 m) outside the baked square', () => {
    for (const [x, z] of [[2100, 0], [0, 2100], [-2100, 100], [0, -2100], [3000, 3000], [2048, 2048], [-2050, -2050]]) {
      expect(Math.abs(heightAt(x, z) + 55)).toBeLessThanOrEqual(HEIGHT_QUANTUM);
    }
  });
});

describe('chunk meshes', () => {
  it('LOD 0 render vertices sit exactly on the authoritative surface', () => {
    const cx = -3;
    const cz = 4;
    const mesh = createMeshBuffers(0);
    buildChunkMesh(tile(cx, cz), cx, cz, 0, mesh);
    const n = lodSide(0);
    let worst = 0;
    for (let v = 0; v < n * n; v++) {
      const x = cx * CHUNK_SIZE + mesh.positions[v * 3];
      const z = cz * CHUNK_SIZE + mesh.positions[v * 3 + 2];
      worst = Math.max(worst, Math.abs(mesh.positions[v * 3 + 1] - heightAt(x, z)));
    }
    // Only f32 rounding of the stored height separates them (spec limit: 2 cm).
    expect(worst).toBeLessThan(1e-4);
  });

  it('the rendered LOD 0 triangles match collision height everywhere inside a cell', () => {
    const cx = 6;
    const cz = 5; // hilly chunk
    const mesh = createMeshBuffers(0);
    buildChunkMesh(tile(cx, cz), cx, cz, 0, mesh);
    const index = buildLodIndices(0);
    let worst = 0;
    for (let t = 0; t < 32 * 32 * 2; t += 7) {
      const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
      // Barycentric interior point of the rendered triangle.
      const w = [0.2, 0.3, 0.5];
      let px = 0, py = 0, pz = 0;
      [a, b, c].forEach((v, k) => {
        px += mesh.positions[v * 3] * w[k];
        py += mesh.positions[v * 3 + 1] * w[k];
        pz += mesh.positions[v * 3 + 2] * w[k];
      });
      worst = Math.max(worst, Math.abs(py - heightAt(cx * CHUNK_SIZE + px, cz * CHUNK_SIZE + pz)));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('shared border vertices get identical heights and normals in both chunks', () => {
    const left = createMeshBuffers(0);
    const right = createMeshBuffers(0);
    buildChunkMesh(tile(0, 8), 0, 8, 0, left);
    buildChunkMesh(tile(1, 8), 1, 8, 0, right);
    const n = lodSide(0);
    for (let j = 0; j < n; j++) {
      const l = j * n + (n - 1);
      const r = j * n;
      expect(left.positions[l * 3 + 1]).toBe(right.positions[r * 3 + 1]);
      for (let k = 0; k < 3; k++) expect(left.normals[l * 3 + k]).toBe(right.normals[r * 3 + k]);
    }
  });

  it('every LOD has in-range indices, upward grid triangles and unit normals', () => {
    for (let lod = 0; lod <= 4; lod++) {
      const mesh = createMeshBuffers(lod);
      buildChunkMesh(tile(5, 6), 5, 6, lod, mesh);
      const index = buildLodIndices(lod);
      expect(index.length).toBe(lodIndexCount(lod));
      expect(Math.max(...index)).toBe(lodVertexCount(lod) - 1);
      const q = lodSide(lod) - 1;
      for (let t = 0; t < q * q * 2; t++) {
        const p = (v: number, k: number): number => mesh.positions[index[t * 3 + v] * 3 + k];
        const ux = p(1, 0) - p(0, 0), uy = p(1, 1) - p(0, 1), uz = p(1, 2) - p(0, 2);
        const vx = p(2, 0) - p(0, 0), vy = p(2, 1) - p(0, 1), vz = p(2, 2) - p(0, 2);
        expect(uz * vx - ux * vz).toBeGreaterThan(0); // +y component of the face normal
        void uy; void vy;
      }
      for (let v = 0; v < lodVertexCount(lod); v++) {
        const len = Math.hypot(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]);
        expect(len).toBeCloseTo(1, 5);
      }
      expect(mesh.minY).toBeLessThan(mesh.maxY);
    }
  });
});

describe('chunk grid and LOD selection', () => {
  it('slot mapping round-trips', () => {
    for (const [cx, cz] of [[-16, -16], [0, 0], [15, 15], [-1, 7]]) {
      const slot = slotOf(cx, cz);
      expect(slotCx(slot)).toBe(cx);
      expect(slotCz(slot)).toBe(cz);
    }
  });

  it('picks coarser LODs with distance and unloads past the view radius', () => {
    const policy = { lod0Distance: 100, viewRadius: 1000 };
    expect(selectLod(50, policy, -1, 0)).toBe(0);
    expect(selectLod(150, policy, -1, 0)).toBe(1);
    expect(selectLod(350, policy, -1, 0)).toBe(2);
    expect(selectLod(900, policy, -1, 0)).toBe(4);
    expect(selectLod(1001, policy, -1, 0)).toBe(-1);
    expect(selectLod(50, policy, -1, 2)).toBe(2);
    expect(selectLod(900, policy, -1, 3)).toBe(4);
  });

  it('applies hysteresis at band edges', () => {
    const policy = { lod0Distance: 100, viewRadius: 1000 };
    expect(selectLod(105, policy, 0, 0)).toBe(0);
    expect(selectLod(95, policy, 1, 0)).toBe(1);
    expect(selectLod(130, policy, 0, 0)).toBe(1);
    expect(selectLod(1050, policy, 4, 0)).toBe(4);
    expect(selectLod(1100, policy, 4, 0)).toBe(-1);
  });
});
