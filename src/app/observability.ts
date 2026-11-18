import type { Camera, DirectionalLight, Material, Mesh, Object3D, Scene } from 'three/webgpu';
import { SampleRing } from '../perf/sampleRing';
import { SlidingRate } from '../perf/slidingRate';
import { createChunkTelemetry, sampleChunkStats } from '../render/chunkStats';
import { cascadeCameras } from '../render/shadows';
import type { TerrainChunks } from '../render/terrainChunks';
import type { AppState } from './report';
import type { TerrainStreamer } from './terrainStreamer';

interface LoafScript {
  sourceURL: string;
  sourceFunctionName: string;
  duration: number;
}

/** Long Animation Frames summary (Chromium 123+; `supported` is false elsewhere). */
export class LongFrames {
  supported = false;
  count = 0;
  /** Largest `blockingDuration` (ms) seen. */
  worstMs = 0;
  /** `sourceURL:sourceFunctionName` of the script that ran longest inside the worst frame. */
  topScript: string | null = null;
  private observer: PerformanceObserver | null = null;

  /**
   * Starts observing; call after warm-up so start-up compilation does not count. Entries are
   * delivered in batches off the frame loop, so allocating here is fine.
   * @amortized event-driven, not part of the frame loop
   */
  start(): void {
    if (this.observer || typeof PerformanceObserver === 'undefined') return;
    const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
    if (!types?.includes('long-animation-frame')) return;
    this.supported = true;
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const frame = entry as PerformanceEntry & {
          blockingDuration?: number;
          scripts?: LoafScript[];
        };
        this.count++;
        const blocking = frame.blockingDuration ?? frame.duration;
        if (blocking < this.worstMs) continue;
        this.worstMs = blocking;
        let top: LoafScript | null = null;
        for (const script of frame.scripts ?? []) if (!top || script.duration > top.duration) top = script;
        if (top) this.topScript = `${top.sourceURL.split('/').pop() || 'inline'}:${top.sourceFunctionName || 'anonymous'}`;
      }
    });
    this.observer.observe({ type: 'long-animation-frame', buffered: false });
  }
}

/** Ring of the worker's per-chunk build times (ms). */
export const CHUNK_BUILD_SAMPLES = 120;
export function createBuildRing(): SampleRing {
  return new SampleRing(CHUNK_BUILD_SAMPLES);
}

/** `performance.memory.usedJSHeapSize` in MiB (Chromium only, coarse), else null. */
export function jsHeapMiB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
}

/** Number of render pipelines three.js has cached (render and compute), or null if its internals moved. */
export function pipelineCount(renderer: unknown): number | null {
  const pipelines = (renderer as { _pipelines?: { caches?: Map<string, unknown> } })._pipelines;
  return pipelines?.caches ? pipelines.caches.size : null;
}

/** Distinct materials used by meshes under `root` (the real material-variant count). @amortized once after warm-up */
export function countMaterials(root: Object3D): number {
  const seen = new Set<Material>();
  root.traverse((object) => {
    const material = (object as Mesh).material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const m of material) seen.add(m);
    else if (material) seen.add(material);
  });
  return seen.size;
}

/** Triangles of a mesh's geometry (indexed or not). */
export function meshTriangles(mesh: Mesh): number {
  const g = mesh.geometry;
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

/** Initial values of the observability fields of AppState. */
export function initialObserved(): Pick<
  AppState, 'residentChunks' | 'visibleChunks' | 'culledChunks' | 'shadowCasterChunks' | 'trisMain' | 'trisShadow'
  | 'shadowCascades' | 'trisOcean' | 'trisFar' | 'uploadMiBps' | 'workerQueued' | 'buildP50Ms' | 'buildP95Ms'
  | 'buildSamples' | 'pipelinesAfterWarmup' | 'jsHeapMiB' | 'loafSupported' | 'loafCount' | 'loafWorstMs' | 'loafTopScript'
> {
  return {
    residentChunks: 0, visibleChunks: 0, culledChunks: 0, shadowCasterChunks: 0, trisMain: 0, trisShadow: [0, 0, 0, 0],
    shadowCascades: 0, trisOcean: 0, trisFar: 0, uploadMiBps: 0, workerQueued: 0, buildP50Ms: null, buildP95Ms: null,
    buildSamples: 0, pipelinesAfterWarmup: null, jsHeapMiB: null, loafSupported: false, loafCount: 0, loafWorstMs: 0,
    loafTopScript: null,
  };
}

/** Owns the observability state and fills the AppState fields at the 2 Hz telemetry tick (G1.4.1 phase E). */
export class Observer {
  /** Every geometry and texture upload reports its bytes here (2 s sliding window). */
  readonly uploads = new SlidingRate(2000);
  /** Pipelines cached when warm-up finished; later growth is "created after warm-up". */
  pipelineBaseline: number | null = null;
  private readonly chunkTelemetry = createChunkTelemetry();
  private readonly longFrames = new LongFrames();
  private cascades: ReturnType<typeof cascadeCameras> = [];
  private triangles = { sky: 0, ocean: 0, far: 0 };

  setMeshes(sky: Mesh, ocean: Mesh, far: Mesh): void {
    this.triangles = { sky: meshTriangles(sky), ocean: meshTriangles(ocean), far: meshTriangles(far) };
  }

  /** Warm-up finished: take the pipeline baseline, count the materials, start the long-frame observer. */
  markWarm(renderer: unknown, scene: Scene, state: AppState): void {
    this.pipelineBaseline = pipelineCount(renderer);
    state.materialVariants = countMaterials(scene);
    this.longFrames.start();
  }

  /** @amortized scans the chunk table once per telemetry tick */
  sample(
    state: AppState, now: number, chunks: TerrainChunks, camera: Camera, sun: DirectionalLight,
    streamer: TerrainStreamer, renderer: unknown,
  ): void {
    const t = this.chunkTelemetry;
    if (this.cascades.length === 0) this.cascades = cascadeCameras(sun);
    sampleChunkStats(chunks, camera, this.cascades, t);
    state.residentChunks = t.visible + t.culled;
    state.visibleChunks = t.visible;
    state.culledChunks = t.culled;
    state.shadowCasterChunks = t.casters;
    state.shadowCascades = t.cascades;
    for (let c = 0; c < t.cascades; c++) state.trisShadow[c] = t.shadowTriangles[c];
    const { sky, ocean, far } = this.triangles;
    state.trisMain = chunks.residentTriangles + sky + ocean + far;
    state.trisOcean = ocean;
    state.trisFar = far;
    state.uploadMiBps = this.uploads.perSecond(now) / (1024 * 1024);
    state.workerQueued = streamer.requests.queuedCount();
    state.buildP50Ms = streamer.buildMs.percentile(0.5);
    state.buildP95Ms = streamer.buildMs.percentile(0.95);
    state.buildSamples = streamer.buildMs.count;
    const pipes = pipelineCount(renderer);
    state.pipelinesAfterWarmup = pipes === null || this.pipelineBaseline === null ? null : Math.max(0, pipes - this.pipelineBaseline);
    state.jsHeapMiB = jsHeapMiB();
    state.loafSupported = this.longFrames.supported;
    state.loafCount = this.longFrames.count;
    state.loafWorstMs = this.longFrames.worstMs;
    state.loafTopScript = this.longFrames.topScript;
  }
}
