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
