/**
 * Baked real terrain (Hellesylt): decoding and storage. Pure; the bytes are
 * fetched and inflated by the caller (src/app/terrainAssets.ts in the browser,
 * tests/setup/terrain.ts under Node) and handed over as Int16 tiles.
 *
 * Layout: a 4 x 4 grid of 512 x 512 sample tiles (1024 m each) forms one
 * 2048 x 2048 lattice at 2 m spacing, north first (row 0 is z = -2048).
 */
export const TERRAIN_TILE_SAMPLES = 512;
export const TERRAIN_TILES_PER_SIDE = 4;
export const TERRAIN_SAMPLES = TERRAIN_TILE_SAMPLES * TERRAIN_TILES_PER_SIDE;
export const TERRAIN_TILE_COUNT = TERRAIN_TILES_PER_SIDE * TERRAIN_TILES_PER_SIDE;

/** The installed lattice (row-major, TERRAIN_SAMPLES per row), or null before installTerrain. */
export let terrainGrid: Int16Array | null = null;

/**
 * Inverse of the bake's per-tile encoding after inflation: little-endian Int16
 * values, each row stored as its first sample raw, then wrapped differences.
 */
export function decodeTile(bytes: Uint8Array): Int16Array {
  const dim = TERRAIN_TILE_SAMPLES;
  if (bytes.length !== dim * dim * 2) {
    throw new Error(`terrain tile has ${bytes.length} bytes, expected ${dim * dim * 2}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(dim * dim);
  for (let j = 0; j < dim; j++) {
    let value = 0;
    const row = j * dim;
    for (let i = 0; i < dim; i++) {
      value = (value + view.getInt16((row + i) * 2, true)) << 16 >> 16;
      out[row + i] = value;
    }
  }
  return out;
}

/** Assembles the 16 decoded tiles (index = row * 4 + col, row 0 northmost) into the global lattice. */
export function installTerrain(tiles: readonly Int16Array[]): void {
  if (tiles.length !== TERRAIN_TILE_COUNT) throw new Error(`expected ${TERRAIN_TILE_COUNT} terrain tiles, got ${tiles.length}`);
  const dim = TERRAIN_TILE_SAMPLES;
  const grid = new Int16Array(TERRAIN_SAMPLES * TERRAIN_SAMPLES);
  for (let t = 0; t < TERRAIN_TILE_COUNT; t++) {
    const tile = tiles[t];
    if (tile.length !== dim * dim) throw new Error(`terrain tile ${t} has ${tile.length} samples`);
    const col = t % TERRAIN_TILES_PER_SIDE;
    const row = (t - col) / TERRAIN_TILES_PER_SIDE;
    for (let j = 0; j < dim; j++) {
      grid.set(tile.subarray(j * dim, (j + 1) * dim), (row * dim + j) * TERRAIN_SAMPLES + col * dim);
    }
  }
  installTerrainGrid(grid);
}

/** Installs a validated worker-built lattice without assembling its tiles a second time. */
export function installTerrainGrid(grid: Int16Array): void {
  if (grid.length !== TERRAIN_SAMPLES ** 2) throw new Error('Invalid assembled terrain lattice size');
  terrainGrid = grid;
}

export function terrainInstalled(): boolean {
  return terrainGrid !== null;
}
