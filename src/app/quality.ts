import { BUDGET_BALANCED, BUDGET_HIGH } from '../perf/memoryRegistry';
import type { ShadowSettings } from '../render/shadows';
import type { LodPolicy } from '../world/chunkGrid';
import type { QualityName } from './params';

/** Quality tiers. "med" is the mobile Balanced tier; "high" is the High tier. */
export interface QualityTier {
  readonly name: QualityName;
  readonly lod: LodPolicy;
  /** Upper bound of the dynamic-resolution scale. */
  readonly maxScale: number;
  /** Device pixel ratio is capped so the drawing buffer stays within this many pixels. */
  readonly pixelBudget: number;
  readonly memoryBudgetMiB: readonly number[];
  readonly antialias: boolean;
  readonly shadows: ShadowSettings;
}


export const QUALITY: Record<QualityName, QualityTier> = {
  low: {
    name: 'low',
    lod: { lod0Distance: 110, viewRadius: 900 },
    maxScale: 0.8,
    pixelBudget: 1_300_000,
    memoryBudgetMiB: BUDGET_BALANCED,
    antialias: false,
    shadows: { cascades: 2, mapSize: 1024, maxFar: 600 },
  },
  med: {
    name: 'med',
    lod: { lod0Distance: 150, viewRadius: 1300 },
    maxScale: 1,
    pixelBudget: 2_200_000,
    memoryBudgetMiB: BUDGET_BALANCED,
    antialias: true,
    shadows: { cascades: 3, mapSize: 1024, maxFar: 1000 },
  },
  high: {
    name: 'high',
    lod: { lod0Distance: 200, viewRadius: 1700 },
    maxScale: 1,
    // POCO F8 Ultra native panel: 2608 x 1200 = 3,129,600 px.
    pixelBudget: 3_200_000,
    memoryBudgetMiB: BUDGET_HIGH,
    antialias: true,
    shadows: { cascades: 3, mapSize: 2048, maxFar: 1600 },
  },
};

/** Largest pixel ratio (<= devicePixelRatio) that keeps css pixels * ratio^2 within budget. */
export function pixelRatioForBudget(cssWidth: number, cssHeight: number, dpr: number, budget: number): number {
  const cssPixels = Math.max(1, cssWidth * cssHeight);
  const limit = Math.sqrt(budget / cssPixels);
  return Math.max(0.5, Math.min(dpr, limit));
}

export function chooseQuality(
  requested: QualityName | null,
  hints: { mobile: boolean; recoveredFromCrash: boolean; webgpu: boolean },
): QualityName {
  if (requested) return requested;
  if (hints.recoveredFromCrash) return 'low';
  if (hints.mobile) return 'med';
  return hints.webgpu ? 'high' : 'med';
}
