/** Pure helpers for the Hellesylt bake: projection, seabed synthesis, tile encoding. */

/** WGS84 lat/lon (degrees) to ETRS89 / UTM zone 32N (EPSG:25832), Krueger series. ETRS89 equals WGS84 to well under a metre here. */
export function toUtm32(latDeg, lonDeg) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const lat = (latDeg * Math.PI) / 180;
  const dLon = ((lonDeg - 9) * Math.PI) / 180;
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(lat)) - c * Math.atanh(c * Math.sin(lat)));
  const xi = Math.atan2(t, Math.cos(dLon));
  const eta = Math.atanh(Math.sin(dLon) / Math.sqrt(1 + t * t));
  let easting = eta;
  let northing = xi;
  for (let j = 1; j <= 3; j++) {
    easting += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    northing += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { easting: 500000 + k0 * A * easting, northing: k0 * A * northing };
}

/** Rounds to the nearest even integer. */
export const evenMetre = (v) => 2 * Math.round(v / 2);

/**
 * Marks water: value <= 0.05 and 4-connected to a cell whose value is exactly 0.
 * Returns a Uint8Array (1 = water).
 */
export function floodWater(height, dim) {
  const water = new Uint8Array(dim * dim);
  const queue = new Int32Array(dim * dim);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < height.length; i++) {
    if (height[i] === 0) {
      water[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % dim;
    const y = (i - x) / dim;
    const visit = (j) => {
      if (!water[j] && height[j] <= 0.05) {
        water[j] = 1;
        queue[tail++] = j;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < dim - 1) visit(i + 1);
    if (y > 0) visit(i - dim);
    if (y < dim - 1) visit(i + dim);
  }
  return water;
}

const INF = 1e20;

/** One-dimensional squared Euclidean distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k] && k > 0) k--;
      else break;
    }
    if (s <= z[k]) {
      // k === 0 and the new parabola dominates everywhere to the left.
      v[0] = q;
      z[0] = -INF;
      z[1] = INF;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Squared distance (in cells) from every cell to the nearest cell where `isSource` is 1. Exact. */
export function squaredDistance(isSource, dim) {
  const grid = new Float64Array(dim * dim);
  for (let i = 0; i < grid.length; i++) grid[i] = isSource[i] ? 0 : INF;
  const f = new Float64Array(dim);
  const d = new Float64Array(dim);
  const v = new Int32Array(dim);
  const z = new Float64Array(dim + 1);
  for (let x = 0; x < dim; x++) {
    for (let y = 0; y < dim; y++) f[y] = grid[y * dim + x];
    edt1d(f, dim, d, v, z);
    for (let y = 0; y < dim; y++) grid[y * dim + x] = d[y];
  }
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) f[x] = grid[y * dim + x];
    edt1d(f, dim, d, v, z);
    for (let x = 0; x < dim; x++) grid[y * dim + x] = d[x];
  }
  return grid;
}

/**
 * Replaces water cells by synthetic seabed: -min(55, 1 + 0.55 d), d = metres to the nearest land cell.
 * Land is left as measured. Returns the water share in [0, 1].
 */
export function synthesiseSeabed(height, dim, spacing) {
  const water = floodWater(height, dim);
  const land = new Uint8Array(dim * dim);
  let waterCount = 0;
  for (let i = 0; i < land.length; i++) {
    land[i] = water[i] ? 0 : 1;
    waterCount += water[i];
  }
  const dist2 = squaredDistance(land, dim);
  for (let i = 0; i < height.length; i++) {
    if (!water[i]) continue;
    const d = Math.sqrt(dist2[i]) * spacing;
    height[i] = -Math.min(55, 1 + 0.55 * d);
  }
  return waterCount / height.length;
}

/** Row-wise delta encoding (first sample raw, then wrapped differences) of an Int16 tile; returns little-endian bytes. */
export function deltaEncode(tile, dim) {
  const out = Buffer.alloc(tile.length * 2);
  for (let j = 0; j < dim; j++) {
    let prev = 0;
    for (let i = 0; i < dim; i++) {
      const v = tile[j * dim + i];
      out.writeInt16LE(((v - prev) << 16) >> 16, (j * dim + i) * 2);
      prev = v;
    }
  }
  return out;
}
