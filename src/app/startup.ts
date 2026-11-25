import type { SlidingRate } from '../perf/slidingRate';
import type { Ocean } from '../render/ocean';
import { createRenderer, warmUp, type RendererHandle, type RendererOptions } from '../render/renderer';
import type { Camera, Scene } from 'three/webgpu';
import type { TerrainLoadTiming } from './terrainAssets';
import { COAST_DIM, SEAFLOOR_DIM } from '../world/seaFloor';
import type { VegetationBackend } from './vegetationBackend';
import type { TerrainBackend } from './terrainBackend';

export type StartupProgress = (percent: number, message: string) => void;

/** @amortized Run once after the first frame is submitted. */
export function loadOceanFloor(terrain: TerrainBackend, ocean: Ocean, uploads: SlidingRate): void {
  void terrain.client.requestSeaFloor().then(heights => {
    ocean.setSeaFloor(heights);
    uploads.add(performance.now(), SEAFLOOR_DIM * SEAFLOOR_DIM * 2);
    terrain.seaFloorReady();
    if (ocean.hasCoast) {
      void terrain.client.requestSeaFloor(true).then(fine => {
        ocean.setCoastFloor(fine);
        uploads.add(performance.now(), COAST_DIM * COAST_DIM * 2);
      });
    }
  });
}

export interface StartupTiming {
  capabilitiesMs: number;
  terrainAssets: TerrainLoadTiming;
  terrainAssetSource: 'worker' | 'main-thread';
  terrainGridTransferMs: number | null;
  terrainPrepareWaitMs: number;
  vegetationPrepareMs: number;
  rendererInitMs: number;
  shaderWarmupMs: number;
  rendererAttachMs: number;
  animationLoopWaitMs: number;
  firstFrameCpuSubmitMs: number;
  toFirstSubmitMs: number;
}

async function initializeRenderer(options: RendererOptions, timing: StartupTiming): Promise<RendererHandle> {
  const start = performance.now();
  try { return await createRenderer(options); }
  finally { timing.rendererInitMs += performance.now() - start; }
}

const WARMUP_TIMEOUT_MS = 20_000;

async function warmRenderer(handle: RendererHandle, scene: Scene, camera: Camera, timing: StartupTiming): Promise<void> {
  const start = performance.now();
  try { await warmUp(handle, scene, camera, WARMUP_TIMEOUT_MS); }
  finally { timing.shaderWarmupMs += performance.now() - start; }
}

export function startupTiming(terrainAssets: TerrainLoadTiming, terrainGridTransferMs: number | null, capabilitiesMs: number): StartupTiming {
  return {
    terrainAssets, terrainGridTransferMs, capabilitiesMs,
    terrainAssetSource: terrainGridTransferMs === null ? 'main-thread' : 'worker',
    terrainPrepareWaitMs: 0, vegetationPrepareMs: 0, rendererInitMs: 0, shaderWarmupMs: 0, rendererAttachMs: 0,
    animationLoopWaitMs: 0, firstFrameCpuSubmitMs: 0, toFirstSubmitMs: 0,
  };
}

export async function prepareScene(timing: StartupTiming, terrain: TerrainBackend, vegetation: VegetationBackend,
  scene: Scene, camera: Camera, options: RendererOptions, attach: (handle: RendererHandle) => void,
  progress?: StartupProgress): Promise<void> {
  const creating = initializeRenderer(options, timing);
  // Device initialization overlaps terrain and vegetation preparation.
  void creating.catch(() => undefined);
  let handle: RendererHandle;
  try {
    let start = performance.now();
    await terrain.prepare();
    timing.terrainPrepareWaitMs = performance.now() - start;
    progress?.(65, 'Preparing vegetation and scene');
    start = performance.now();
    await vegetation.prepare();
    timing.vegetationPrepareMs = performance.now() - start;
    handle = await creating;
  } catch (error) {
    void creating.then(result => result.renderer.dispose(), () => undefined);
    throw error;
  }

  const warm = async () => {
    const start = performance.now();
    attach(handle);
    timing.rendererAttachMs += performance.now() - start;
    progress?.(82, handle.fallbackReason ? `WebGL2 fallback: ${handle.fallbackReason}` : 'Warming shaders');
    await warmRenderer(handle, scene, camera, timing);
  };
  try {
    await warm();
  } catch (error) {
    handle.renderer.dispose();
    if (handle.backend !== 'webgpu') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    handle = await initializeRenderer({ ...options, choice: 'webgl2', webgpuUsable: false }, timing);
    handle.fallbackReason = `WebGPU ${reason}`;
    try { await warm(); }
    catch (fallbackError) {
      handle.renderer.dispose();
      throw fallbackError;
    }
  }
}

/** @hot Records completed CPU submission of the first frame. */
export function firstSubmit(timing: StartupTiming, bootStart: number, loopStart: number, frameStart: number, submitStart: number): number {
  const submitted = performance.now();
  timing.animationLoopWaitMs = frameStart - loopStart;
  timing.firstFrameCpuSubmitMs = submitted - submitStart;
  timing.toFirstSubmitMs = submitted - bootStart;
  return timing.toFirstSubmitMs;
}
