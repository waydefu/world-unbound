import { CELL_SIZE, CHUNK_CELLS, HEIGHT_QUANTUM, TILE_APRON, TILE_DIM } from './constants';
import { rawHeight } from './terrainShape';

/**
 * Authoritative terrain. Heights exist only as integers (HEIGHT_QUANTUM units)
 * on a global CELL_SIZE lattice; every consumer interpolates the same lattice
 * with the same triangle split, so render and collision surfaces coincide.
 */

/** Quantised height at lattice point (ix, iz). ix/iz are global and may be negative. */
export function sampleQuantized(ix: number, iz: number): number {
  const q = Math.round(rawHeight(ix * CELL_SIZE, iz * CELL_SIZE) / HEIGHT_QUANTUM);
  return q > 32767 ? 32767 : q < -32768 ? -32768 : q;
}

/**
 * Interpolates one lattice cell. Each cell is split along the (1,0)-(0,1)
 * diagonal; terrain meshes must index their triangles the same way.
 */
export function interpolateCell(h00: number, h10: number, h01: number, h11: number, fx: number, fz: number): number {
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/** Authoritative ground/seabed height in metres at any world position. */
export function heightAt(x: number, z: number): number {
  const gx = x / CELL_SIZE;
  const gz = z / CELL_SIZE;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const h = interpolateCell(
    sampleQuantized(ix, iz),
    sampleQuantized(ix + 1, iz),
    sampleQuantized(ix, iz + 1),
    sampleQuantized(ix + 1, iz + 1),
    gx - ix,
    gz - iz,
  );
  return h * HEIGHT_QUANTUM;
}

/** Fills a TILE_DIM x TILE_DIM tile (chunk samples plus apron) for chunk (cx, cz). */
export function generateTile(cx: number, cz: number, out: Int16Array): Int16Array {
  const baseX = cx * CHUNK_CELLS - TILE_APRON;
  const baseZ = cz * CHUNK_CELLS - TILE_APRON;
  for (let j = 0; j < TILE_DIM; j++) {
    const row = j * TILE_DIM;
    for (let i = 0; i < TILE_DIM; i++) {
      out[row + i] = sampleQuantized(baseX + i, baseZ + j);
    }
  }
  return out;
}

/** Index into a tile for chunk-local sample (i, j), each in [-APRON, CHUNK_SAMPLES - 1 + APRON]. */
export function tileIndex(i: number, j: number): number {
  return (j + TILE_APRON) * TILE_DIM + (i + TILE_APRON);
}

/**
 * Un-normalised surface normal at chunk-local sample (i, j) by central
 * differences. It only depends on lattice values, never on which chunk asks,
 * so shared border vertices get identical normals in both chunks.
 */
export function tileNormal(tile: Int16Array, i: number, j: number, out: Float32Array, offset: number): void {
  const dx = (tile[tileIndex(i + 1, j)] - tile[tileIndex(i - 1, j)]) * HEIGHT_QUANTUM;
  const dz = (tile[tileIndex(i, j + 1)] - tile[tileIndex(i, j - 1)]) * HEIGHT_QUANTUM;
  const nx = -dx;
  const ny = 2 * CELL_SIZE;
  const nz = -dz;
  const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  out[offset] = nx * inv;
  out[offset + 1] = ny * inv;
  out[offset + 2] = nz * inv;
}
