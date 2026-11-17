import type { DynamicResolution } from '../perf/dynamicResolution';
import { HISTORY_WINDOW_MS, type FrameStats, type Percentiles } from '../perf/frameStats';
import type { MemoryRegistry } from '../perf/memoryRegistry';
import type { CapabilityReport } from '../platform/capabilities';
import { TERRAIN_VERSION } from '../world/constants';
import type { DebugParams } from './params';

/** Live values the app exposes for the HUD and the exported report. */
export interface AppState {
  backend: string;
  fallbackReason: string | null;
  quality: string;
  recoveredFromCrash: boolean;
  deviceLostCount: number;
  cameraIndex: number;
  cameraName: string;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  basePixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  refreshHz: number;
  refreshMeasured: boolean;
  warmupMs: number;
  firstFrameMs: number;
  worldReadyMs: number;
  materialVariants: number;
  variantBudget: number;
  drawCalls: number;
  triangles: number;
  chunksLoaded: number;
  chunksInFlight: number;
  staleResults: number;
  lodBias: number;
  terrainMode: string;
  hour: number;
  day: number;
  season: string;
  weather: string;
  sunAltitudeDeg: number;
  moonIllumination: number;
  exposure: number;
  atmosphereLutMs: number;
  backgroundSuspends: number;
}

const scratch: Percentiles = { p50: 0, p95: 0, p99: 0, mean: 0 };

function round(v: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** Structured telemetry report (exported as JSON; also read by the visual audit). */
export function buildReport(
  state: AppState, stats: FrameStats, dyn: DynamicResolution, memory: MemoryRegistry,
  capabilities: CapabilityReport, params: DebugParams,
): Record<string, unknown> {
  const p = stats.percentiles(scratch);
  const history = [];
  for (let i = 0; i < stats.historyCount; i++) {
    history.push({
      tSeconds: ((i + 1) * HISTORY_WINDOW_MS) / 1000,
      meanMs: round(stats.historyMean[i]),
      p95Ms: round(stats.historyP95[i]),
      scale: round(stats.historyScale[i]),
    });
  }
  return {
    schema: 'world-unbound.telemetry/1',
    generatedAt: new Date().toISOString(),
    terrainVersion: TERRAIN_VERSION,
    params,
    backend: { active: state.backend, fallbackReason: state.fallbackReason, deviceLostCount: state.deviceLostCount },
    quality: { tier: state.quality, recoveredFromCrash: state.recoveredFromCrash },
    camera: { index: state.cameraIndex, name: state.cameraName },
    viewport: {
      cssWidth: state.cssWidth,
      cssHeight: state.cssHeight,
      devicePixelRatio: state.devicePixelRatio,
      basePixelRatio: round(state.basePixelRatio, 3),
      renderScale: dyn.scale,
      renderScaleLocked: dyn.locked,
      renderScaleChanges: dyn.changes,
      drawingBufferWidth: state.bufferWidth,
      drawingBufferHeight: state.bufferHeight,
      drawingBufferPixels: state.bufferWidth * state.bufferHeight,
    },
    frames: {
      total: stats.totalFrames,
      fps: p.mean > 0 ? round(1000 / p.mean, 1) : 0,
      meanMs: round(p.mean),
      p50Ms: round(p.p50),
      p95Ms: round(p.p95),
      p99Ms: round(p.p99),
      longOver50Ms: stats.longFrames50,
      longOver100Ms: stats.longFrames100,
      refreshHz: round(state.refreshHz, 1),
      refreshMeasured: state.refreshMeasured,
    },
    soak: { elapsedSeconds: round(stats.elapsedHistoryMs / 1000, 1), windows: history },
    background: { suspends: state.backgroundSuspends, resumes: stats.resumes },
    memoryLogical: memory.snapshot(),
    shaders: {
      materialVariants: state.materialVariants,
      variantBudget: state.variantBudget,
      warmupCompileMs: round(state.warmupMs, 1),
      firstFrameMs: round(state.firstFrameMs, 1),
    },
    world: {
      readyMs: round(state.worldReadyMs, 1),
      chunksLoaded: state.chunksLoaded,
      chunksInFlight: state.chunksInFlight,
      staleResults: state.staleResults,
      lodBias: state.lodBias,
      terrainBuild: state.terrainMode,
      drawCalls: state.drawCalls,
      triangles: state.triangles,
    },
    environment: {
      day: state.day,
      season: state.season,
      hour: state.hour,
      weather: state.weather,
      sunAltitudeDeg: round(state.sunAltitudeDeg, 1),
      moonIllumination: round(state.moonIllumination, 2),
      exposure: round(state.exposure, 3),
      atmosphereLutMs: round(state.atmosphereLutMs, 1),
    },
    capabilities,
  };
}
