import { QUAY_Z, TOWN_GROUND_HEIGHT, TOWN_HALF_X, TOWN_HALF_Z, WORLD_SEED } from './constants';
import { fbm, smoothstep, valueNoise } from './hash';

/**
 * Continuous (pre-quantisation) terrain shape of the Sankt Aldric harbour area.
 * This is the single source of the land/sea layout; heightField.ts quantises it
 * and is the authority that rendering and collision both read.
 */

/** z of the shoreline for a given x. Land is south of it (larger z). */
export function coastlineZ(x: number): number {
  const natural = -330 + (fbm(x / 520 + 3.1, 0.37, 3, WORLD_SEED + 11) - 0.5) * 380;
  // The harbour bay: the shore is pulled in to the quay line in front of the town.
  const bay = 1 - smoothstep(TOWN_HALF_X - 10, TOWN_HALF_X + 190, Math.abs(x));
  return natural + (QUAY_Z - natural) * bay;
}

/** Signed distance-like measure: positive inland, negative offshore (metres along z). */
export function inlandDistance(x: number, z: number): number {
  return z - coastlineZ(x);
}

/** 1 inside the levelled town ground, fading to 0 over `margin` metres on the landward sides. */
export function townMask(x: number, z: number, margin: number): number {
  const mx = 1 - smoothstep(TOWN_HALF_X + 20, TOWN_HALF_X + 20 + margin, Math.abs(x));
  const south = 1 - smoothstep(TOWN_HALF_Z + 20, TOWN_HALF_Z + 20 + margin, z);
  // The waterfront is a quay: a sharp 3 m transition instead of a beach.
  const north = smoothstep(QUAY_Z - 1.5, QUAY_Z + 1.5, z);
  return mx * south * north;
}

/** 1 inside the dredged harbour basin in front of the quay. */
export function harbourMask(x: number, z: number): number {
  const mx = 1 - smoothstep(TOWN_HALF_X - 40, TOWN_HALF_X + 30, Math.abs(x));
  const near = 1 - smoothstep(QUAY_Z - 1.5, QUAY_Z + 1.5, z);
  const far = smoothstep(QUAY_Z - 230, QUAY_Z - 150, z);
  return mx * near * far;
}

function shoreProfile(d: number): number {
  if (d >= 0) {
    // Beach berm, then a gentle coastal plain.
    return 2.2 * smoothstep(0, 34, d) + 0.0035 * (d < 700 ? d : 700);
  }
  // Shelving seabed: fast near the shore, then a slow slope, capped.
  const k = d / 55;
  const decay = 1 / (1 - k + 0.5 * k * k); // rational stand-in for exp(d/55), deterministic
  const depth = -9 * (1 - decay) + 0.02 * d;
  return depth < -38 ? -38 : depth;
}

/** Terrain height in metres above mean sea level, before quantisation. */
export function rawHeight(x: number, z: number): number {
  const d = inlandDistance(x, z);
  let h = shoreProfile(d);

  const town = townMask(x, z, 60);
  const calm = townMask(x, z, 160);
  if (d > 0) {
    const rise = smoothstep(90, 620, d) * (1 - calm);
    const rolling = fbm(x / 240, z / 240, 5, WORLD_SEED + 1);
    const ridge = valueNoise(x / 760 + 5.5, z / 760 - 2.25, WORLD_SEED + 2);
    h += rise * (40 * rolling * rolling + 26 * ridge * smoothstep(250, 900, d));
    h += (1 - town) * smoothstep(8, 40, d) * 0.5 * (fbm(x / 21, z / 21, 3, WORLD_SEED + 3) - 0.5);
  } else {
    h += smoothstep(0, -20, d) * 0.3 * (fbm(x / 14, z / 14, 2, WORLD_SEED + 4) - 0.5);
  }

  h += (TOWN_GROUND_HEIGHT - h) * town;

  const basin = harbourMask(x, z);
  if (basin > 0) {
    const dredged = -6;
    if (dredged < h) h += (dredged - h) * basin;
  }
  return h;
}
