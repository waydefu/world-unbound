/**
 * Frame-interval statistics over a fixed ring buffer plus a coarse windowed
 * history for long soak runs. Per-frame calls never allocate.
 */
const RING = 4096;
const HISTORY = 256;
export const HISTORY_WINDOW_MS = 10000;

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

export class FrameStats {
  private readonly ring = new Float32Array(RING);
  private readonly scratch = new Float32Array(RING);
  private head = 0;
  private filled = 0;
  totalFrames = 0;
  get percentileSampleFrames(): number { return this.filled; }
  longFrames50 = 0;
  longFrames100 = 0;
  /** Count of visibility resumes observed; the frame after a resume is excluded. */
  resumes = 0;
  private skipNext = false;

  readonly historyMean = new Float32Array(HISTORY);
  readonly historyP95 = new Float32Array(HISTORY);
  readonly historyScale = new Float32Array(HISTORY);
  historyCount = 0;
  private windowMs = 0;
  private windowStart = 0;
  private windowFrames = 0;

  /** @hot */
  push(intervalMs: number, scale: number): void {
    if (this.skipNext) {
      this.skipNext = false;
      return;
    }
    this.ring[this.head] = intervalMs;
    this.head = (this.head + 1) % RING;
    if (this.filled < RING) this.filled++;
    this.totalFrames++;
    if (intervalMs > 50) this.longFrames50++;
    if (intervalMs > 100) this.longFrames100++;
    this.windowMs += intervalMs;
    this.windowFrames++;
    if (this.windowMs >= HISTORY_WINDOW_MS) this.closeWindow(scale);
  }

  /** The interval spanning a hidden tab is not a rendering hitch. */
  noteResume(): void {
    this.resumes++;
    this.skipNext = true;
  }

  /** @amortized once per 10 s window; the subarray view is the only allocation */
  private closeWindow(scale: number): void {
    if (this.historyCount < HISTORY) {
      const n = this.windowFrames;
      // The window's frames are the most recent n ring entries.
      const count = n < this.filled ? n : this.filled;
      for (let i = 0; i < count; i++) {
        this.scratch[i] = this.ring[(this.head - 1 - i + RING * 2) % RING];
      }
      const view = this.scratch.subarray(0, count).sort();
      this.historyMean[this.historyCount] = this.windowMs / n;
      this.historyP95[this.historyCount] = view[Math.min(count - 1, Math.floor(count * 0.95))];
      this.historyScale[this.historyCount] = scale;
      this.historyCount++;
    }
    this.windowStart += this.windowMs;
    this.windowMs = 0;
    this.windowFrames = 0;
  }

  /** Percentiles over the last `maxSamples` frames (default: whole ring). Low frequency only. */
  percentiles(out: Percentiles, maxSamples = RING): Percentiles {
    const count = Math.min(this.filled, maxSamples);
    if (count === 0) {
      out.p50 = out.p95 = out.p99 = out.mean = 0;
      return out;
    }
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const v = this.ring[(this.head - 1 - i + RING * 2) % RING];
      this.scratch[i] = v;
      sum += v;
    }
    const view = this.scratch.subarray(0, count).sort();
    out.p50 = view[Math.floor(count * 0.5)];
    out.p95 = view[Math.min(count - 1, Math.floor(count * 0.95))];
    out.p99 = view[Math.min(count - 1, Math.floor(count * 0.99))];
    out.mean = sum / count;
    return out;
  }

  /** Median of the first frames, used once to estimate the refresh period. */
  medianOfRecent(samples: number): number {
    const count = Math.min(this.filled, samples);
    if (count === 0) return 1000 / 60;
    for (let i = 0; i < count; i++) this.scratch[i] = this.ring[(this.head - 1 - i + RING * 2) % RING];
    return this.scratch.subarray(0, count).sort()[Math.floor(count / 2)];
  }

  get elapsedHistoryMs(): number {
    return this.windowStart + this.windowMs;
  }
}
