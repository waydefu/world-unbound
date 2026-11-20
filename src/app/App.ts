import { PerspectiveCamera, Scene, Vector2 } from 'three/webgpu';
import { DEFAULT_DYNAMIC_RESOLUTION, DynamicResolution, snapRefreshPeriod } from '../perf/dynamicResolution';
import { FrameStats } from '../perf/frameStats';
import { MemoryPartition, MemoryRegistry } from '../perf/memoryRegistry';
import type { CapabilityReport } from '../platform/capabilities';
import { WEATHER_WETNESS } from '../env/weather';
import { Environment } from '../render/environment';
import { createNoiseTexture } from '../render/noiseTextures';
import { attachSunShadows } from '../render/shadows';
import { COAST_DIM, SEAFLOOR_DIM } from '../world/seaFloor';
import { createRenderer, warmUp, whenDeviceLost, type RendererHandle } from '../render/renderer';
import { Hud, downloadJson } from '../ui/hud';
import { CAMERAS, GrassTestWalk, resolveCamera, type ResolvedCamera } from './cameras';
import { GpuTimer } from './gpuTimer';
import { Observer } from './observability';
import { createAppState } from './appState';
import { formatHud } from './hudText';
import type { DebugParams } from './params';
import { pixelRatioForBudget, type QualityTier } from './quality';
import { EnvironmentClock } from './environmentClock';
import { buildReport, type AppState } from './report';
import { CdlodBackend } from './cdlodBackend';
import { ChunkBackend } from './chunkBackend';
import { loadAndInstallTerrain } from './terrainAssets';
import type { TerrainBackend } from './terrainBackend';
import { VegetationBackend } from './vegetationBackend';

const LOW_FREQUENCY_MS = 500;
const WARMUP_TIMEOUT_MS = 20000;
/** Shader-variant warning lines from the spec: Balanced 64, High 128. */
const VARIANT_BUDGET = { low: 64, med: 64, high: 128 } as const;

export interface AppOptions {
  params: DebugParams;
  capabilities: CapabilityReport;
  tier: QualityTier;
  recoveredFromCrash: boolean;
  viewportRoot: HTMLElement;
  hudRoot: HTMLElement;
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
  private readonly bufferSize = new Vector2();
  private handle!: RendererHandle;
  private gpuTimer!: GpuTimer;
  private readonly observer = new Observer();
  private lastTime = 0;
  private lastLowFrequency = 0;
  private startTime = 0;
  private recovering = false;
  private running = false;

  private constructor(private readonly options: AppOptions) {
    const { params, tier } = options;
    const lite = tier.name === 'low';
    this.memory = new MemoryRegistry(tier.memoryBudgetMiB);
    this.dyn = new DynamicResolution({ ...DEFAULT_DYNAMIC_RESOLUTION, maxScale: tier.maxScale, initialScale: tier.maxScale });
    if (params.scale !== null) this.dyn.lock(params.scale);
    const noise = createNoiseTexture();
    this.memory.add(MemoryPartition.Gpu, noise.gpuBytes);
    this.observer.uploads.add(performance.now(), noise.gpuBytes);
    this.environment = new Environment(this.scene, noise.texture, lite);
    this.environment.uploads = this.observer.uploads;
    if (params.shadows) this.memory.add(MemoryPartition.Gpu, attachSunShadows(this.environment.sun, tier.shadows));
    this.memory.add(MemoryPartition.Gpu, this.environment.ocean.gpuBytes);
    this.clock = new EnvironmentClock(this.environment);
    this.terrain = params.terrain === 'chunks'
      ? new ChunkBackend(this.memory, noise.texture, this.environment.ocean.floorTexture, tier, this.observer.uploads)
      : new CdlodBackend(this.memory, noise.texture, tier, this.observer.uploads, params.shadows ? tier.shadows.cascades : 0, params.sward && params.grass);
    this.vegetation = new VegetationBackend({
      ocean: this.environment.ocean, sun: this.environment.sun, terrain: this.terrain, tier, memory: this.memory,
      uploads: this.observer.uploads, noise: noise.texture, grass: params.grass, sward: params.sward, shadows: params.shadows,
    });
    this.observer.setMeshes(this.environment.sky.mesh, this.environment.ocean.mesh, this.terrain.farMesh);
    this.terrain.attachSun(this.environment.sun);
    this.scene.add(this.terrain.root);
    this.hud = new Hud(options.hudRoot, {
      setCamera: (index) => this.setCamera(index),
      exportReport: () => downloadJson(`world-unbound-telemetry-${Date.now()}.json`, this.report()),
    }, params.hud, CAMERAS.map((c) => c.name));
    this.state = createAppState(tier, params, options.recoveredFromCrash, this.clock.lutMs, VARIANT_BUDGET[tier.name]);
  }

  static async create(options: AppOptions): Promise<App> {
    // The terrain must be installed before anything reads a height (cameras, streaming, sea floor).
    // A failed download or digest mismatch rejects here and boot shows the error.
    const terrainLoadMs = await loadAndInstallTerrain();
    const app = new App(options);
    app.state.terrainLoadMs = terrainLoadMs;
    await app.start();
    return app;
  }

