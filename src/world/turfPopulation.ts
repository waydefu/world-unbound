import { WORLD_MIN } from './constants';
import { interpolateCell } from './heightField';
import { sodBarycentric, sodCrownCount, sodHash, sodTriangleSeed, sodWorldAxis, SOD_CROWNS_PER_M2 } from './sodRoots';
import { HEIGHT_DIM, materialDim, type TerrainTextureData } from './terrainTextures';

export const TURF_CROWN_PADDING_M = .14;
export const TURF_CROWN_SPACING_M = 1 / Math.sqrt(SOD_CROWNS_PER_M2);
const SUBTREES = 64;
const MASTER_SIDE = Math.sqrt(SOD_CROWNS_PER_M2);
export type TurfBenchmark = number | 'all';

/** Sample neighbours of the authored turf together, across a continuously warped world field. */
function authoredVariant(x: number, z: number): number {
  const u = x * .89 - z * .34 + .37 * Math.sin(x * .31 + z * .27);
  const v = x * .34 + z * .89 + .31 * Math.sin(z * .27 - x * .18);
  return Math.floor((v - Math.floor(v)) * MASTER_SIDE) * MASTER_SIDE + Math.floor((u - Math.floor(u)) * MASTER_SIDE);
}

/** Full reference placement draws every authored crown at its source position within each metre. */
export function collectTurfMasterReference(terrain: TerrainTextureData, site: { x: number; z: number }, origins: Float32Array, out: Float32Array): number {
  let used = 0;
  const h = terrain.height;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = site.x + col - 1.5, z = site.z + row - 1.5;
    for (let id = 0; id < origins.length / 2; id++) {
      if (used === out.length) return -1;
      const wx = x + origins[id * 2], wz = z + origins[id * 2 + 1];
      const gx = (wx - WORLD_MIN) * .5, gz = (wz - WORLD_MIN) * .5;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const i = iz * HEIGHT_DIM + ix;
      const y = interpolateCell(h[i], h[i + 1], h[i + HEIGHT_DIM], h[i + HEIGHT_DIM + 1], gx - ix, gz - iz);
      out[used++] = wx;
      out[used++] = y;
      out[used++] = wz;
      out[used++] = id + (sodHash(id) >>> 23) / 512;
    }
  }
  return used / 4;
}

export interface TurfWindow {
  x: number; y: number; z: number; reach: number;
  reference: { readonly x: number; readonly z: number } | null;
  hull?: Float32Array;
  hullMargin?: number;
}

/** Shared grass eligibility for the world-root and material paths (RGBA8 vegetation lattice). */
export function turfEligible(terrain: TerrainTextureData, x: number, z: number): boolean {
  const veg = terrain.masks?.vegetation;
  if (!veg) return false;
  const dim = materialDim(terrain.materialStep);
  const step = terrain.materialStep * 2;
  const ix = Math.max(0, Math.min(dim - 1, Math.round((x - WORLD_MIN) / step)));
  const iz = Math.max(0, Math.min(dim - 1, Math.round((z - WORLD_MIN) / step)));
  const p = (iz * dim + ix) * 4;
  return veg[p] + veg[p + 1] >= 123 && veg[p + 3] < 130;
}

/** @hot Conservative support sphere includes the complete leaf, its roots and wind displacement. */
export function turfVisible(planes: Float32Array, x: number, y: number, z: number, padding: number): boolean {
  for (let p = 0; p < 24; p += 4) {
    if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -padding) return false;
  }
  return true;
}

/** Stable world positions before fine frustum compaction, measured against actual triangle surface area. */
export function collectTurfRoots(terrain: TerrainTextureData, bounds: TurfWindow, out: Float32Array, uv: Float64Array): number {
  const { x, y, z, reach, reference, hull, hullMargin = 0 } = bounds;
  const centreX = reference?.x ?? x;
  const centreZ = reference?.z ?? z;
  const range = reference ? 2 : reach;
  const minX = Math.max(0, Math.floor((centreX - range - WORLD_MIN) / 2));
  const minZ = Math.max(0, Math.floor((centreZ - range - WORLD_MIN) / 2));
  const maxX = Math.min(HEIGHT_DIM - 2, Math.floor((centreX + range - WORLD_MIN) / 2));
  const maxZ = Math.min(HEIGHT_DIM - 2, Math.floor((centreZ + range - WORLD_MIN) / 2));
  const h = terrain.height;
  let used = 0;
  for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
    const i = iz * HEIGHT_DIM + ix;
    const a = h[i]; const b = h[i + 1]; const c = h[i + HEIGHT_DIM]; const d = h[i + HEIGHT_DIM + 1];
    if (!Number.isFinite(reach) && hull) {
      const low = Math.min(a, b, c, d), high = Math.max(a, b, c, d);
      if (high <= .08 || !turfVisible(hull, WORLD_MIN + ix * 2 + 1 - x, (low + high) * .5 - y,
        WORLD_MIN + iz * 2 + 1 - z, Math.hypot(1, (high - low) * .5, 1) + hullMargin)) continue;
    }
    for (let upper = 0; upper < 2; upper++) {
      const start = upper ? d : a;
      const dx = upper ? c - d : b - a;
      const dz = upper ? b - d : c - a;
      const count = sodCrownCount(dx, dz);
      const seed = sodTriangleSeed(ix, iz, upper);
      const slack = .36 + .18 * (Math.abs(dx) + Math.abs(dz));
      for (let branch = 0; branch < SUBTREES; branch++) {
        sodBarycentric(branch, seed, uv, 3);
        const bx = sodWorldAxis(ix, uv[0], upper);
        const bz = sodWorldAxis(iz, uv[1], upper);
        const by = start + dx * uv[0] + dz * uv[1];
        if (Math.abs(bx - centreX) > range + slack || Math.abs(bz - centreZ) > range + slack
          || (!reference && Math.hypot(bx - x, by - y, bz - z) > reach + slack)) continue;
        if (hull && !turfVisible(hull, bx - x, by - y, bz - z, slack + hullMargin)) continue;
        for (let k = branch; k < count; k += SUBTREES) {
          sodBarycentric(k, seed, uv);
          const wx = sodWorldAxis(ix, uv[0], upper);
          const wz = sodWorldAxis(iz, uv[1], upper);
          const wy = start + dx * uv[0] + dz * uv[1];
          if (reference ? Math.abs(wx - centreX) >= 2 || Math.abs(wz - centreZ) >= 2
            : (wx - x) ** 2 + (wy - y) ** 2 + (wz - z) ** 2 >= reach * reach) continue;
          if (wy <= .08 || !turfEligible(terrain, wx, wz)) continue;
          if (used === out.length) return -1;
          const key = sodHash(seed ^ Math.imul(k, 0x9e3779b1));
          out[used++] = wx;
          out[used++] = wy;
          out[used++] = wz;
          out[used++] = authoredVariant(wx, wz) + (key >>> 23) / 512;
        }
      }
    }
  }
  return used / 4;
}
