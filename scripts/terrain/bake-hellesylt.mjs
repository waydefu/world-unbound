#!/usr/bin/env node
/**
 * Bakes the real terrain of Hellesylt, Norway into committed height tiles.
 * Run once by hand; the output under assets/terrain/hellesylt and
 * assets/manifests/terrain-hellesylt.json is the authority (not part of the build or CI).
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/terrain/bake-hellesylt.mjs [--cache <dir>]
 *
 * Source: Kartverket NHM DTM 1 m (bare earth), CC BY 4.0, (c) Kartverket.
 * --cache keeps the raw downloads in <dir> (never inside the repository).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { deltaEncode, evenMetre, synthesiseSeabed, toUtm32 } from './bake-lib.mjs';
import { readGeoTiff } from './geotiff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE = 'https://hoydedata.no/arcgis/rest/services/NHM_DTM_25832/ImageServer/exportImage';
const CENTRE = { lat: 62.083, lon: 6.87 };
const SPACING = 2;
const DIM = 2048; // lattice-point samples per side
const SIDE = DIM * SPACING; // 4096 m
const REQUEST_DIM = 1024; // samples per download
const TILE_DIM = 512;
const TILES = DIM / TILE_DIM;
const HEIGHT_QUANTUM = 0.02;
const HEIGHT_OFFSET = 600;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const PIPELINE = 'terrain-bake/1';
const ENCODING = 'int16-le row-delta, deflate-raw';
const LICENSE = 'CC-BY-4.0';

const cacheArg = process.argv.indexOf('--cache');
const cacheDir = cacheArg > 0 ? path.resolve(process.argv[cacheArg + 1]) : null;
if (cacheDir?.startsWith(root)) throw new Error('--cache must be outside the repository');
if (cacheDir) mkdirSync(cacheDir, { recursive: true });

const utm = toUtm32(CENTRE.lat, CENTRE.lon);
const cx = evenMetre(utm.easting);
const cy = evenMetre(utm.northing);
const x0 = cx - SIDE / 2; // easting of sample column 0
const yTop = cy + SIDE / 2; // northing of sample row 0 (north first)

async function download(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      readGeoTiff(bytes); // validates before it is trusted or cached
      return bytes;
    } catch (error) {
      last = error;
      console.warn(`  attempt ${attempt} failed: ${error.message}`);
    }
  }
  throw new Error(`download failed: ${last?.message}`);
}

/** Downloads the 1024 x 1024 block whose first sample is column `col0`, row `row0`. */
async function block(col0, row0) {
  const xmin = x0 + col0 * SPACING - SPACING / 2;
  const ymax = yTop - row0 * SPACING + SPACING / 2;
  const bbox = [xmin, ymax - REQUEST_DIM * SPACING, xmin + REQUEST_DIM * SPACING, ymax];
  const query = `bbox=${bbox.join(',')}&bboxSR=25832&imageSR=25832&size=${REQUEST_DIM},${REQUEST_DIM}`
    + '&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image';
  const cacheFile = cacheDir ? path.join(cacheDir, `block_${col0}_${row0}.tif`) : null;
  let bytes;
  if (cacheFile && existsSync(cacheFile)) {
    bytes = new Uint8Array(readFileSync(cacheFile));
  } else {
    console.log(`download block col ${col0} row ${row0}: bbox ${bbox.join(',')}`);
    bytes = await download(`${SERVICE}?${query}`);
    if (cacheFile) writeFileSync(cacheFile, bytes);
  }
  const image = readGeoTiff(bytes);
  if (image.width !== REQUEST_DIM || image.height !== REQUEST_DIM) throw new Error('unexpected image size');
  if (Math.abs(image.originX - bbox[0]) > 1e-6 || Math.abs(image.originY - bbox[3]) > 1e-6) throw new Error('unexpected georeference');
  if (image.scaleX !== SPACING || image.scaleY !== SPACING) throw new Error('unexpected pixel size');
  return image;
}

const height = new Float32Array(DIM * DIM);
let blankBlocks = 0;
for (let by = 0; by < DIM / REQUEST_DIM; by++) {
  for (let bx = 0; bx < DIM / REQUEST_DIM; bx++) {
    const image = await block(bx * REQUEST_DIM, by * REQUEST_DIM);
    blankBlocks += image.blankBlocks;
    for (let j = 0; j < REQUEST_DIM; j++) {
      height.set(image.data.subarray(j * REQUEST_DIM, (j + 1) * REQUEST_DIM), (by * REQUEST_DIM + j) * DIM + bx * REQUEST_DIM);
    }
  }
}
for (let i = 0; i < height.length; i++) {
  // Reject anything that is not a plausible bare-earth elevation instead of baking garbage.
  if (!(height[i] > -50 && height[i] < 2500)) throw new Error(`implausible sample ${height[i]} at index ${i}`);
}

