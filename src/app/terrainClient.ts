import { SEAFLOOR_DIM, buildSeaFloor } from '../world/seaFloor';
import { runTerrainJob, type TerrainRequest, type TerrainResult } from '../world/terrainJob';

/**
 * Sends terrain jobs to the worker and queues results for the frame loop.
 * If the worker cannot be created or crashes, jobs run on the main thread
 * (one per poll) so the world still streams, only with more frame cost.
 */
type WorkerNotice =
  | { kind: 'seafloor'; heights: Float32Array }
  | { kind: 'terrain-ready'; ms: number }
  | { kind: 'terrain-error'; message: string };

export class TerrainClient {
  mode: 'worker' | 'main-thread' = 'worker';
  /** Milliseconds the worker needed to fetch, verify and decode the terrain tiles (0 until it reports). */
  workerLoadMs = 0;
  private worker: Worker | null = null;
  private readonly results: TerrainResult[] = [];
  private readonly fallbackJobs: TerrainRequest[] = [];
  /** Jobs the worker has been sent but not answered, for replay after a crash. */
  private readonly outstanding = new Map<number, TerrainRequest>();
  /** Pending sea-floor request (worker mode), resolved by the matching reply. */
  private seaFloorWaiters: Array<(heights: Float32Array) => void> = [];

  constructor() {
    try {
      // Relative to this module so the URL is correct under any deploy base.
      this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<TerrainResult | WorkerNotice>): void => {
        const data = event.data;
        if ('kind' in data) {
          if (data.kind === 'terrain-ready') {
            this.workerLoadMs = data.ms;
            return;
          }
          if (data.kind === 'terrain-error') {
            console.warn(`[world-unbound] terrain worker could not load the tiles: ${data.message}`);
            this.fallBack();
            return;
          }
          const waiters = this.seaFloorWaiters;
          this.seaFloorWaiters = [];
          for (const resolve of waiters) resolve(data.heights);
          return;
        }
        this.outstanding.delete(data.seq);
        this.results.push(data);
      };
      this.worker.onerror = (): void => this.fallBack();
    } catch {
      this.fallBack();
    }
  }

  private fallBack(): void {
    this.mode = 'main-thread';
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.outstanding.values()) this.fallbackJobs.push(request);
    this.outstanding.clear();
    // A crash loses any pending sea-floor reply; build it here instead.
    const waiters = this.seaFloorWaiters;
    this.seaFloorWaiters = [];
    if (waiters.length > 0) {
      const heights = buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
      for (const resolve of waiters) resolve(heights);
    }
  }

  /** Sea-floor height map for the ocean shader (built in the worker, or inline in fallback mode). */
  requestSeaFloor(): Promise<Float32Array> {
    if (!this.worker) return Promise.resolve(buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM)));
    return new Promise((resolve) => {
      this.seaFloorWaiters.push(resolve);
      this.worker?.postMessage({ kind: 'seafloor' });
    });
  }

  request(job: TerrainRequest): void {
    if (this.worker) {
      this.outstanding.set(job.seq, job);
      this.worker.postMessage(job);
    } else {
      this.fallbackJobs.push(job);
    }
  }

  /** Next finished result, or undefined. In fallback mode this performs one job. */
  poll(): TerrainResult | undefined {
    if (this.results.length > 0) return this.results.shift();
    const job = this.fallbackJobs.shift();
    if (!job) return undefined;
    const started = performance.now();
    const result = runTerrainJob(job);
    result.buildMs = performance.now() - started;
    return result;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
