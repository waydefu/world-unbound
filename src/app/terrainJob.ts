import { TILE_DIM } from '../world/constants';
import { generateTile } from '../world/heightField';
import { buildChunkMesh, createMeshBuffers } from '../world/terrainMesh';

/** Messages exchanged with the terrain worker (also used by the main-thread fallback). */
export interface TerrainRequest {
  slot: number;
  seq: number;
  cx: number;
  cz: number;
  lod: number;
}

export interface TerrainResult {
  slot: number;
  seq: number;
  lod: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  minY: number;
  maxY: number;
}

const TILE_CACHE_LIMIT = 256;
const tileCache = new Map<number, Int16Array>();

function tileFor(slot: number, cx: number, cz: number): Int16Array {
  const cached = tileCache.get(slot);
  if (cached) {
    // Refresh recency: Map iteration order is insertion order.
    tileCache.delete(slot);
    tileCache.set(slot, cached);
    return cached;
  }
  let tile: Int16Array;
  if (tileCache.size >= TILE_CACHE_LIMIT) {
    const oldest = tileCache.keys().next().value as number;
    tile = tileCache.get(oldest) as Int16Array;
    tileCache.delete(oldest);
  } else {
    tile = new Int16Array(TILE_DIM * TILE_DIM);
  }
  generateTile(cx, cz, tile);
  tileCache.set(slot, tile);
  return tile;
}

/** Generates (or reuses) the authoritative tile and builds the mesh for one request. */
export function runTerrainJob(request: TerrainRequest): TerrainResult {
  const tile = tileFor(request.slot, request.cx, request.cz);
  const buffers = createMeshBuffers(request.lod);
  buildChunkMesh(tile, request.cx, request.cz, request.lod, buffers);
  return {
    slot: request.slot,
    seq: request.seq,
    lod: request.lod,
    positions: buffers.positions,
    normals: buffers.normals,
    colors: buffers.colors,
    minY: buffers.minY,
    maxY: buffers.maxY,
  };
}

export function resultBytes(result: TerrainResult): number {
  return result.positions.byteLength + result.normals.byteLength + result.colors.byteLength;
}