const waterShare = synthesiseSeabed(height, DIM, SPACING);

const quantised = new Int16Array(DIM * DIM);
let minH = Infinity;
let maxH = -Infinity;
for (let i = 0; i < height.length; i++) {
  const q = Math.round((height[i] - HEIGHT_OFFSET) / HEIGHT_QUANTUM);
  if (q < -32768 || q > 32767) throw new Error(`height ${height[i]} outside the quantised range`);
  quantised[i] = q;
  minH = Math.min(minH, q * HEIGHT_QUANTUM + HEIGHT_OFFSET);
  maxH = Math.max(maxH, q * HEIGHT_QUANTUM + HEIGHT_OFFSET);
}

const outDir = path.join(root, 'assets', 'terrain', 'hellesylt');
mkdirSync(outDir, { recursive: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const retrieved = new Date().toISOString().slice(0, 10);
const originOf = (col, row) => ({ sampleColumn: col * TILE_DIM, sampleRow: row * TILE_DIM });
const tiles = [];
let maxBytes = 0;
for (let row = 0; row < TILES; row++) {
  for (let col = 0; col < TILES; col++) {
    const tile = new Int16Array(TILE_DIM * TILE_DIM);
    for (let j = 0; j < TILE_DIM; j++) {
      const from = (row * TILE_DIM + j) * DIM + col * TILE_DIM;
      tile.set(quantised.subarray(from, from + TILE_DIM), j * TILE_DIM);
    }
    const bytes = zlib.deflateRawSync(deltaEncode(tile, TILE_DIM), { level: 9 });
    if (bytes.length > MAX_TILE_BYTES) throw new Error(`tile ${col}_${row} is ${bytes.length} bytes (> 2 MiB)`);
    const rel = `assets/terrain/hellesylt/t_${col}_${row}.bin`;
    writeFileSync(path.join(root, rel), bytes);
    maxBytes = Math.max(maxBytes, bytes.length);
    tiles.push({
      path: rel, sha256: sha256(bytes), origin: `Kartverket NHM DTM 1 m, baked by ${PIPELINE}`, license: LICENSE,
      encoding: ENCODING, pipeline_version: PIPELINE, bytes: bytes.length, col, row, ...originOf(col, row),
    });
  }
}

const manifest = {
  schema_version: 1,
  description: 'Hellesylt bare-earth terrain, 4096 m square, 2 m lattice, 16 tiles of 512 x 512 samples',
  source_product: 'Kartverket Nasjonal hoydemodell (NHM) DTM 1 m, bare earth',
  source_service: SERVICE,
  source_crs: 'EPSG:25832 (ETRS89 / UTM zone 32N)',
  centre_latlon: [CENTRE.lat, CENTRE.lon],
  centre_utm32: { easting: cx, northing: cy },
  bbox_utm32: { xmin: x0, ymin: cy - SIDE / 2, xmax: x0 + (DIM - 1) * SPACING, ymax: yTop, note: 'lattice-point extent (sample centres)' },
  grid: { samples: DIM, spacing_m: SPACING, tile_samples: TILE_DIM, tiles_per_side: TILES,
    orientation: 'row j = z -2048 + 2j (north first), column i = x -2048 + 2i; +x east, +z south; game origin = centre_utm32' },
  quantum_m: HEIGHT_QUANTUM,
  offset_m: HEIGHT_OFFSET,
  retrieved: retrieved,
  license: LICENSE,
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  terms_url: 'https://www.kartverket.no/en/api-and-data/terms-of-use',
  attribution: '© Kartverket',
  modifications: 'Modified: resampled to 2 m, quantised to 2 cm, seabed synthesised',
  pipeline_version: PIPELINE,
  files: tiles,
};
writeFileSync(path.join(root, 'assets', 'manifests', 'terrain-hellesylt.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`centre UTM32 ${cx}, ${cy} (from ${utm.easting.toFixed(2)}, ${utm.northing.toFixed(2)})`);
console.log(`height min ${minH.toFixed(2)} m, max ${maxH.toFixed(2)} m, water ${(waterShare * 100).toFixed(1)} %, blank source blocks ${blankBlocks}`);
console.log(`max tile ${maxBytes} bytes (${(maxBytes / 1024).toFixed(0)} KiB), total ${tiles.reduce((s, t) => s + t.bytes, 0)} bytes`);
