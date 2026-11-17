/**
 * Hysteresis dynamic-resolution controller (pure logic, no DOM/GPU access).
 *
 * Thresholds are ratios of the display refresh period rather than fixed
 * milliseconds: a vsynced 60 Hz page can never average below 16.67 ms, so a
 * literal "< 16.5 ms" recovery rule would never fire. At 60 Hz the defaults
 * give "step down above 21.5 ms, recover below 17.2 ms held for several
 * seconds". A step up that is followed quickly by a step down doubles the
 * recovery hold (capped), which stops the scale from oscillating.
 */
export interface DynamicResolutionConfig {
  minScale: number;
  maxScale: number;
  initialScale: number;
  step: number;
  /** Step down when the smoothed interval exceeds period * upperRatio ... */
  upperRatio: number;
  /** ... for this long. */
  downHoldMs: number;
  /** Step up only after staying below period * lowerRatio ... */
  lowerRatio: number;
  /** ... for this long. */
  upHoldMs: number;
  maxUpHoldMs: number;
}

export const DEFAULT_DYNAMIC_RESOLUTION: DynamicResolutionConfig = {
  minScale: 0.5,
  maxScale: 1,
  initialScale: 1,
  step: 0.1,
  upperRatio: 1.29,
  downHoldMs: 400,
  lowerRatio: 1.03,
  upHoldMs: 3000,
  maxUpHoldMs: 30000,
};

export class DynamicResolution {
  scale: number;
  /** Number of scale changes since start (telemetry). */
  changes = 0;
  /** When set, the controller is pinned (?scale= debug parameter). */
  locked = false;
  private periodMs = 1000 / 60;
  private smoothed = 1000 / 60;
  private overMs = 0;
  private underMs = 0;
  private upHoldMs: number;
  private sinceStepUpMs = Infinity;

  constructor(private readonly config: DynamicResolutionConfig = DEFAULT_DYNAMIC_RESOLUTION) {
    this.scale = clamp(config.initialScale, config.minScale, config.maxScale);
    this.upHoldMs = config.upHoldMs;
  }

  setRefreshPeriod(periodMs: number): void {
    this.periodMs = periodMs;
    this.smoothed = periodMs;
  }

  lock(scale: number): void {
    this.locked = true;
    this.scale = scale;
  }

  /**
   * Feed one frame interval. Returns true when `scale` changed.
   * @hot
   */
  update(intervalMs: number): boolean {
    if (this.locked) return false;
    // Tab switches and debugger pauses are not GPU load.
    if (intervalMs > 250) {
      this.overMs = 0;
      this.underMs = 0;
      return false;
    }
    this.smoothed += (intervalMs - this.smoothed) * 0.12;
    this.sinceStepUpMs += intervalMs;
    const c = this.config;
    if (this.smoothed > this.periodMs * c.upperRatio) {
      this.overMs += intervalMs;
      this.underMs = 0;
      if (this.overMs >= c.downHoldMs && this.scale > c.minScale) {
        if (this.sinceStepUpMs < 2000) {
          this.upHoldMs = Math.min(this.upHoldMs * 2, c.maxUpHoldMs);
        }
        return this.apply(this.scale - c.step);
      }
    } else if (this.smoothed < this.periodMs * c.lowerRatio) {
      this.underMs += intervalMs;
      this.overMs = 0;
      if (this.underMs >= this.upHoldMs && this.scale < c.maxScale) {
        this.sinceStepUpMs = 0;
        return this.apply(this.scale + c.step);
      }
    } else {
      // Dead band between the thresholds: hold the current scale.
      this.overMs = 0;
      this.underMs = 0;
    }
    return false;
  }

  /** @hot */
  private apply(next: number): boolean {
    const c = this.config;
    const snapped = Math.round(clamp(next, c.minScale, c.maxScale) * 100) / 100;
    this.overMs = 0;
    this.underMs = 0;
    if (snapped === this.scale) return false;
    this.scale = snapped;
    this.changes++;
    return true;
  }
}

/** @hot */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Snaps a measured frame interval to the nearest common refresh period. */
export function snapRefreshPeriod(medianIntervalMs: number): number {
  const rates = [60, 72, 90, 120, 144, 165, 240];
  let best = 1000 / 60;
  let bestError = Infinity;
  for (const hz of rates) {
    const period = 1000 / hz;
    const error = Math.abs(period - medianIntervalMs);
    if (error < bestError) {
      bestError = error;
      best = period;
    }
  }
  // Slower than 60 Hz means the device is not hitting vsync; assume 60 Hz.
  return medianIntervalMs > 19 ? 1000 / 60 : best;
}
