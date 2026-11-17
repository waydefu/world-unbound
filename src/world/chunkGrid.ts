import { MAX_LOD, WORLD_CHUNKS, WORLD_HALF_CHUNKS } from './constants';

/** Chunk slot <-> chunk coordinate helpers. Slots are 0..CHUNK_COUNT-1. */
export function slotOf(cx: number, cz: number): number {
  return (cz + WORLD_HALF_CHUNKS) * WORLD_CHUNKS + (cx + WORLD_HALF_CHUNKS);
}
export function slotCx(slot: number): number {
  return (slot % WORLD_CHUNKS) - WORLD_HALF_CHUNKS;
}
export function slotCz(slot: number): number {
  return Math.floor(slot / WORLD_CHUNKS) - WORLD_HALF_CHUNKS;
}
/** Vertices per side of a chunk mesh at `lod` (33, 17, 9, 5, 3). */
export function lodSide(lod: number): number {
  return (32 >> lod) + 1;
}
export function lodVertexCount(lod: number): number {
  const n = lodSide(lod);
  return n * n + 4 * n;
}
export function lodIndexCount(lod: number): number {
  const q = lodSide(lod) - 1;
  return q * q * 6 + 4 * q * 6;
}

export interface LodPolicy {
  /** Distance (m) at which LOD 0 ends; each further LOD doubles the band. */
  readonly lod0Distance: number;
  /** Chunks farther than this are unloaded. */
  readonly viewRadius: number;
}

/**
 * LOD for a chunk at `distance`, or -1 when it should not be loaded.
 * `current` (-1 if none) adds 12 % hysteresis so a camera resting on a band
 * edge does not flip a chunk back and forth.
 */
export function selectLod(distance: number, policy: LodPolicy, current: number, bias: number): number {
  if (distance > policy.viewRadius * (current >= 0 ? 1.08 : 1)) return -1;
  let lod = 0;
  let edge = policy.lod0Distance;
  while (lod < MAX_LOD && distance > edge) {
    lod++;
    edge *= 2;
  }
  if (current >= 0 && current !== lod) {
    const lower = current === 0 ? 0 : policy.lod0Distance * 2 ** (current - 1);
    const upper = policy.lod0Distance * 2 ** current;
    if (distance > lower * 0.88 && distance < upper * 1.12) lod = current;
  }
  lod += bias;
  return lod > MAX_LOD ? MAX_LOD : lod;
}
