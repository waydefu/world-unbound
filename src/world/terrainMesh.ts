import { CELL_SIZE, HEIGHT_QUANTUM } from './constants';
import { lodIndexCount, lodSide, lodVertexCount } from './chunkGrid';
import { tileIndex, tileNormal } from './heightField';
import { AO_APRON, AO_DIM, vertexAo } from './terrainAo';
import { classifyTerrain } from './terrainMaterialWeights';

/**
 * Renderer-agnostic chunk mesh data built straight from an authoritative tile.
 * Positions are chunk-local (0..CHUNK_SIZE), which keeps them exact in f32.
 * Grid triangles use the same diagonal as heightField.interpolateCell.
 */
export interface ChunkMeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  /** RGBA8: sand, rock, earth material weights and baked AO (1 = open sky). */
  colors: Uint8Array;
  minY: number;
  maxY: number;
}

export function createMeshBuffers(lod: number): ChunkMeshBuffers {
  const count = lodVertexCount(lod);
  return {
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
    minY: 0,
    maxY: 0,
  };
}

/** Shared index buffer for every chunk at `lod` (grid, then four skirts). */
export function buildLodIndices(lod: number): Uint16Array {
  const n = lodSide(lod);
  const q = n - 1;
  const out = new Uint16Array(lodIndexCount(lod));
  let k = 0;
  for (let j = 0; j < q; j++) {
    for (let i = 0; i < q; i++) {
      const v00 = j * n + i;
      const v10 = v00 + 1;
      const v01 = v00 + n;
      const v11 = v01 + 1;
      out[k++] = v00; out[k++] = v01; out[k++] = v10;
      out[k++] = v10; out[k++] = v01; out[k++] = v11;
    }
  }
  // Skirts. Walking an edge in direction e makes the quad face (e.z, 0, -e.x):
  // north +x, east +z, south -x, west -z all face outwards.
  const skirtBase = n * n;
  for (let side = 0; side < 4; side++) {
    for (let s = 0; s < q; s++) {
      const a = edgeVertex(side, s, n);
      const b = edgeVertex(side, s + 1, n);
      const a2 = skirtBase + side * n + s;
      const b2 = a2 + 1;
      out[k++] = a; out[k++] = b; out[k++] = a2;
      out[k++] = b; out[k++] = b2; out[k++] = a2;
    }
  }
  return out;
}

/** Grid vertex index of step `s` along `side` (0 north, 1 east, 2 south, 3 west). */
function edgeVertex(side: number, s: number, n: number): number {
  const last = n - 1;
  switch (side) {
    case 0: return s;
    case 1: return s * n + last;
    case 2: return last * n + (last - s);
    default: return (last - s) * n;
  }
}

const scratchColor = new Float32Array(3);

/**
 * Fills `out` for chunk (cx, cz) at `lod` from its apron tile. Allocation-free.
 * `aoTile` (generateAoTile) supplies baked AO; without it AO is 1.
 */
export function buildChunkMesh(
  tile: Int16Array, cx: number, cz: number, lod: number, out: ChunkMeshBuffers, aoTile?: Int16Array,
): void {
  const n = lodSide(lod);
  const step = 1 << lod;
  const originX = cx * 32 * CELL_SIZE;
  const originZ = cz * 32 * CELL_SIZE;
  const { positions, normals, colors } = out;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const si = i * step;
      const sj = j * step;
      const y = tile[tileIndex(si, sj)] * HEIGHT_QUANTUM;
      positions[v * 3] = si * CELL_SIZE;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = sj * CELL_SIZE;
      tileNormal(tile, si, sj, normals, v * 3);
      classifyTerrain(originX + si * CELL_SIZE, originZ + sj * CELL_SIZE, y, normals[v * 3 + 1], scratchColor);
      colors[v * 4] = Math.round(scratchColor[0] * 255);
      colors[v * 4 + 1] = Math.round(scratchColor[1] * 255);
      colors[v * 4 + 2] = Math.round(scratchColor[2] * 255);
      colors[v * 4 + 3] = aoTile ? Math.round(vertexAo(aoTile, AO_DIM, AO_APRON, si, sj) * 255) : 255;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Skirt vertices duplicate the edge and drop, hiding cracks between LODs.
  const drop = 1.5 + step * CELL_SIZE * 0.75;
  const skirtBase = n * n;
  for (let side = 0; side < 4; side++) {
    for (let s = 0; s < n; s++) {
      const src = edgeVertex(side, s, n);
      const dst = skirtBase + side * n + s;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - drop;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      normals[dst * 3] = normals[src * 3];
      normals[dst * 3 + 1] = normals[src * 3 + 1];
      normals[dst * 3 + 2] = normals[src * 3 + 2];
      colors[dst * 4] = colors[src * 4];
      colors[dst * 4 + 1] = colors[src * 4 + 1];
      colors[dst * 4 + 2] = colors[src * 4 + 2];
      colors[dst * 4 + 3] = colors[src * 4 + 3];
    }
  }
  out.minY = minY - drop;
  out.maxY = maxY;
}
