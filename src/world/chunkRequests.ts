import { CHUNK_COUNT, CHUNK_SIZE } from './constants';
import { slotCx, slotCz, selectLod, type LodPolicy } from './chunkGrid';

/**
 * Bounded streaming table: one slot per chunk, so the queue can never grow
 * past CHUNK_COUNT. A request is "cancelled" simply by its desire changing
 * before dispatch; results that arrive stale are rejected by sequence number.
 * All state lives in typed arrays and no method allocates.
 */
export class ChunkRequests {
  /** LOD wanted for each slot, -1 = not wanted. */
  readonly desired = new Int8Array(CHUNK_COUNT).fill(-1);
  /** LOD currently resident, -1 = none. */
  readonly loaded = new Int8Array(CHUNK_COUNT).fill(-1);
  /** LOD of the in-flight request, -1 = none. */
  readonly inFlight = new Int8Array(CHUNK_COUNT).fill(-1);
  readonly inFlightSeq = new Uint32Array(CHUNK_COUNT);
  readonly priority = new Float32Array(CHUNK_COUNT);
  private seq = 0;
  inFlightCount = 0;
  loadedCount = 0;
  /** Requests dropped because the desire changed while they were in flight. */
  staleResults = 0;

  /**
   * Recomputes desires from the camera position and velocity. Prefetch uses
   * the closer of "now" and "lookahead seconds from now" so chunks ahead of a
   * moving camera are requested early.
   */
  updateDesired(
    x: number, z: number, vx: number, vz: number,
    lookahead: number, policy: LodPolicy, lodBias: number,
  ): void {
    const px = x + vx * lookahead;
    const pz = z + vz * lookahead;
    for (let slot = 0; slot < CHUNK_COUNT; slot++) {
      const ccx = (slotCx(slot) + 0.5) * CHUNK_SIZE;
      const ccz = (slotCz(slot) + 0.5) * CHUNK_SIZE;
      const dNow = Math.hypot(ccx - x, ccz - z);
      const dSoon = Math.hypot(ccx - px, ccz - pz);
      const d = dNow < dSoon ? dNow : dSoon;
      this.priority[slot] = d;
      this.desired[slot] = selectLod(d, policy, this.loaded[slot], lodBias);
    }
  }

  /** Slot of the nearest chunk that needs work and is not in flight, or -1. */
  nextToDispatch(): number {
    let best = -1;
    let bestPriority = Infinity;
    for (let slot = 0; slot < CHUNK_COUNT; slot++) {
      const want = this.desired[slot];
      if (want < 0 || want === this.loaded[slot] || this.inFlight[slot] >= 0) continue;
      if (this.priority[slot] < bestPriority) {
        bestPriority = this.priority[slot];
        best = slot;
      }
    }
    return best;
  }

  /** Marks a slot as dispatched and returns the sequence number to send with it. */
  dispatch(slot: number): number {
    this.seq = (this.seq + 1) >>> 0;
    this.inFlight[slot] = this.desired[slot];
    this.inFlightSeq[slot] = this.seq;
    this.inFlightCount++;
    return this.seq;
  }

  /** Returns true when the result is still wanted and should be applied. */
  complete(slot: number, seq: number, lod: number): boolean {
    if (this.inFlight[slot] < 0 || this.inFlightSeq[slot] !== seq) return false;
    this.inFlight[slot] = -1;
    this.inFlightCount--;
    if (this.desired[slot] !== lod) {
      this.staleResults++;
      return false;
    }
    if (this.loaded[slot] < 0) this.loadedCount++;
    this.loaded[slot] = lod;
    return true;
  }

  /** Next loaded slot at or after `from` that is no longer wanted, or -1. */
  nextToEvict(from: number): number {
    for (let slot = from; slot < CHUNK_COUNT; slot++) {
      if (this.loaded[slot] >= 0 && this.desired[slot] < 0) return slot;
    }
    return -1;
  }

  markEvicted(slot: number): void {
    if (this.loaded[slot] >= 0) this.loadedCount--;
    this.loaded[slot] = -1;
  }
}
