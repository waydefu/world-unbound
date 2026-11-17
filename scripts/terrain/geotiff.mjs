/**
 * Minimal reader for the uncompressed little-endian float32 GeoTIFFs that the
 * Kartverket ImageServer returns (strip-based or tiled; one band).
 * Downloads are untrusted: every offset and size is bounds-checked.
 */

const TAG = { width: 256, height: 257, bits: 258, compression: 259, stripOffsets: 273, stripCounts: 279,
  tileWidth: 322, tileHeight: 323, tileOffsets: 324, tileCounts: 325, sampleFormat: 339, scale: 33550, tie: 33922 };

function check(condition, message) {
  if (!condition) throw new Error(`GeoTIFF: ${message}`);
}

/** Returns { width, height, data: Float32Array, originX, originY, scaleX, scaleY, blankBlocks }. */
export function readGeoTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(bytes.length > 16 && view.getUint16(0, true) === 0x4949 && view.getUint16(2, true) === 42, 'not little-endian TIFF');
  const dir = view.getUint32(4, true);
  check(dir + 2 <= bytes.length, 'directory out of range');
  const count = view.getUint16(dir, true);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const at = dir + 2 + 12 * i;
    check(at + 12 <= bytes.length, 'directory entry out of range');
    tags.set(view.getUint16(at, true), { type: view.getUint16(at + 2, true), count: view.getUint32(at + 4, true), value: view.getUint32(at + 8, true), at: at + 8 });
  }
  const need = (id) => {
    const tag = tags.get(id);
    check(tag, `missing tag ${id}`);
    return tag;
  };
  const scalar = (id) => need(id).value;
  /** Reads `tag` as an array of SHORT/LONG/DOUBLE values. */
  const array = (id) => {
    const tag = need(id);
    const size = tag.type === 3 ? 2 : tag.type === 4 ? 4 : tag.type === 12 ? 8 : 0;
    check(size > 0, `tag ${id} has unsupported type ${tag.type}`);
    const total = size * tag.count;
    const base = total <= 4 ? tag.at : tag.value;
    check(base + total <= bytes.length, `tag ${id} data out of range`);
    const out = [];
    for (let i = 0; i < tag.count; i++) {
      const o = base + i * size;
      out.push(size === 2 ? view.getUint16(o, true) : size === 4 ? view.getUint32(o, true) : view.getFloat64(o, true));
    }
    return out;
  };

  const width = scalar(TAG.width);
  const height = scalar(TAG.height);
  check(width > 0 && height > 0 && width * height <= 1 << 26, 'unreasonable size');
  check(scalar(TAG.bits) === 32 && scalar(TAG.sampleFormat) === 3, 'not float32');
  check(scalar(TAG.compression) === 1, 'compressed TIFF not supported');
  const data = new Float32Array(width * height);
  let blankBlocks = 0;
  const readRun = (offset, length, into) => {
    check(offset + length <= bytes.length, 'pixel data out of range');
    for (let k = 0; k < length / 4; k++) data[into + k] = view.getFloat32(offset + 4 * k, true);
  };

  if (tags.has(TAG.tileOffsets)) {
    const tw = scalar(TAG.tileWidth);
    const th = scalar(TAG.tileHeight);
    const offsets = array(TAG.tileOffsets);
    const counts = array(TAG.tileCounts);
    const across = Math.ceil(width / tw);
    const down = Math.ceil(height / th);
    check(offsets.length === across * down && counts.length === offsets.length, 'tile table size');
    for (let t = 0; t < offsets.length; t++) {
      // Tiles with no stored bytes are blank (the service omits all-nodata blocks); the grid stays 0 = sea.
      if (counts[t] === 0 || offsets[t] === 0) {
        blankBlocks++;
        continue;
      }
      check(counts[t] === tw * th * 4, 'tile byte count');
      check(offsets[t] + counts[t] <= bytes.length, 'tile out of range');
      const x0 = (t % across) * tw;
      const y0 = Math.floor(t / across) * th;
      for (let y = 0; y < th && y0 + y < height; y++) {
        for (let x = 0; x < tw && x0 + x < width; x++) {
          data[(y0 + y) * width + x0 + x] = view.getFloat32(offsets[t] + 4 * (y * tw + x), true);
        }
      }
    }
  } else {
    const offsets = array(TAG.stripOffsets);
    const counts = array(TAG.stripCounts);
    check(offsets.length === counts.length, 'strip table size');
    const rowsPerStrip = tags.has(278) ? scalar(278) : height;
    for (let s = 0; s < offsets.length; s++) {
      if (counts[s] === 0) {
        blankBlocks++;
        continue;
      }
      const into = s * rowsPerStrip * width;
      check(into + counts[s] / 4 <= data.length, 'strips exceed image');
      readRun(offsets[s], counts[s], into);
    }
  }
  const scale = array(TAG.scale);
  const tie = array(TAG.tie);
  return { width, height, data, originX: tie[3], originY: tie[4], scaleX: scale[0], scaleY: scale[1], blankBlocks };
}
