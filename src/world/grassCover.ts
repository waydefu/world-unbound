import { hash2 } from './hash';

export const GRASS_COVER_DIM = 256;
export const GRASS_COVER_METRES = 1.6;
const LEAVES = 5000;
const WRAP = GRASS_COVER_DIM - 1;

/** Tileable overhead grass canopy. Short leaves overlap the lower parts of their neighbours. */
export function buildGrassCover(): Uint8Array {
  const cover = new Uint8Array(GRASS_COVER_DIM ** 2).fill(75);
  for (let i = 0; i < LEAVES; i++) {
    const root = hash2(i, 0, 0x3c47);
    const shape = hash2(i, 1, 0x3c47);
    const angle = (shape & 255) * (Math.PI / 128);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const x = root & WRAP;
    const z = (root >>> 8) & WRAP;
    const length = 6 + ((shape >>> 8) & 7);
    const light = 130 + ((shape >>> 16) & 95);
    for (let step = 0; step < length; step++) {
      const t = step / length;
      const px = x + dx * step - dz * t * t * 2;
      const pz = z + dz * step + dx * t * t * 2;
      for (let across = -1; across <= 1; across++) {
        const ix = Math.round(px - dz * across * (1 - t)) & WRAP;
        const iz = Math.round(pz + dx * across * (1 - t)) & WRAP;
        const at = iz * GRASS_COVER_DIM + ix;
        const shade = light + t * 28 - Math.abs(across) * 35;
        if (shade > cover[at]) cover[at] = shade;
      }
    }
  }
  return cover;
}

/** Lower end of the leaf-count estimate from Missouri Extension's pasture data. */
export const SWARD_LEAVES_PER_M2 = 14000;
export const SWARD_LEAVES = Math.round(SWARD_LEAVES_PER_M2 * GRASS_COVER_METRES ** 2);
export const GRASS_CARD_DIM = 64;

export interface SwardLeaf {
  x: number;
  z: number;
  angle: number;
  length: number;
  height: number;
  width: number;
  shade: number;
}

/** A deterministic short-leaf reference patch, in metres, with clumped and dispersed shoots. */
export function swardLeaf(i: number): SwardLeaf {
  const seed = 0x3c47;
  const root = hash2(i, 2, seed);
  const shape = hash2(i, 3, seed);
  const scatter = hash2(i, 4, seed);
  const clump = hash2(i % 96, 5, seed);
  const clumped = (scatter & 255) < 110;
  const wrap = (metres: number) => (metres + GRASS_COVER_METRES) % GRASS_COVER_METRES;
  const x = clumped ? wrap((clump & 65535) / 65536 * GRASS_COVER_METRES + ((scatter >>> 8 & 255) / 255 - 0.5) * 0.14)
    : (root & 65535) / 65536 * GRASS_COVER_METRES;
  const z = clumped ? wrap((clump >>> 16) / 65536 * GRASS_COVER_METRES + ((scatter >>> 16 & 255) / 255 - 0.5) * 0.14)
    : (root >>> 16) / 65536 * GRASS_COVER_METRES;
  return {
    x, z, angle: (shape & 255) * (Math.PI / 128),
    length: 0.02 + (shape >>> 8 & 255) / 255 * 0.065,
    height: 0.034 + (shape >>> 16 & 255) / 255 * 0.065,
    width: 0.002 + (shape >>> 24) / 255 * 0.003,
    shade: 132 + (scatter >>> 24) / 255 * 72,
  };
}

/** Prebake the dense reference into the existing one-channel terrain canopy, including gaps and overlap. */
export function buildSwardCover(): Uint8Array {
  const cover = new Uint8Array(GRASS_COVER_DIM ** 2).fill(85);
  const pxPerM = GRASS_COVER_DIM / GRASS_COVER_METRES;
  for (let i = 0; i < SWARD_LEAVES; i++) {
    const leaf = swardLeaf(i);
    const dx = Math.cos(leaf.angle);
    const dz = Math.sin(leaf.angle);
    const steps = Math.ceil(leaf.length * pxPerM * 2);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const reach = t * t * leaf.length;
      const x = (leaf.x + dx * reach - dz * reach * t * 0.2) * pxPerM;
      const z = (leaf.z + dz * reach + dx * reach * t * 0.2) * pxPerM;
      const width = leaf.width * pxPerM * (1 - t * 0.8);
      for (let across = -1; across <= 1; across++) {
        const ix = Math.floor(x - dz * across * width) & WRAP;
        const iz = Math.floor(z + dx * across * width) & WRAP;
        const offset = iz * GRASS_COVER_DIM + ix;
        const shade = leaf.shade + t * 25 - Math.abs(across) * 35;
        if (shade > cover[offset]) cover[offset] = shade;
      }
    }
  }
  return cover;
}

/** Seven visible leaves from the short-grass reference, projected into a triangular card. */
export function buildGrassCardMask(): Uint8Array {
  const mask = new Uint8Array(GRASS_CARD_DIM ** 2);
  for (let i = 0; i < 7; i++) {
    const leaf = swardLeaf(i + 12);
    const root = 0.12 + i * 0.125;
    const tip = 0.5 + Math.cos(leaf.angle) * 0.17;
    const height = leaf.height * 8.2 + 0.13;
    for (let y = 0; y < GRASS_CARD_DIM * height; y++) {
      const t = y / (GRASS_CARD_DIM * height);
      const centre = (root + (tip - root) * t * t) * GRASS_CARD_DIM;
      const radius = GRASS_CARD_DIM * (0.047 + leaf.width * 4) * (1 - t * 0.92);
      const offset = y * GRASS_CARD_DIM;
      for (let x = Math.max(0, Math.floor(centre - radius - 1)); x <= Math.min(GRASS_CARD_DIM - 1, centre + radius + 1); x++) {
        const coverage = Math.min(1, Math.max(0, radius + 0.6 - Math.abs(x + 0.5 - centre)));
        mask[offset + x] = Math.max(mask[offset + x], Math.round(coverage * 255));
      }
    }
  }
  return mask;
}
