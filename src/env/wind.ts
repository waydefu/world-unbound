/**
 * Local wind from the global wind and the baked fjord channel (spec G2.1 phase A.2). Pure.
 *
 * `axisX/axisZ` is the unit direction of the local valley axis (its sign is arbitrary), `coherence` how clearly
 * that axis is defined (0 flat or isotropic .. 1 a straight valley), `openness` the sky-view of the point
 * (1 exposed ridge or open water, near 0 a narrow gorge). Channelling = (1 - openness) * coherence: the wind
 * direction is rotated towards the axis (to whichever of the two ways blows with the wind), and the speed is
 * scaled by the shelter factor.
 */
export interface LocalWind {
  /** Wind velocity, m/s, +x east, +z south. */
  x: number;
  z: number;
  /** Speed factor applied, 0..1 (1 = fully exposed). */
  shelter: number;
  /** Channelling that was applied, 0..1. */
  channelling: number;
}

export function createLocalWind(): LocalWind {
  return { x: 0, z: 0, shelter: 1, channelling: 0 };
}

/** Lowest speed factor of a point that is fully enclosed (openness 0). // unverified: tuned by eye */
export const SHELTER_FLOOR = 0.3;
/** Extra shelter for wind across the axis of an enclosed valley (the walls stop it). // unverified */
const CROSSWIND_SHELTER = 0.5;

/** Unit vector (x east, z south) of a wind that blows towards the compass bearing `dirRad`. @hot */
export function windDirX(dirRad: number): number {
  return Math.sin(dirRad);
}

/** @hot */
export function windDirZ(dirRad: number): number {
  return -Math.cos(dirRad);
}

/**
 * Writes the local wind velocity into `out`.
 * @hot no allocation
 */
export function localWind(
  speedMs: number, dirX: number, dirZ: number, axisX: number, axisZ: number, coherence: number, openness: number,
  out: LocalWind,
): LocalWind {
  const channelling = (1 - openness) * coherence;
  const along = dirX * axisX + dirZ * axisZ;
  const sign = along < 0 ? -1 : 1;
  let dx = dirX + (sign * axisX - dirX) * channelling;
  let dz = dirZ + (sign * axisZ - dirZ) * channelling;
  const len = Math.sqrt(dx * dx + dz * dz);
  // Wind exactly across a fully channelled axis would cancel to zero: keep the original direction then.
  if (len > 1e-6) {
    dx /= len;
    dz /= len;
  } else {
    dx = dirX;
    dz = dirZ;
  }
  const cross = Math.abs(dirX * axisZ - dirZ * axisX);
  const enclosed = 1 - openness;
  const sqrtOpen = Math.sqrt(openness < 0 ? 0 : openness);
  const shelter = (SHELTER_FLOOR + (1 - SHELTER_FLOOR) * sqrtOpen) * (1 - CROSSWIND_SHELTER * enclosed * cross * coherence);
  out.x = dx * speedMs * shelter;
  out.z = dz * speedMs * shelter;
  out.shelter = shelter;
  out.channelling = channelling;
  return out;
}
