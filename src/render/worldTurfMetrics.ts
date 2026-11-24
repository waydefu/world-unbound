import type { TurfBenchmark, TurfTrial } from '../world/turfPopulation';

export interface WorldTurfMetrics {
  mode: 'gpu-indirect' | 'cpu-instanced';
  reference: boolean;
  submittedCrowns: number | null;
  submittedLeaves: number | null;
  submittedTriangles: number | null;
  candidateCrowns: number;
  overflow: boolean;
  collectMs: number;
  selectMs: number;
  gpuComputeMs: number | null;
  proxyFrustumAreaEstimateM2: number | null;
  drawCalls: number;
  gpuSampleAgeMs: number | null;
  benchmark: { radius: TurfBenchmark; candidateCapacity: number; frustumGrassAreaEstimateM2: number | null } | null;
  trial?: TurfTrialMetrics;
  ribbonLod: { rangeM: number; cells: number; triangles: number; rebuildMs: number;
    mode: 'blend' | 'trim' | 'depth' | 'blades'; topV: number } | null;
  nativeFade: { startM: number; endM: number } | null;
  residentBatches: number;
}

export interface TurfTrialMetrics {
  mode: TurfTrial;
  detailBlendM: { start: number; end: number };
  reducedCrownDivisor: number;
  full: { crowns: number | null; triangles: number | null };
  folded: { crowns: number | null; triangles: number | null };
}

function sum(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** Merge separate full and folded draws without treating an unsampled indirect count as zero. */
export function combineWorldTurfMetrics(full: WorldTurfMetrics, folded: WorldTurfMetrics,
  mode: TurfTrial, start: number, end: number, divisor: number): WorldTurfMetrics {
  return {
    ...full,
    submittedCrowns: sum(full.submittedCrowns, folded.submittedCrowns),
    submittedLeaves: sum(full.submittedLeaves, folded.submittedLeaves),
    submittedTriangles: sum(full.submittedTriangles, folded.submittedTriangles),
    candidateCrowns: full.candidateCrowns + folded.candidateCrowns,
    overflow: full.overflow || folded.overflow,
    collectMs: full.collectMs + folded.collectMs,
    selectMs: full.selectMs + folded.selectMs,
    gpuComputeMs: folded.gpuComputeMs,
    proxyFrustumAreaEstimateM2: folded.proxyFrustumAreaEstimateM2,
    residentBatches: full.residentBatches + folded.residentBatches,
    drawCalls: full.drawCalls + folded.drawCalls,
    gpuSampleAgeMs: sum(full.gpuSampleAgeMs, folded.gpuSampleAgeMs) === null ? null
      : Math.max(full.gpuSampleAgeMs ?? 0, folded.gpuSampleAgeMs ?? 0),
    trial: {
      mode, detailBlendM: { start, end }, reducedCrownDivisor: divisor,
      full: { crowns: full.submittedCrowns, triangles: full.submittedTriangles },
      folded: { crowns: folded.submittedCrowns, triangles: folded.submittedTriangles },
    },
  };
}
