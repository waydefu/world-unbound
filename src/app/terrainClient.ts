import { runTerrainJob, type TerrainRequest, type TerrainResult } from '../world/terrainJob';

/**
 * Sends terrain jobs to the worker and queues results for the frame loop.
 * If the worker cannot be created or crashes, jobs run on the main thread
 * (one per poll) so the world still streams, only with more frame cost.
 */
export class TerrainClient {
  mode: 'worker' | 'main-thread' = 'worker';
  private worker: Worker | null = null;
  private readonly results: TerrainResult[] = [];
  private readonly fallbackJobs: TerrainRequest[] = [];
  /** Jobs the worker has been sent but not answered, for replay after a crash. */
  private readonly outstanding = new Map<number, TerrainRequest>();

  constructor() {
    try {
      // Relative to this module so the URL is correct under any deploy base.
      this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<TerrainResult>): void => {
        this.outstanding.delete(event.data.seq);
        this.results.push(event.data);
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
    return job ? runTerrainJob(job) : undefined;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
