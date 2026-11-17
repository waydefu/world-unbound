import { MemoryPartition, Pressure, type MemoryRegistry } from '../perf/memoryRegistry';
import type { TerrainChunks } from '../render/terrainChunks';
import { ChunkRequests } from '../world/chunkRequests';
import { slotCx, slotCz, type LodPolicy } from '../world/chunkGrid';
import { CHUNK_COUNT } from '../world/constants';
import { TerrainClient } from './terrainClient';
import { resultBytes, runTerrainJob, type TerrainRequest } from './terrainJob';

const MAX_IN_FLIGHT = 16;
const APPLY_BUDGET_MS = 3;
const RETARGET_INTERVAL_MS = 250;
const PREFETCH_SECONDS = 0.75;

/**
 * Drives world streaming: retargets desires at low frequency, dispatches the
 * nearest outstanding chunks to the worker, applies results within a per-frame
 * time budget and evicts chunks that left the view radius.
 */
export class TerrainStreamer {
  readonly requests = new ChunkRequests();
  readonly client = new TerrainClient();
  /** Raised under GPU memory pressure: coarser LODs everywhere. */
  lodBias = 0;
  /** True once every wanted chunk is resident at its wanted LOD. */
  settled = false;
  private lastRetarget = -Infinity;
  private evictCursor = 0;

  constructor(
    private readonly chunks: TerrainChunks,
    private readonly memory: MemoryRegistry,
    private readonly policy: LodPolicy,
  ) {}

  /** Forces a retarget on the next update (camera cut, quality change). */
  invalidate(): void {
    this.lastRetarget = -Infinity;
    this.settled = false;
  }

  /**
   * Budgeted streaming step. Mesh installs allocate GPU resources by design;
   * they are amortised across frames instead of happening every frame.
   * @amortized bounded by APPLY_BUDGET_MS and MAX_IN_FLIGHT
   */
  update(now: number, x: number, z: number, vx: number, vz: number): void {
    const { requests, client } = this;
    if (now - this.lastRetarget >= RETARGET_INTERVAL_MS) {
      this.lastRetarget = now;
      const pressure = this.memory.pressure(MemoryPartition.Gpu);
      this.lodBias = pressure === Pressure.Full ? 2 : pressure === Pressure.Reclaim ? 1 : 0;
      requests.updateDesired(x, z, vx, vz, PREFETCH_SECONDS, this.policy, this.lodBias);
      this.evictCursor = 0;
    }

    for (let n = 0; n < 8; n++) {
      const slot = requests.nextToEvict(this.evictCursor);
      if (slot < 0) {
        this.evictCursor = CHUNK_COUNT;
        break;
      }
      this.chunks.evict(slot);
      requests.markEvicted(slot);
      this.evictCursor = slot + 1;
    }

    // Alternate "apply finished results" and "refill the worker" until the
    // time budget is spent, so throughput is not capped by the frame rate.
    const deadline = performance.now() + APPLY_BUDGET_MS;
    for (;;) {
      this.dispatch();
      const result = client.poll();
      if (!result) break;
      const bytes = resultBytes(result);
      this.memory.add(MemoryPartition.Staging, bytes);
      if (requests.complete(result.slot, result.seq, result.lod)) this.chunks.apply(result);
      this.memory.remove(MemoryPartition.Staging, bytes);
      if (performance.now() >= deadline) break;
    }

    this.settled = requests.inFlightCount === 0 && requests.nextToDispatch() < 0;
  }

  private dispatch(): void {
    const { requests } = this;
    while (requests.inFlightCount < MAX_IN_FLIGHT) {
      const slot = requests.nextToDispatch();
      if (slot < 0) return;
      const job: TerrainRequest = {
        slot,
        seq: requests.dispatch(slot),
        cx: slotCx(slot),
        cz: slotCz(slot),
        lod: requests.desired[slot],
      };
      this.client.request(job);
    }
  }

  /**
   * Builds the chunk under the camera synchronously so shader warm-up has real
   * terrain to compile against before the first frame.
   */
  prime(x: number, z: number): void {
    const { requests } = this;
    requests.updateDesired(x, z, 0, 0, 0, this.policy, 0);
    const slot = requests.nextToDispatch();
    if (slot < 0) return;
    const lod = requests.desired[slot];
    const seq = requests.dispatch(slot);
    const result = runTerrainJob({ slot, seq, cx: slotCx(slot), cz: slotCz(slot), lod });
    if (requests.complete(slot, seq, lod)) this.chunks.apply(result);
  }
}
