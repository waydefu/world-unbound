/**
 * Sum of events over a sliding time window, reported per second. Fixed-size
 * ring of (time, amount) pairs, so `add` never allocates; if events arrive
 * faster than the ring holds, the oldest are overwritten (the window then
 * under-reports, which is acceptable for telemetry).
 */
export class SlidingRate {
  private readonly times: Float64Array;
  private readonly amounts: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(readonly windowMs = 2000, capacity = 256) {
    this.times = new Float64Array(capacity);
    this.amounts = new Float64Array(capacity);
  }

  /** @hot */
  add(nowMs: number, amount: number): void {
    this.times[this.head] = nowMs;
    this.amounts[this.head] = amount;
    this.head = (this.head + 1) % this.times.length;
    if (this.filled < this.times.length) this.filled++;
  }

  /** Amount per second over the window ending at `nowMs`. @amortized scans the ring (telemetry only) */
  perSecond(nowMs: number): number {
    let sum = 0;
    for (let i = 0; i < this.filled; i++) {
      if (nowMs - this.times[i] <= this.windowMs) sum += this.amounts[i];
    }
    return (sum * 1000) / this.windowMs;
  }
}
