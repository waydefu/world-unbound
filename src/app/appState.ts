import { initialObserved } from './observability';
import type { DebugParams } from './params';
import type { QualityTier } from './quality';
import type { AppState } from './report';
import { initialVegetationState } from './vegetationBackend';

/** The telemetry state before the first tick: everything zero or unknown except what the options already say. */
export function createAppState(
  tier: QualityTier, params: DebugParams, recoveredFromCrash: boolean, atmosphereLutMs: number, variantBudget: number,
): AppState {
  return {
    backend: 'none', fallbackReason: null, quality: tier.name, recoveredFromCrash,
    deviceLostCount: 0, cameraIndex: 0, cameraName: '', cssWidth: 0, cssHeight: 0,
    devicePixelRatio: 1, basePixelRatio: 1, bufferWidth: 0, bufferHeight: 0,
    refreshHz: 60, refreshMeasured: false, warmupMs: 0, firstFrameMs: 0, worldReadyMs: 0, terrainLoadMs: 0, terrainWorkerLoadMs: 0,
    materialVariants: 2, variantBudget, drawCalls: 0, bundledDraws: 0, triangles: 0,
    chunksLoaded: 0, chunksInFlight: 0, staleResults: 0, lodBias: 0, terrainMode: 'worker',
    hour: params.hour, day: params.day, season: '', weather: params.weather, sunAltitudeDeg: 0,
    moonIllumination: 0, exposure: 1, atmosphereLutMs, backgroundSuspends: 0,
    gpuPassSumP50Ms: null, gpuPassSumP95Ms: null, gpuSamples: null, gpuPassesPerFrame: null,
    ...initialObserved(),
    ...initialVegetationState(),
  };
}
