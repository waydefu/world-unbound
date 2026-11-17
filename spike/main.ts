import { pixelRatioForBudget, QUALITY } from '../src/app/quality';
import { FrameStats, type Percentiles } from '../src/perf/frameStats';
import { clearResults, downloadJson, loadResults, resultsTable, saveResult, type SpikeResult, type Stat } from './results';
import type { RunnerFactory } from './runner';
import { buildSpikeScene, orbitPose, type Pose } from './sceneData';

/**
 * Renderer spike harness (ADR-0002 §8). One engine per page load: build the
 * shared terrain, warm up, then measure frame interval, CPU submission time
 * and GPU time over a fixed orbit. Results accumulate on this device so the
 * menu can show all runs side by side.
 */
const ENGINES: Record<string, () => Promise<RunnerFactory>> = {
  three: () => import('./threeRunner').then((m) => m.createThreeRunner),
  babylon: () => import('./babylonRunner').then((m) => m.createBabylonRunner),
  'babylon-snapshot': () => import('./babylonRunner').then((m) => m.createBabylonRunner),
};

const params = new URLSearchParams(location.search);
const panel = document.getElementById('panel') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

function link(label: string, query: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.textContent = label;
  a.href = `?${query}`;
  return a;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function showMenu(note?: string): void {
  canvas.hidden = true;
  panel.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'Engine spike';
  const help = document.createElement('p');
  help.textContent = 'Run each engine once, in this order, then three again to check for thermal drift. '
    + 'Each run takes about 30 s. Keep the phone unplugged, at the same brightness, with other apps closed.';
  const links = document.createElement('div');
  links.className = 'links';
  for (const engine of Object.keys(ENGINES)) links.append(link(engine, `engine=${engine}`));
  const lite = document.createElement('p');
  lite.append('WebGL2 (Lite tier) reference: ', link('three', 'engine=three&backend=webgl2'), ' ', link('babylon', 'engine=babylon&backend=webgl2'));
  panel.append(title, help, links, lite);
  if (note) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = note;
    panel.append(p);
  }
  const results = loadResults();
  if (results.length > 0) {
    panel.append(resultsTable(results));
    const actions = document.createElement('div');
    actions.className = 'links';
    actions.append(
      button('Export all (JSON)', () => downloadJson(`engine-spike-${Date.now()}.json`, results)),
      button('Clear results', () => { clearResults(); showMenu(); }),
    );
    panel.append(actions);
  }
}

function stat(stats: FrameStats): Stat {
  const p: Percentiles = stats.percentiles({ p50: 0, p95: 0, p99: 0, mean: 0 });
  return { p50: p.p50, p95: p.p95, p99: p.p99, mean: p.mean };
}

function crossOriginRequests(): string[] {
  return performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((url) => !url.startsWith(location.origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
}

async function adapterInfo(): Promise<SpikeResult['adapter']> {
  try {
    const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu?.requestAdapter();
    return adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture } : null;
  } catch {
    return null;
  }
}

async function run(engineId: string): Promise<void> {
  const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
  const warmupSeconds = Number(params.get('warmup') ?? 5);
  const measureSeconds = Number(params.get('seconds') ?? 20);
  const status = document.createElement('p');
  panel.replaceChildren(status);
  status.textContent = `${engineId}: building terrain…`;
  await new Promise((r) => setTimeout(r, 30));
  const scene = buildSpikeScene();

  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const ratio = pixelRatioForBudget(cssW, cssH, window.devicePixelRatio || 1, QUALITY.med.pixelBudget);
  const width = Math.round(cssW * ratio);
  const height = Math.round(cssH * ratio);
  status.textContent = `${engineId}: starting engine…`;
  const initStart = performance.now();
  const factory = await ENGINES[engineId]();
  // A broken GPU device can leave engine start-up pending forever; fail visibly instead.
  const runner = await Promise.race([
    factory(canvas, scene, { backend, width, height, snapshot: engineId === 'babylon-snapshot' }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('engine start-up exceeded 45 s')), 45000)),
  ]);
  const engineInitMs = performance.now() - initStart;

  const intervals = new FrameStats();
  const cpu = new FrameStats();
  const gpu = new FrameStats();
  const pose: Pose = { eye: [0, 0, 0], target: [0, 0, 0] };
  let frame = 0;
  let last = 0;
  let drawSum = 0;
  let measured = 0;
  let measureStart = 0;
  const start = performance.now();

  await new Promise<void>((resolve) => {
    const tick = (now: number): void => {
      runner.setPose(orbitPose(frame, pose));
      const t0 = performance.now();
      runner.render();
      const submit = performance.now() - t0;
      runner.afterFrame(frame);
      const elapsed = (now - start) / 1000;
      if (elapsed >= warmupSeconds) {
        if (measureStart === 0) measureStart = now;
        else intervals.push(now - last, 1);
        cpu.push(submit, 1);
        const g = runner.gpuMs();
        if (g !== null) gpu.push(g, 1);
        drawSum += runner.drawCalls();
        measured++;
      }
      last = now;
      frame++;
      if (frame % 30 === 0) {
        status.textContent = elapsed < warmupSeconds
          ? `${engineId} (${runner.backend}): warming up ${Math.ceil(warmupSeconds - elapsed)} s`
          : `${engineId} (${runner.backend}): measuring ${Math.ceil(warmupSeconds + measureSeconds - elapsed)} s`;
      }
      if (elapsed >= warmupSeconds + measureSeconds) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const interval = stat(intervals);
  const result: SpikeResult = {
    schema: 'world-unbound.engine-spike/1',
    runAt: new Date().toISOString(),
    engine: runner.engine,
    backend: runner.backend,
    snapshotActive: runner.snapshotActive,
    gpuScope: runner.gpuScope,
    buffer: { width, height, pixels: width * height },
    scene: { chunks: scene.chunks.length, triangles: scene.triangles, buildMs: Math.round(scene.buildMs) },
    engineInitMs: Math.round(engineInitMs),
    measuredSeconds: Math.round((last - measureStart) / 100) / 10,
    frames: measured,
    drawCallsMean: measured > 0 ? drawSum / measured : 0,
    intervalMs: interval,
    fps: interval.mean > 0 ? 1000 / interval.mean : 0,
    cpuSubmitMs: stat(cpu),
    gpuMs: gpu.totalFrames > 0 ? stat(gpu) : null,
    longFramesOver50Ms: intervals.longFrames50,
    crossOriginRequests: crossOriginRequests(),
    adapter: runner.backend === 'webgpu' ? await adapterInfo() : null,
    userAgent: navigator.userAgent,
    error: null,
  };
  runner.dispose();
  saveResult(result);
  (window as Window & { __spikeResult?: SpikeResult }).__spikeResult = result;
  showMenu(`${result.engine} finished: ${result.fps.toFixed(1)} fps, CPU submit p50 ${result.cpuSubmitMs.p50.toFixed(2)} ms.`);
}

const engine = params.get('engine');
if (engine && engine in ENGINES) {
  canvas.hidden = false;
  run(engine).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    const failed = { engine, backend: params.get('backend') ?? 'webgpu', error: message } as SpikeResult;
    saveResult(failed);
    (window as Window & { __spikeResult?: SpikeResult }).__spikeResult = failed;
    showMenu(`${engine} failed: ${message}`);
  });
} else {
  showMenu();
}
