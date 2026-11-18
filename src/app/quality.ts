import { BUDGET_BALANCED, BUDGET_HIGH } from '../perf/memoryRegistry';
import type { GrassSettings } from '../render/grass';
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
  /** Grass reach and density (spec G2.1: low = cards only to 60 m, no blades). */
  readonly grass: GrassSettings;
}


/**
 * Streamed chunks only cover the near field (`viewRadius`): the far-terrain skin covers the whole 4 km world,
 * so a larger ring only multiplies draw calls (and, with three shadow cascades, shadow draws).
 */
export const QUALITY: Record<QualityName, QualityTier> = {
  low: {
    name: 'low',
    lod: { lod0Distance: 110, viewRadius: 600 },
    maxScale: 0.8,
    pixelBudget: 1_300_000,
    memoryBudgetMiB: BUDGET_BALANCED,
    antialias: false,
    shadows: { cascades: 2, mapSize: 1024, maxFar: 600 },
    grass: { nearM: 0, midM: 60, bladesPerM2: 0, cardsPerM2: 3 },
  },
  med: {
    name: 'med',
    lod: { lod0Distance: 150, viewRadius: 800 },
    maxScale: 1,
    pixelBudget: 2_200_000,
    memoryBudgetMiB: BUDGET_BALANCED,
    antialias: true,
    shadows: { cascades: 3, mapSize: 1024, maxFar: 1000 },
    grass: { nearM: 40, midM: 100, bladesPerM2: 16, cardsPerM2: 1.2 },
  },
  high: {
    name: 'high',
    lod: { lod0Distance: 200, viewRadius: 1100 },
    maxScale: 1,
    // POCO F8 Ultra native panel: 2608 x 1200 = 3,129,600 px.
    pixelBudget: 3_200_000,
    memoryBudgetMiB: BUDGET_HIGH,
    antialias: true,
    shadows: { cascades: 3, mapSize: 2048, maxFar: 1600 },
    grass: { nearM: 60, midM: 150, bladesPerM2: 28, cardsPerM2: 0.8 },
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
