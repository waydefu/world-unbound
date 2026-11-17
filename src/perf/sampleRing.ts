/**
 * Fixed-size ring of the most recent samples with percentile queries.
 * `push` never allocates; percentiles sort a preallocated scratch copy and
 * are meant for low-frequency (telemetry, HUD) use only.
 */
export class SampleRing {
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.ring = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  get count(): number {
    return this.filled;
  }

  /** @hot */
  push(value: number): void {
    this.ring[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** Nearest-rank percentile `q` in [0, 1] of the stored samples, or null when empty. @amortized sorts the scratch copy */
  percentile(q: number): number | null {
    const n = this.filled;
    if (n === 0) return null;
    // Before the ring wraps the samples occupy [0, n); afterwards the whole buffer is live.
    const view = this.scratch.subarray(0, n);
    view.set(this.ring.subarray(0, n));
    view.sort();
    return view[Math.min(n - 1, Math.floor(n * q))];
  }
}
