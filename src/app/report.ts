import type { DynamicResolution } from '../perf/dynamicResolution';
import { HISTORY_WINDOW_MS, type FrameStats, type Percentiles } from '../perf/frameStats';
import type { MemoryRegistry } from '../perf/memoryRegistry';
import type { CapabilityReport } from '../platform/capabilities';
import { TERRAIN_VERSION } from '../world/constants';
import type { SoilWaterGrid } from '../world/soilWater';
import type { WorldTurfMetrics } from '../render/worldTurf';
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
  /** Main-thread time to fetch, verify and decode the terrain tiles. */
  terrainLoadMs: number;
  /** Same for the terrain worker's own copy (0 until it reports). */
  terrainWorkerLoadMs: number;
  materialVariants: number;
  variantBudget: number;
  drawCalls: number;
  bundledDraws: number;
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
  /**
   * Sum of per-pass GPU durations of the last frame (timestamp queries; NOT a frame span, see gpuTimer.ts);
   * null on WebGL2 or without the feature.
   */
  gpuPassSumP50Ms: number | null;
  gpuPassSumP95Ms: number | null;
  gpuSamples: number | null;
  /** Timestamped passes in the last resolved frame. */
  gpuPassesPerFrame: number | null;
  /** Observability (G1.4.1 phase E); all sampled at the 2 Hz tick. */
  residentChunks: number;
  visibleChunks: number;
  culledChunks: number;
  /** Resident chunks that cast shadows. */
  shadowCasterChunks: number;
  trisMain: number;
  /** Triangles per shadow cascade (first `shadowCascades` entries are valid). */
  trisShadow: number[];
  shadowCascades: number;
  trisOcean: number;
  trisFar: number;
  uploadMiBps: number;
  workerQueued: number;
  buildP50Ms: number | null;
  buildP95Ms: number | null;
  buildSamples: number;
  pipelinesAfterWarmup: number | null;
  jsHeapMiB: number | null;
  loafSupported: boolean;
  loafCount: number;
  loafWorstMs: number;
  loafWorstBlockingMs: number;
  loafTopScript: string | null;
  /** Terrain renderer in use: 'cdlod' or 'chunks'. */
  terrainRender: string;
  /** CDLOD: nodes drawn, nodes dropped by the frustum test, drawn nodes per level (L0 first). */
  nodesSelected: number;
  nodesCulled: number;
  nodesPerLevel: number[];
  /** CDLOD: nodes drawn into the shadow maps. */
  shadowCasterNodes: number;
  /** Milliseconds the worker needed to build the terrain textures (0 on the chunk path). */
  terrainTexturesMs: number;
  /** Part of `terrainTexturesMs` spent on the wind channel, vegetation and wetness masks. */
  terrainMasksMs: number;
  /** Climate (G2.1), sampled at the 2 Hz tick. The wind blows FROM `windDirDeg` (compass bearing, meteorological convention). */
  windDirDeg: number;
  windSpeedMs: number;
  temperatureC: number;
  season01: number;
  /** Grass (G2.1 phase C), sampled at the 2 Hz tick: cells drawn, blades and cards submitted, triangles, CPU ms. */
  grassEnabled: boolean;
  grassCells: number;
  grassBlades: number;
  grassCards: number;
  grassTris: number;
  grassSodTiles: number;
  grassSodTris: number;
  grassSodCrowns: number;
  grassDensityM2: number;
  grassMs: number;
  worldTurf: WorldTurfMetrics | null;
  windUpdates: number;
  soilSample: ReturnType<SoilWaterGrid['sample']>;
  soilWorker: boolean;
  soilUpdates: number;
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
      gpuPassSumP50Ms: state.gpuPassSumP50Ms === null ? null : round(state.gpuPassSumP50Ms),
      gpuPassSumP95Ms: state.gpuPassSumP95Ms === null ? null : round(state.gpuPassSumP95Ms),
      gpuPassesPerFrame: state.gpuPassesPerFrame,
      gpuSamples: state.gpuSamples,
      longAnimationFrames: state.loafSupported
        ? { count: state.loafCount, worstMs: round(state.loafWorstMs, 1), worstBlockingMs: round(state.loafWorstBlockingMs, 1), topScript: state.loafTopScript }
        : null,
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
      pipelinesAfterWarmup: state.pipelinesAfterWarmup,
      variantBudget: state.variantBudget,
      warmupCompileMs: round(state.warmupMs, 1),
      firstFrameMs: round(state.firstFrameMs, 1),
    },
    world: {
      readyMs: round(state.worldReadyMs, 1),
      terrainLoadMs: round(state.terrainLoadMs, 1),
      terrainWorkerLoadMs: round(state.terrainWorkerLoadMs, 1),
      chunksLoaded: state.chunksLoaded,
      chunksInFlight: state.chunksInFlight,
      staleResults: state.staleResults,
      lodBias: state.lodBias,
      terrainMode: state.terrainRender,
      terrainBuild: state.terrainMode,
      terrainTexturesMs: round(state.terrainTexturesMs, 1),
      terrainMasksMs: round(state.terrainMasksMs, 1),
      nodes: state.terrainRender === 'cdlod'
        ? { selected: state.nodesSelected, culled: state.nodesCulled, perLevel: state.nodesPerLevel.slice() }
        : null,
      shadowCasterNodes: state.terrainRender === 'cdlod' ? state.shadowCasterNodes : null,
      grass: {
        enabled: state.grassEnabled, cells: state.grassCells, blades: state.grassBlades, cards: state.grassCards,
        triangles: state.grassTris, sodTiles: state.grassSodTiles, sodTriangles: state.grassSodTris, ms: round(state.grassMs, 3),
        sodCrowns: state.grassSodCrowns, targetLeavesPerM2: state.grassDensityM2, worldTurf: state.worldTurf,
      },
      wind: { texels: 64, bytes: 64 * 64 * 8, refreshes: state.windUpdates },
      soil: { worker: state.soilWorker, updates: state.soilUpdates, atEye: state.soilSample },
      drawCalls: state.drawCalls,
      bundledDraws: state.bundledDraws,
      triangles: state.triangles,
      residentChunks: state.residentChunks,
      visibleChunks: state.visibleChunks,
      culledChunks: state.culledChunks,
      shadowCasterChunks: state.shadowCasterChunks,
      trianglesPerPass: {
        main: state.trisMain,
        grass: state.grassTris,
        shadow: state.trisShadow.slice(0, state.shadowCascades),
        ocean: state.trisOcean,
        farTerrain: state.trisFar,
      },
      uploadMiBps: round(state.uploadMiBps, 3),
      workerQueue: state.terrainRender === 'cdlod' ? null : { queued: state.workerQueued, inFlight: state.chunksInFlight },
      chunkBuildMs: state.terrainRender === 'cdlod'
        ? null
        : {
          p50: state.buildP50Ms === null ? null : round(state.buildP50Ms),
          p95: state.buildP95Ms === null ? null : round(state.buildP95Ms),
          samples: state.buildSamples,
        },
    },
    memory: { jsHeapMiB: state.jsHeapMiB === null ? null : round(state.jsHeapMiB, 1), jsHeapApproximate: true },
    environment: {
      day: state.day,
      season: state.season,
      hour: state.hour,
      weather: state.weather,
      sunAltitudeDeg: round(state.sunAltitudeDeg, 1),
      moonIllumination: round(state.moonIllumination, 2),
      exposure: round(state.exposure, 3),
      atmosphereLutMs: round(state.atmosphereLutMs, 1),
      windDirDeg: round(state.windDirDeg, 0),
      windSpeedMs: round(state.windSpeedMs, 2),
      temperatureC: round(state.temperatureC, 1),
      season01: round(state.season01, 3),
    },
    capabilities,
  };
}
