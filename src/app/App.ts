import { PerspectiveCamera, Scene, Vector2 } from 'three/webgpu';
import { DEFAULT_DYNAMIC_RESOLUTION, DynamicResolution, snapRefreshPeriod } from '../perf/dynamicResolution';
import { FrameStats } from '../perf/frameStats';
import { MemoryPartition, MemoryRegistry } from '../perf/memoryRegistry';
import type { CapabilityReport } from '../platform/capabilities';
import { WEATHER_WETNESS } from '../env/weather';
import { Environment } from '../render/environment';
import { createNoiseTexture } from '../render/noiseTextures';
import { attachSunShadows } from '../render/shadows';
import { createRenderer, whenDeviceLost, type RendererHandle } from '../render/renderer';
import { Hud, downloadJson } from '../ui/hud';
import { CameraLook } from './cameraLook';
import { InspectionCamera } from './inspectionCamera';
import { applyInspectionPose, INSPECTION_NEAR_M, sampleInspectionPose } from './inspectionPose';
import { CAMERAS, GrassTestWalk, placeTurfCamera, resolveCamera, resolveSodCamera, TURF_SITES, turfWalkCamera, type ResolvedCamera } from './cameras';
import { GpuTimer } from './gpuTimer';
import { Observer } from './observability';
import { createAppState } from './appState';
import { formatHud, formatStatus } from './hudText';
import type { DebugParams } from './params';
import { pixelRatioForBudget, type QualityTier } from './quality';
import { EnvironmentClock } from './environmentClock';
import { buildReport, type AppState } from './report';
import { CdlodBackend } from './cdlodBackend';
import { ChunkBackend } from './chunkBackend';
import { TerrainClient } from './terrainClient';
import { FrameDiagnostics } from './frameDiagnostics';
import { firstSubmit, loadOceanFloor, prepareScene, startupTiming, type StartupProgress, type StartupTiming } from './startup';
import type { TerrainBackend } from './terrainBackend';
import { VegetationBackend } from './vegetationBackend';
const LOW_FREQUENCY_MS = 500;
const VARIANT_BUDGET = { low: 64, med: 64, high: 128 } as const;

export interface AppOptions {
  params: DebugParams;
  capabilities: CapabilityReport;
  tier: QualityTier;
  recoveredFromCrash: boolean;
  viewportRoot: HTMLElement;
  hudRoot: HTMLElement;
  progress?: StartupProgress;
  bootStartMs: number;
}

