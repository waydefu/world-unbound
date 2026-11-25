import type { WebGPURenderer } from 'three/webgpu';
import { SampleRing } from '../perf/sampleRing';

const SAMPLES = 240;

/** The part of three.js' timestamp query pool read here. */
interface TimestampPool {
  frames: number[];
  timestamps: Map<string, number>;
}

/**
 * Main-app GPU timing from WebGPU timestamp queries (mirrors spike/threeRunner.ts).
 *
 * The value is NOT a frame span. three.js allocates one begin/end timestamp
 * pair per render pass (each shadow cascade, the main pass, ...) and
 * `WebGPUTimestampQueryPool.resolveQueriesAsync` returns the SUM of the
 * per-pass durations of the last frame (`framesDuration[frame] += duration`).
 * On tiled mobile GPUs passes overlap and include waits, and the GPU
 * down-clocks when lightly loaded, so the sum can exceed the frame interval
 * (owner telemetry: sum p50 26 ms while frames held 60 FPS). It is a
 * relative A/B signal only; frame-interval statistics are the acceptance
 * evidence. Resolving is asynchronous and only one resolve is in flight at a
 * time, so not every frame produces a sample.
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

  /** @amortized Read existing render timestamps for the resolved frame without a new GPU readback. */
  lastResolvedPasses(): { frame: number; passes: Array<{ context: string; durationMs: number }> } | null {
    if (!this.active) return null;
    const pool = (this.renderer.backend as unknown as { timestampQueryPool?: { render?: TimestampPool } }).timestampQueryPool?.render;
    if (!pool || pool.frames.length === 0) return null;
    const frame = pool.frames[pool.frames.length - 1];
    const suffix = `:f${frame}`;
    const passes = [];
    for (const [uid, durationMs] of pool.timestamps) {
      if (uid.endsWith(suffix)) passes.push({ context: uid.slice(0, -suffix.length), durationMs });
    }
    return { frame, passes };
  }

  /**
   * Number of timestamped passes in the last resolved frame (read from the render pool's
   * `frames` and per-context `timestamps`, keys `<context>:f<frame>`), or null when unavailable.
   * @amortized telemetry only
   */
  passesPerFrame(): number | null {
    if (!this.active) return null;
    const pool = (this.renderer.backend as unknown as { timestampQueryPool?: { render?: TimestampPool } }).timestampQueryPool?.render;
    if (!pool || pool.frames.length === 0) return null;
    const suffix = `:f${pool.frames[pool.frames.length - 1]}`;
    let count = 0;
    for (const uid of pool.timestamps.keys()) if (uid.endsWith(suffix)) count++;
    return count;
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
