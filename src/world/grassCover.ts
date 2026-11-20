import { FESCUE_LEAVES, fescueProfile } from './fescue';
import { hash2 } from './hash';

export const GRASS_COVER_DIM = 256;
export const GRASS_COVER_METRES = 1.6;
export const SWARD_COVER_DIM = 512;
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

/** Virtual leaves in the baked tile, tuned for at least 99% grass canopy coverage. */
export const SWARD_LEAVES_PER_M2 = 32000;
export const SWARD_LEAVES = Math.round(SWARD_LEAVES_PER_M2 * GRASS_COVER_METRES ** 2);
/** Place the same leaf outlines as the foreground shoot, with stable world-independent rotation and colour. */
function swardLeaf(i: number) {
  const seed = 0x3c47;
  const root = hash2(i, 2, seed);
  const shape = hash2(i, 3, seed);
  const scatter = hash2(i, 4, seed);
  const profile = FESCUE_LEAVES[i % FESCUE_LEAVES.length];
  return {
    x: (root & 65535) / 65536 * GRASS_COVER_METRES,
    z: (root >>> 16) / 65536 * GRASS_COVER_METRES,
    angle: (shape & 255) * (Math.PI / 128),
    profile,
    shade: 144 + (scatter >>> 24) / 255 * 72,
  };
}

/**
 * Tileable top canopy (RGBA8). Red stores fibre shade, green the top leaf height, and blue/alpha its direction.
 * Keep the highest overlapping leaf at each texel. Empty texels have zero height and softly shaded colour.
 */
export function buildSwardCover(): Uint8Array {
  const cover = new Uint8Array(SWARD_COVER_DIM ** 2 * 4);
  const wrap = SWARD_COVER_DIM - 1;
  const pxPerM = SWARD_COVER_DIM / GRASS_COVER_METRES;
  for (let offset = 0; offset < cover.length; offset += 4) {
    cover[offset] = 120;
    cover[offset + 2] = 128;
    cover[offset + 3] = 128;
  }
  for (let i = 0; i < SWARD_LEAVES; i++) {
    const leaf = swardLeaf(i);
    const dx = Math.cos(leaf.angle);
    const dz = Math.sin(leaf.angle);
    const steps = Math.ceil(leaf.profile[1] * pxPerM * 2.5);
    const dirX = Math.round(dx * 127 + 128);
    const dirZ = Math.round(dz * 127 + 128);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const [reach, y, half] = fescueProfile(leaf.profile, t);
      const x = (leaf.x + dx * reach) * pxPerM;
      const z = (leaf.z + dz * reach) * pxPerM;
      const roll = (12 + 32 * t) * Math.PI / 180;
      const radius = half * Math.cos(roll) * pxPerM;
      const height = Math.round(255 * y / 0.115);
      for (let across = -1; across <= 1; across++) {
        const ix = Math.floor(x - dz * across * radius) & wrap;
        const iz = Math.floor(z + dx * across * radius) & wrap;
        const offset = (iz * SWARD_COVER_DIM + ix) * 4;
        if (height <= cover[offset + 1]) continue;
        cover[offset] = Math.round(leaf.shade + t * 24 - Math.abs(across) * 20);
        cover[offset + 1] = height;
        cover[offset + 2] = dirX;
        cover[offset + 3] = dirZ;
      }
    }
  }
  return cover;
}
