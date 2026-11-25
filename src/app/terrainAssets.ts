import { TERRAIN_TILE_COUNT, TERRAIN_TILES_PER_SIDE, decodeTile, installTerrain } from '../world/terrainData';

/**
 * Fetches the committed terrain tiles, checks each against the manifest digest,
 * inflates them and installs the lattice in the world core. Runs on the main
 * thread only when the terrain worker is unavailable.
 */

export type TerrainProgress = (loaded: number, total: number) => void;

export interface TerrainTileTiming {
  tile: string;
  bytes: number;
  downloadMs: number;
  verifyMs: number;
  inflateMs: number;
  decodeMs: number;
}

export interface TerrainLoadTiming {
  elapsedMs: number;
  assembleMs: number;
  tiles: TerrainTileTiming[];
}

interface TerrainManifest {
  files: { path: string; sha256: string }[];
}

/**
 * The manifest is bundled as JSON. It is pulled in with a glob rather than an
 * import statement because assets/ lies outside src/ and the module-layer audit
 * only knows src/ directories.
 */
const MANIFESTS = import.meta.glob('../../assets/manifests/terrain-hellesylt.json', {
  import: 'default', eager: true,
}) as Record<string, TerrainManifest>;

/** Tile URLs, resolved by the bundler relative to this module (never root-absolute in source). */
const TILE_URLS = import.meta.glob('../../assets/terrain/hellesylt/t_*.bin', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>;

function hex(bytes: ArrayBuffer): string {
  let out = '';
  for (const b of new Uint8Array(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadTile(col: number, row: number): Promise<{ samples: Int16Array; timing: TerrainTileTiming }> {
  const name = `t_${col}_${row}.bin`;
  const manifest = Object.values(MANIFESTS)[0];
  if (!manifest) throw new Error('terrain manifest is missing from the build');
  const entry = manifest.files.find((f) => f.path.endsWith(`/${name}`));
  const url = Object.entries(TILE_URLS).find(([key]) => key.endsWith(`/${name}`))?.[1];
  if (!entry || !url) throw new Error(`terrain tile ${name} is missing from the build`);
  const start = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`terrain tile ${name}: HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const downloaded = performance.now();
  if (!crypto.subtle) throw new Error('terrain integrity check needs a secure context (https or localhost)');
  const digest = hex(await crypto.subtle.digest('SHA-256', compressed as BufferSource));
  if (digest !== entry.sha256) throw new Error(`terrain tile ${name} does not match its manifest digest`);
  const verified = performance.now();
  const inflated = await inflateRaw(compressed);
  const decompressed = performance.now();
  const samples = decodeTile(inflated);
  return { samples, timing: {
    tile: name, bytes: compressed.byteLength, downloadMs: downloaded - start, verifyMs: verified - downloaded,
    inflateMs: decompressed - verified, decodeMs: performance.now() - decompressed,
  } };
}

/** Loads, verifies and installs the terrain; resolves with the elapsed milliseconds. Rejects on any failure. */
export async function loadAndInstallTerrain(onTile?: TerrainProgress): Promise<TerrainLoadTiming> {
  const start = performance.now();
  const jobs: ReturnType<typeof loadTile>[] = [];
  let loaded = 0;
  for (let t = 0; t < TERRAIN_TILE_COUNT; t++) {
    jobs.push(loadTile(t % TERRAIN_TILES_PER_SIDE, Math.floor(t / TERRAIN_TILES_PER_SIDE)).then(tile => {
      onTile?.(++loaded, TERRAIN_TILE_COUNT);
      return tile;
    }));
  }
  const tiles = await Promise.all(jobs);
  const assemble = performance.now();
  installTerrain(tiles.map(tile => tile.samples));
  return { elapsedMs: performance.now() - start, assembleMs: performance.now() - assemble, tiles: tiles.map(tile => tile.timing) };
}
