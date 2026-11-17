import { AgXToneMapping, WebGPURenderer, type Camera, type Scene } from 'three/webgpu';
import type { BackendChoice } from '../app/params';

export type BackendName = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: WebGPURenderer;
  canvas: HTMLCanvasElement;
  backend: BackendName;
  /** Why WebGL2 is active when WebGPU was wanted; null if no fallback happened. */
  fallbackReason: string | null;
}

export interface RendererOptions {
  container: HTMLElement;
  choice: BackendChoice;
  webgpuUsable: boolean;
  antialias: boolean;
}

/**
 * Creates the renderer on a fresh canvas. A canvas that has handed out a
 * WebGPU context cannot later give a WebGL2 one, so every attempt (and every
 * recovery after device loss) gets its own canvas.
 */
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
  const wantWebgpu = options.choice !== 'webgl2' && options.webgpuUsable;
  let fallbackReason: string | null = null;
  if (options.choice !== 'webgl2' && !options.webgpuUsable) {
    fallbackReason = 'WebGPU adapter unavailable';
  }
  if (wantWebgpu) {
    try {
      return await attempt(options, false, null);
    } catch (err) {
      fallbackReason = `WebGPU init failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return attempt(options, true, fallbackReason);
}

async function attempt(options: RendererOptions, forceWebGL: boolean, fallbackReason: string | null): Promise<RendererHandle> {
  const canvas = document.createElement('canvas');
  canvas.className = 'viewport';
  const renderer = new WebGPURenderer({
    canvas,
    antialias: options.antialias,
    forceWebGL,
    powerPreference: 'high-performance',
  });
  try {
    await renderer.init();
  } catch (err) {
    renderer.dispose();
    throw err;
  }
  const isWebgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  if (!forceWebGL && !isWebgpu) {
    fallbackReason = 'renderer selected its WebGL2 backend';
  }
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1;
  options.container.replaceChildren(canvas);
  return { renderer, canvas, backend: isWebgpu ? 'webgpu' : 'webgl2', fallbackReason };
}

/**
 * Resolves with a message when the renderer's GPUDevice is lost for any
 * reason. three.js does not report losses whose reason is "destroyed", which
 * is exactly what a crashed GPU process looks like, so the app watches the
 * device itself. Never resolves on the WebGL2 backend (context loss there is
 * reported through renderer.onDeviceLost).
 */
export function whenDeviceLost(renderer: WebGPURenderer): Promise<string> {
  const device = (renderer.backend as { device?: GPUDevice }).device;
  if (!device?.lost) return new Promise<string>(() => undefined);
  return device.lost.then((info) => `${info.reason ?? 'unknown'}: ${info.message || 'no message'}`);
}

/**
 * Compiles every pipeline the scene needs before the first frame and returns
 * the time taken. This is the shader validation step of capability detection:
 * it rejects if the device dies or compilation stalls, so the caller can fall
 * back instead of showing a frozen loading screen.
 */
export async function warmUp(handle: RendererHandle, scene: Scene, camera: Camera, timeoutMs: number): Promise<number> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`pipeline warm-up exceeded ${timeoutMs} ms`)), timeoutMs);
  });
  const lost = whenDeviceLost(handle.renderer).then((message) => {
    throw new Error(`device lost during warm-up (${message})`);
  });
  try {
    await Promise.race([handle.renderer.compileAsync(scene, camera), timeout, lost]);
  } finally {
    clearTimeout(timer);
  }
  return performance.now() - start;
}
