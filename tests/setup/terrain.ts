import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { TERRAIN_TILE_COUNT, TERRAIN_TILES_PER_SIDE, decodeTile, installTerrain } from '../../src/world/terrainData';

/** Installs the committed Hellesylt terrain for every test file (Node stand-in for src/app/terrainAssets.ts). */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'assets/manifests/terrain-hellesylt.json'), 'utf8')) as {
  files: { path: string; sha256: string }[];
};

const tiles: Int16Array[] = [];
for (let t = 0; t < TERRAIN_TILE_COUNT; t++) {
  const col = t % TERRAIN_TILES_PER_SIDE;
  const row = Math.floor(t / TERRAIN_TILES_PER_SIDE);
  const entry = manifest.files.find((f) => f.path.endsWith(`/t_${col}_${row}.bin`));
  if (!entry) throw new Error(`manifest has no tile ${col}_${row}`);
  const bytes = readFileSync(path.join(root, entry.path));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`tile ${col}_${row} does not match the manifest`);
  tiles.push(decodeTile(inflateRawSync(bytes)));
}
installTerrain(tiles);