  private async start(): Promise<void> {
    const { params, capabilities, tier, viewportRoot } = this.options;
    this.startTime = performance.now();
    this.setCamera(params.cam);
    this.terrain.prime(this.eye.x, this.eye.z);
    this.placeWorld(0);

    this.handle = await createRenderer({
      container: viewportRoot,
      choice: params.backend,
      webgpuUsable: capabilities.webgpu.adapter,
      antialias: tier.antialias,
      timestampQuery: capabilities.webgpu.features.includes('timestamp-query'),
    });
    // CDLOD: the worker has been building the terrain textures since construction; they are needed before warm-up.
    await this.terrain.prepare();
    this.vegetation.prepare();
    this.placeWorld(0);
    this.attachRenderer();
    try {
      this.state.warmupMs = await warmUp(this.handle, this.scene, this.camera, WARMUP_TIMEOUT_MS);
    } catch (err) {
      // A WebGPU device that cannot build our pipelines is treated like a
      // missing adapter: continue on the flagged WebGL2 path.
      if (this.handle.backend !== 'webgpu') throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.handle.renderer.dispose();
      this.handle = await createRenderer({ container: viewportRoot, choice: 'webgl2', webgpuUsable: false, antialias: tier.antialias });
      this.handle.fallbackReason = `WebGPU ${reason}`;
      this.attachRenderer();
      this.state.warmupMs = await warmUp(this.handle, this.scene, this.camera, WARMUP_TIMEOUT_MS);
    }
    this.observer.markWarm(this.handle.renderer, this.scene, this.state);
    this.running = true;
    void this.terrain.client.requestSeaFloor().then((heights) => {
      this.environment.ocean.setSeaFloor(heights);
      this.observer.uploads.add(performance.now(), SEAFLOOR_DIM * SEAFLOOR_DIM * 2);
      this.terrain.seaFloorReady();
      // The 2 m coast map follows (the lite tier shades the shore from the 4 m map instead).
      if (this.environment.ocean.hasCoast) {
        void this.terrain.client.requestSeaFloor(true).then((fine) => {
          this.environment.ocean.setCoastFloor(fine);
          this.observer.uploads.add(performance.now(), COAST_DIM * COAST_DIM * 2);
        });
      }
    });

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
    this.handle.renderer.setAnimationLoop(this.frame);
  }

  private attachRenderer(): void {
    const handle = this.handle;
    this.state.backend = handle.backend;
    this.gpuTimer = new GpuTimer(handle.renderer, handle.backend === 'webgpu');
    handle.renderer.shadowMap.enabled = this.options.params.shadows;
    this.terrain.setBundled(handle.backend === 'webgpu');
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

  /**
   * GPU device/context loss: build a new renderer on a new canvas. Geometry
   * and material data are retained on the CPU, so the scene re-uploads itself.
   * WebGPU is retried once if an adapter can still be obtained; a second loss
   * (or no adapter) moves to the flagged WebGL2 path.
   */
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
      this.handle.fallbackReason = 'WebGPU device lost and no adapter was available';
    }
    this.attachRenderer();
    // The new renderer rebuilds every pipeline: all of them count as created after warm-up.
    this.observer.pipelineBaseline = 0;
    this.state.fallbackReason = this.handle.fallbackReason;
    this.updateStatus();
    this.lastTime = 0;
    this.recovering = false;
    this.running = true;
    this.handle.renderer.setAnimationLoop(this.frame);
  }

  setCamera(index: number): void {
    const spec = CAMERAS[index] ?? CAMERAS[0];
    const { params } = this.options;
    resolveCamera(spec, this.eye);
    this.grassWalk.reset(params.walk && (index === 1 || index === 2) ? spec : null);
    this.state.cameraIndex = CAMERAS.indexOf(spec);
    this.state.cameraName = spec.name;
    this.camera.fov = spec.fovDeg;
    this.camera.updateProjectionMatrix();
    // The camera stays at the origin; the world is translated around it.
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(this.eye.targetX - this.eye.x, this.eye.targetY - this.eye.y, this.eye.targetZ - this.eye.z);
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
    const interval = this.lastTime === 0 ? 1000 / this.state.refreshHz : now - this.lastTime;
    this.lastTime = now;
    this.stats.push(interval, this.dyn.scale);
    if (this.dyn.update(interval)) this.applyRenderScale();
    if (this.ready) this.grassWalk.update(now, this.eye);
    this.terrain.update(now, this.eye, this.camera);
    this.vegetation.update(now, this.eye, this.camera);
    this.placeWorld(now / 1000);
    this.environment.setExposure(this.clock.update(interval));
    this.handle.renderer.render(this.scene, this.camera);
    this.gpuTimer.afterRender();
    if (now - this.lastLowFrequency >= LOW_FREQUENCY_MS) this.lowFrequency(now);
  };

  /** @amortized telemetry and HUD refresh at 2 Hz */
  private lowFrequency(now: number): void {
    this.lastLowFrequency = now;
    const { state, stats, terrain } = this;
    if (state.firstFrameMs === 0) state.firstFrameMs = performance.now() - this.startTime;
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
    this.vegetation.sample(state);
    this.observer.sample(this.state, now, terrain, this.camera, this.environment.sun, this.handle.renderer);
    if (!this.ready && terrain.settled) {
      this.ready = true;
      if (state.worldReadyMs === 0) state.worldReadyMs = performance.now() - this.startTime;
    }
    if (this.hud.isVisible) this.hud.setText(formatHud(state, stats, this.dyn, this.memory));
  }

  private updateStatus(): void {
    const notes: string[] = [];
    if (this.state.fallbackReason) notes.push(`WebGL2 fallback: ${this.state.fallbackReason}`);
    if (this.state.recoveredFromCrash) notes.push('Recovered from an abnormal reload: safe low settings');
    if (this.state.deviceLostCount > 0) notes.push(`GPU device restored (${this.state.deviceLostCount})`);
    this.hud.setStatus(notes.length > 0 ? notes.join(' · ') : null);
  }

  report(): Record<string, unknown> {
    return buildReport(this.state, this.stats, this.dyn, this.memory, this.options.capabilities, this.options.params);
  }
}
