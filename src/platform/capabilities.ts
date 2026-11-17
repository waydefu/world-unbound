/**
 * Progressive capability detection. Nothing here is a hard requirement by
 * itself: the result feeds backend and quality selection and is exported in
 * the telemetry report.
 */
export interface CapabilityReport {
  secureContext: boolean;
  webgpu: {
    api: boolean;
    adapter: boolean;
    fallbackAdapter: boolean | null;
    vendor: string;
    architecture: string;
    features: string[];
    limits: Record<string, number>;
    error: string | null;
  };
  webgl2: boolean;
  offscreenCanvas: boolean;
  /** WebGPU inside a Worker cannot be probed from the main thread; resolved lazily if ever needed. */
  workerWebgpu: 'unknown';
  workers: boolean;
  compressedTextures: { astc: boolean; bc: boolean; etc2: boolean };
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  mobile: boolean;
  ios: boolean;
  standalone: boolean;
  fullscreenApi: boolean;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemoryGiB: number | null;
  userAgent: string;
}

const LIMIT_KEYS = [
  'maxTextureDimension2D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxBufferSize',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxVertexBuffers',
  'maxColorAttachments',
  'maxComputeWorkgroupStorageSize',
] as const;

export async function detectCapabilities(): Promise<CapabilityReport> {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  const ua = nav.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const report: CapabilityReport = {
    secureContext: window.isSecureContext,
    webgpu: {
      api: false, adapter: false, fallbackAdapter: null, vendor: '', architecture: '',
      features: [], limits: {}, error: null,
    },
    webgl2: probeWebgl2(),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    workerWebgpu: 'unknown',
    workers: typeof Worker !== 'undefined',
    compressedTextures: { astc: false, bc: false, etc2: false },
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: window.crossOriginIsolated === true,
    mobile: ios || /Android|Mobile/.test(ua) || matchMedia('(pointer: coarse)').matches,
    ios,
    standalone: nav.standalone === true || matchMedia('(display-mode: standalone)').matches,
    fullscreenApi: typeof document.documentElement.requestFullscreen === 'function',
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: nav.hardwareConcurrency || 1,
    deviceMemoryGiB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    userAgent: ua,
  };
  await probeWebgpu(report);
  return report;
}

function probeWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const ok = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

async function probeWebgpu(report: CapabilityReport): Promise<void> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!report.secureContext) {
    report.webgpu.error = 'not a secure context';
    return;
  }
  if (!gpu) {
    report.webgpu.error = 'navigator.gpu is not available';
    return;
  }
  report.webgpu.api = true;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      report.webgpu.error = 'requestAdapter() returned null';
      return;
    }
    report.webgpu.adapter = true;
    const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
    report.webgpu.vendor = info?.vendor ?? '';
    report.webgpu.architecture = info?.architecture ?? '';
    report.webgpu.fallbackAdapter = typeof info?.isFallbackAdapter === 'boolean' ? info.isFallbackAdapter : null;
    report.webgpu.features = [...adapter.features].sort();
    for (const key of LIMIT_KEYS) {
      const value = (adapter.limits as unknown as Record<string, number>)[key];
      if (typeof value === 'number') report.webgpu.limits[key] = value;
    }
    report.compressedTextures.astc = adapter.features.has('texture-compression-astc');
    report.compressedTextures.bc = adapter.features.has('texture-compression-bc');
    report.compressedTextures.etc2 = adapter.features.has('texture-compression-etc2');
  } catch (err) {
    report.webgpu.error = err instanceof Error ? err.message : String(err);
  }
}
