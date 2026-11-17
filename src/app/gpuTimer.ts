import type { WebGPURenderer } from 'three/webgpu';
import { SampleRing } from '../perf/sampleRing';

const SAMPLES = 240;

/**
 * Main-app GPU timing from WebGPU timestamp queries (mirrors spike/threeRunner.ts).
 *
 * three.js keeps one timestamp pair per render context and overwrites it every
 * frame, so each resolve returns the most recent frame's GPU time, not a sum.
 * Resolving is asynchronous; only one resolve is in flight at a time, so not
 * every frame produces a sample.
 *
 * Mobile GPUs down-clock when lightly loaded, so absolute values are inflated:
 * compare A/B runs of the same build and device, never read them as a budget.
 * Never active on WebGL2 or when the adapter lacks `timestamp-query`.
 */
export class GpuTimer {
  readonly active: boolean;
  private readonly ring = new SampleRing(SAMPLES);
  private pending = false;

  constructor(private readonly renderer: WebGPURenderer, webgpu: boolean) {
    this.active = webgpu && renderer.hasFeature('timestamp-query');
  }

  private readonly onResolved = (latest: number | undefined): void => {
    if (typeof latest === 'number' && latest > 0) this.ring.push(latest);
    this.pending = false;
  };

  private readonly onFailed = (): void => {
    this.pending = false;
  };

  /** Call right after `renderer.render`. @hot */
  afterRender(): void {
    if (!this.active || this.pending) return;
    this.pending = true;
    void this.renderer.resolveTimestampsAsync('render').then(this.onResolved, this.onFailed);
  }

  /** Samples in the ring, or null when GPU timing is unavailable. */
  get samples(): number | null {
    return this.active ? this.ring.count : null;
  }

  /** @amortized telemetry only */
  p50(): number | null {
    return this.active ? this.ring.percentile(0.5) : null;
  }

  /** @amortized telemetry only */
  p95(): number | null {
    return this.active ? this.ring.percentile(0.95) : null;
  }
}