/** Owns the renderer, the scene and the frame loop. */
export class App {
  readonly stats = new FrameStats();
  readonly dyn: DynamicResolution;
  readonly memory: MemoryRegistry;
  readonly state: AppState;
  ready = false;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.3, 7000);
  private readonly environment: Environment;
  private readonly clock: EnvironmentClock;
  private readonly terrain: TerrainBackend;
  private readonly vegetation: VegetationBackend;
  private readonly hud: Hud;
  private readonly eye: ResolvedCamera = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, fovDeg: 55 };
  private readonly grassWalk = new GrassTestWalk();
  private readonly look: CameraLook;
  private readonly inspection: InspectionCamera | null;
  private readonly bufferSize = new Vector2();
  private handle!: RendererHandle;
  private gpuTimer!: GpuTimer;
  private readonly observer = new Observer();
  private lastTime = 0;
  private lastLowFrequency = 0;
  private loopStart = 0;
  private cameraCuts = 0;
  private readonly diagnostics: FrameDiagnostics | null;
  private recovering = false;
  private running = false;
  private constructor(private readonly options: AppOptions, client: TerrainClient, private readonly startup: StartupTiming) {
    const { params, tier } = options;
    this.diagnostics = params.cpuTrace ? new FrameDiagnostics() : null;
    this.look = new CameraLook(options.viewportRoot, this.camera);
    this.inspection = params.inspect ? new InspectionCamera(options.viewportRoot) : null;
    const lite = tier.name === 'low';
    this.memory = new MemoryRegistry(tier.memoryBudgetMiB);
    this.dyn = new DynamicResolution({ ...DEFAULT_DYNAMIC_RESOLUTION, maxScale: tier.maxScale, initialScale: tier.maxScale });
    if (params.scale !== null) this.dyn.lock(params.scale);
    const noise = createNoiseTexture();
    this.memory.add(MemoryPartition.Gpu, noise.gpuBytes);
    this.observer.uploads.add(performance.now(), noise.gpuBytes);
    this.environment = new Environment(this.scene, noise.texture, lite, params.skyLighting);
    this.environment.uploads = this.observer.uploads;
    if (params.shadows) this.memory.add(MemoryPartition.Gpu, attachSunShadows(this.environment.sun, tier.shadows));
    this.memory.add(MemoryPartition.Gpu, this.environment.ocean.gpuBytes);
    this.clock = new EnvironmentClock(this.environment, params.exposure);
    this.terrain = params.terrain === 'chunks'
      ? new ChunkBackend(client, this.memory, noise.texture, this.environment.ocean.floorTexture, tier, this.observer.uploads)
      : new CdlodBackend(client, this.memory, noise.texture, tier, this.observer.uploads, params.shadows ? tier.shadows.cascades : 0, params.sward && params.grass, params.soilPreview, !params.grass, params.worldTurf, params.turfBench !== null, params.turfLod !== null, params.turfTrial === 'canopy', params.turfOff === 'canopy');
    this.vegetation = new VegetationBackend({
      ocean: this.environment.ocean, sun: this.environment.sun, terrain: this.terrain, tier, memory: this.memory,
      uploads: this.observer.uploads, noise: noise.texture, grass: params.grass, sward: params.sward, shadows: params.shadows, fullSod: params.sodView !== null,
      worldTurf: params.worldTurf, turfStats: params.turfStats, turfBench: params.turfBench, turfLod: params.turfLod, turfTrial: params.turfTrial,
      surfaceFrame: params.turfFrame === 'surface', captureMs: params.captureMs,
      turfOff: params.turfOff, turfCull: params.turfCull, turfRibbon: params.turfRibbon, turfReference: params.turfReference && params.turfSite ? TURF_SITES[params.turfSite] : null,
    });
    this.observer.setMeshes(this.environment.sky.mesh, this.environment.ocean.mesh, this.terrain.farMesh);
    this.terrain.attachSun(this.environment.sun);
    this.scene.add(this.terrain.root);
    this.hud = new Hud(options.hudRoot, {
      setCamera: (index) => this.setCamera(index),
      exportReport: () => downloadJson(`world-unbound-telemetry-${Date.now()}.json`, this.report()),
      graphics: () => ({ camera: this.state.cameraIndex, tier: tier.name, scale: this.dyn.scale }),
    }, params.hud, CAMERAS);
    this.state = createAppState(tier, params, options.recoveredFromCrash, this.clock.lutMs, VARIANT_BUDGET[tier.name]);
  }
  static async create(options: AppOptions): Promise<App> {
    const assetsStart = performance.now();
    const client = new TerrainClient();
    try {
      const terrainAssets = await client.load((done, total) => options.progress?.(5 + 40 * done / total, `Terrain tiles ${done}/${total}`));
      const timing = startupTiming(terrainAssets, client.bootTransferMs, assetsStart - options.bootStartMs);
      const loadMs = performance.now() - assetsStart;
      const app = new App(options, client, timing);
      app.state.terrainLoadMs = loadMs;
      await app.start();
      return app;
    } catch (error) {
      client.dispose();
      throw error;
    }
  }
  private async start(): Promise<void> {
    const { params, capabilities, tier, viewportRoot, progress } = this.options;
    this.selectCamera(params.cam);
    this.terrain.prime(this.eye.x, this.eye.z);
    this.placeWorld(0);

    await prepareScene(this.startup, this.terrain, this.vegetation, this.scene, this.camera, {
      container: viewportRoot, choice: params.backend, webgpuUsable: capabilities.webgpu.adapter,
      antialias: tier.antialias, timestampQuery: capabilities.webgpu.features.includes('timestamp-query'),
    }, handle => { this.handle = handle; this.placeWorld(0); this.attachRenderer(); }, progress);
    this.state.warmupMs = this.startup.shaderWarmupMs;
    this.observer.markWarm(this.handle.renderer, this.scene, this.state);
    this.running = true;
    progress?.(95, 'Drawing the first frame');

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.state.backgroundSuspends++;
      } else {
        this.stats.noteResume();
        this.lastTime = 0;
      }
    });
    this.updateStatus();
    this.loopStart = performance.now();
    this.handle.renderer.setAnimationLoop(this.frame);
  }
  private attachRenderer(): void {
    const handle = this.handle;
    this.state.backend = handle.backend;
    this.gpuTimer = new GpuTimer(handle.renderer, handle.backend === 'webgpu');
    handle.renderer.shadowMap.enabled = this.options.params.shadows;
    this.terrain.setBundled(handle.backend === 'webgpu');
    this.vegetation.setRenderer(handle);
    this.state.fallbackReason = handle.fallbackReason;
    const onLost = (message: string): void => {
      // Losses during warm-up are handled by start(); stale handles are ours.
      if (this.handle !== handle || !this.running) return;
      console.warn(`[world-unbound] ${handle.backend} device lost: ${message}`);
      void this.recoverFromDeviceLoss();
    };
    handle.renderer.onDeviceLost = (info: { message: string }): void => onLost(info.message);
    void whenDeviceLost(handle.renderer).then(onLost);
    this.resize();
  }
  async recoverFromDeviceLoss(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.state.deviceLostCount++;
    const old = this.handle;
    this.running = false;
    old.renderer.setAnimationLoop(null);
    let webgpuUsable = false;
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      webgpuUsable = old.backend === 'webgpu' && this.state.deviceLostCount < 2 && !!gpu && (await gpu.requestAdapter()) !== null;
    } catch {
      webgpuUsable = false;
    }
    old.renderer.dispose();
    this.handle = await createRenderer({
      container: this.options.viewportRoot,
      choice: webgpuUsable ? this.options.params.backend : 'webgl2',
      webgpuUsable,
      antialias: this.options.tier.antialias,
      timestampQuery: this.options.capabilities.webgpu.features.includes('timestamp-query'),
    });
    if (old.backend === 'webgpu' && this.handle.backend === 'webgl2' && !this.handle.fallbackReason) {
      const repeated = this.state.deviceLostCount >= 2;
      this.handle.fallbackReason = repeated ? 'WebGPU device lost again after recovery' : 'WebGPU device lost and no adapter was available';
    }
    this.attachRenderer();
    this.observer.pipelineBaseline = 0;
    this.state.fallbackReason = this.handle.fallbackReason;
    this.updateStatus();
    this.lastTime = 0;
    this.recovering = false;
    this.running = true;
    this.handle.renderer.setAnimationLoop(this.frame);
  }
  setCamera(index: number): void {
    if (this.options.params.perf) return;
    this.cameraCuts++;
    this.selectCamera(index);
  }

  private selectCamera(index: number): void {
    const spec = CAMERAS[index] ?? CAMERAS[0];
    this.look.reset(!this.options.params.perf && (spec.allowLook === true || this.inspection !== null), this.inspection !== null);
    const { params } = this.options;
    const sodView = spec === CAMERAS[2] ? params.sodView : null;
    resolveCamera(spec, this.eye);
    if (sodView) resolveSodCamera(sodView, this.eye);
    else if (params.turfSite && (index === 2 || index === 6)) placeTurfCamera(this.eye, params.turfSite, params.turfView);
    const pose = index === params.cam ? params.inspectPose : null;
    this.grassWalk.reset(!pose && !this.inspection && !sodView && (!params.turfReference || params.captureMs !== null) && params.walk && (index === 1 || index === 2 || (index === 6 && params.turfSite))
      ? (params.turfSite ? turfWalkCamera(this.eye, spec) : spec) : null);
    this.state.cameraIndex = CAMERAS.indexOf(spec);
    this.state.cameraName = sodView ? `sod-master-${sodView}` : spec.name;
    this.camera.fov = this.eye.fovDeg;
    const macro = params.turfView === 'macro' && params.turfSite && (index === 2 || index === 6);
    this.camera.near = this.inspection || macro ? INSPECTION_NEAR_M : sodView ? 0.025 : spec.nearM ?? 0.3;
    // The camera stays at the origin; the world is translated around it.
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(this.eye.targetX - this.eye.x, this.eye.targetY - this.eye.y, this.eye.targetZ - this.eye.z);
    this.camera.rotation.reorder('YXZ');
    if (pose) applyInspectionPose(this.eye, this.camera, pose);
    this.inspection?.reset(this.eye);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.state.hour = params.hourExplicit ? params.hour : spec.hour ?? params.hour;
    const weather = params.weatherExplicit ? params.weather : spec.weather ?? params.weather;
    this.state.weather = weather;
    this.terrain.setWetness(WEATHER_WETNESS[weather]);
    this.state.day = params.day;
    this.clock.configure(params.day, this.state.hour, weather, Math.max(2, this.eye.y));
    this.vegetation.configure(params.day, this.state.hour, weather);
    this.state.season = this.clock.season;
    this.state.sunAltitudeDeg = this.environment.sunAltitudeDeg;
    this.state.moonIllumination = this.clock.celestial.moonIllumination;
    this.terrain.invalidate();
    this.ready = false;
  }
  private resize(): void {
    const { viewportRoot, tier } = this.options;
    const width = Math.max(1, viewportRoot.clientWidth);
    const height = Math.max(1, viewportRoot.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    this.state.cssWidth = width;
    this.state.cssHeight = height;
    this.state.devicePixelRatio = dpr;
    this.state.basePixelRatio = pixelRatioForBudget(width, height, dpr, tier.pixelBudget);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.handle.renderer.setSize(width, height, false);
    this.applyRenderScale();
  }
  /** @amortized runs only when the controller changes the scale or the window resizes */
  private applyRenderScale(): void {
    const { renderer } = this.handle;
    renderer.setPixelRatio(this.state.basePixelRatio * this.dyn.scale);
    renderer.getDrawingBufferSize(this.bufferSize);
    this.state.bufferWidth = this.bufferSize.x;
    this.state.bufferHeight = this.bufferSize.y;
  }
  /** @hot */
  private placeWorld(seconds: number): void {
    this.terrain.root.position.set(-this.eye.x, -this.eye.y, -this.eye.z);
    this.terrain.setEyeOffset(this.eye.x, this.eye.y, this.eye.z);
    this.environment.ocean.update(this.eye.x, this.eye.y, this.eye.z, seconds);
  }
  /** @hot */
  private readonly frame = (now: number): void => {
    const profile = this.diagnostics;
    const firstFrame = this.state.firstFrameMs === 0;
    const frameStart = profile || firstFrame ? performance.now() : 0;
    const interval = this.lastTime === 0 ? 1000 / this.state.refreshHz : now - this.lastTime;
    this.lastTime = now;
    this.stats.push(interval, this.dyn.scale);
    if (this.dyn.update(interval)) this.applyRenderScale();
    const captureMs = this.options.params.captureMs;
    if (this.ready || captureMs !== null) this.grassWalk.update(now, this.eye, captureMs);
    if (this.ready) this.inspection?.update(this.eye, this.camera, interval);
    this.camera.updateMatrixWorld();
    const terrainStart = profile ? performance.now() : 0;
    this.terrain.update(now, this.eye, this.camera);
    const vegetationStart = profile ? performance.now() : 0;
    this.vegetation.update(now, this.eye, this.camera, this.state.bufferHeight);
    const vegetationMs = profile ? performance.now() - vegetationStart : 0;
    this.placeWorld((captureMs ?? now) / 1000);
    this.environment.setExposure(this.clock.update(interval));
    const submitStart = profile || firstFrame ? performance.now() : 0;
    this.handle.renderer.render(this.scene, this.camera);
    const submitMs = profile ? performance.now() - submitStart : 0;
    if (firstFrame) {
      this.state.firstFrameMs = firstSubmit(this.startup, this.options.bootStartMs, this.loopStart, frameStart, submitStart);
      loadOceanFloor(this.terrain, this.environment.ocean, this.observer.uploads);
    }
    this.gpuTimer.afterRender();
    if (now - this.lastLowFrequency >= LOW_FREQUENCY_MS) this.lowFrequency(now);
    profile?.push(now - this.loopStart, interval, frameStart, vegetationStart - terrainStart, vegetationMs, submitMs, this.state.cameraIndex, this.eye);
  };
  /** @amortized telemetry and HUD refresh at 2 Hz */
  private lowFrequency(now: number): void {
    this.lastLowFrequency = now;
    const { state, stats, terrain } = this;
    if (!state.refreshMeasured && stats.totalFrames >= 120) {
      const period = snapRefreshPeriod(stats.medianOfRecent(120));
      state.refreshHz = 1000 / period;
      state.refreshMeasured = true;
      this.dyn.setRefreshPeriod(period);
    }
    const info = this.handle.renderer.info.render;
    state.drawCalls = info.drawCalls;
    state.bundledDraws = terrain.bundledDraws;
    state.triangles = info.triangles;
    state.exposure = this.clock.exposure;
    state.gpuPassSumP50Ms = this.gpuTimer.p50();
    state.gpuPassSumP95Ms = this.gpuTimer.p95();
    state.gpuPassesPerFrame = this.gpuTimer.passesPerFrame();
    state.gpuSamples = this.gpuTimer.samples;
    const overflowed = state.worldTurf?.overflow;
    this.vegetation.sample(state);
    if (state.worldTurf?.overflow !== overflowed) this.updateStatus();
    this.observer.sample(this.state, now, terrain, this.camera, this.environment.sun, this.handle.renderer);
    if (!this.ready && terrain.settled) {
      this.ready = true;
      if (state.worldReadyMs === 0) {
        state.worldReadyMs = performance.now() - this.options.bootStartMs;
        this.options.progress?.(100, 'Ready');
      }
    }
    if (this.hud.isVisible) this.hud.setText(formatHud(state, stats, this.dyn, this.memory));
  }
  private updateStatus(): void { this.hud.setStatus(formatStatus(this.state, this.options.params.turfBench !== null)); }
  report(): Record<string, unknown> {
    const report = buildReport(this.state, this.stats, this.dyn, this.memory, this.options.capabilities, this.options.params);
    return { ...report, startup: this.startup, cpuFrameTiming: this.diagnostics?.report() ?? null,
      camera: { index: this.state.cameraIndex, name: this.state.cameraName, initialIndex: this.options.params.cam,
        cuts: this.cameraCuts, locked: this.options.params.perf, pose: sampleInspectionPose(this.eye, this.camera) } };
  }
}
