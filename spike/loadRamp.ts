import { pixelRatioForBudget, QUALITY } from '../src/app/quality';
import { FrameStats, type Percentiles } from '../src/perf/frameStats';
import { downloadJson } from './results';
import { buildSpikeScene, orbitPose, type Pose } from './sceneData';
import { createThreeRunner } from './threeRunner';

/**
 * GPU headroom ramp (ADR-0002 §10). A 60 Hz cap lets mobile DVFS lower GPU
 * clocks until the frame is filled, so GPU time at 60 FPS says little about
 * capacity. This renders the same bundled terrain k times per frame for
 * k = 1, 2, 3, ... and finds the largest k that still holds 60 FPS. At that
 * point the GPU is running near full clock, so one pass of the scene costs
 * at most about 1/k of the frame budget.
 */
const STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const STEP_SECONDS = 5;
const WARMUP_SECONDS = 5;
const HOLD_MS = 17.5; // mean frame interval still counted as 60 FPS

export interface RampStep {
  passes: number;
  fps: number;
  intervalMeanMs: number;
  intervalP95Ms: number;
  cpuMeanMs: number;
  gpuPassMeanMs: number | null;
}

export interface RampResult {
  schema: 'world-unbound.gpu-ramp/1';
  runAt: string;
  backend: string;
  buffer: { width: number; height: number; pixels: number };
  scene: { chunks: number; triangles: number };
  steps: RampStep[];
  maxPassesAt60: number;
  passShareOfFrame: number | null;
  userAgent: string;
}

const pct = (): Percentiles => ({ p50: 0, p95: 0, p99: 0, mean: 0 });

export async function runLoadRamp(canvas: HTMLCanvasElement, status: HTMLElement): Promise<RampResult> {
  status.textContent = 'GPU ramp: building terrain…';
  await new Promise((r) => setTimeout(r, 30));
  const scene = buildSpikeScene();
  const ratio = pixelRatioForBudget(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, QUALITY.med.pixelBudget);
  const width = Math.round(window.innerWidth * ratio);
  const height = Math.round(window.innerHeight * ratio);
  const runner = await createThreeRunner(canvas, scene, { backend: 'webgpu', width, height, snapshot: true });
  const pose: Pose = { eye: [0, 0, 0], target: [0, 0, 0] };
  const steps: RampStep[] = [];
  let frame = 0;

  const runPhase = (passes: number, seconds: number, record: boolean): Promise<void> => new Promise((resolve) => {
    const intervals = new FrameStats();
    const cpu = new FrameStats();
    let gpuSum = 0;
    let gpuCount = 0;
    let start = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (start === 0) start = now;
      runner.setPose(orbitPose(frame, pose));
      const t0 = performance.now();
      for (let k = 0; k < passes; k++) runner.render();
      cpu.push(performance.now() - t0, 1);
      runner.afterFrame(frame);
      const g = runner.gpuMs();
      if (g !== null) { gpuSum += g; gpuCount++; }
      if (last !== 0) intervals.push(now - last, 1);
      last = now;
      frame++;
      if ((now - start) / 1000 < seconds) {
        requestAnimationFrame(tick);
        return;
      }
      if (record) {
        const i = intervals.percentiles(pct());
        steps.push({
          passes,
          fps: i.mean > 0 ? 1000 / i.mean : 0,
          intervalMeanMs: i.mean,
          intervalP95Ms: i.p95,
          cpuMeanMs: cpu.percentiles(pct()).mean,
          gpuPassMeanMs: gpuCount > 0 ? gpuSum / gpuCount : null,
        });
      }
      resolve();
    };
    requestAnimationFrame(tick);
  });

  status.textContent = `GPU ramp (${runner.backend}): warming up ${WARMUP_SECONDS} s`;
  await runPhase(1, WARMUP_SECONDS, false);
  for (const passes of STEPS) {
    status.textContent = `GPU ramp (${runner.backend}): ${passes} pass${passes > 1 ? 'es' : ''} per frame…`;
    await runPhase(passes, STEP_SECONDS, true);
    if (steps[steps.length - 1].intervalMeanMs > HOLD_MS) break;
  }
  runner.dispose();

  const held = steps.filter((s) => s.intervalMeanMs <= HOLD_MS);
  const maxPassesAt60 = held.length > 0 ? held[held.length - 1].passes : 0;
  const ran = steps[steps.length - 1];
  return {
    schema: 'world-unbound.gpu-ramp/1',
    runAt: new Date().toISOString(),
    backend: runner.backend,
    buffer: { width, height, pixels: width * height },
    scene: { chunks: scene.chunks.length, triangles: scene.triangles },
    steps,
    maxPassesAt60,
    // Upper bound on one pass's share of a 60 Hz frame at full clocks; null if the ramp never saturated.
    passShareOfFrame: ran.intervalMeanMs > HOLD_MS && maxPassesAt60 > 0 ? 1 / maxPassesAt60 : null,
    userAgent: navigator.userAgent,
  };
}

export function showRampResult(panel: HTMLElement, result: RampResult): void {
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const h of ['passes', 'fps', 'frame mean', 'frame p95', 'CPU', 'GPU/pass']) head.insertCell().textContent = h;
  for (const s of result.steps) {
    const row = table.insertRow();
    for (const v of [String(s.passes), s.fps.toFixed(1), s.intervalMeanMs.toFixed(1), s.intervalP95Ms.toFixed(1),
      s.cpuMeanMs.toFixed(2), s.gpuPassMeanMs === null ? 'N/A' : s.gpuPassMeanMs.toFixed(2)]) row.insertCell().textContent = v;
  }
  const summary = document.createElement('p');
  summary.className = 'note';
  const first = result.steps[0];
  if (result.maxPassesAt60 === 0) {
    summary.textContent = `Could not hold 60 FPS even with one pass (${first ? first.fps.toFixed(1) : '0'} fps): `
      + 'this scene alone exceeds the frame budget on this device.';
  } else if (result.passShareOfFrame === null) {
    summary.textContent = `Held 60 FPS up to ${result.maxPassesAt60} passes, the most tested: one pass uses less than `
      + `${Math.round(100 / result.maxPassesAt60)} % of a 60 Hz frame.`;
  } else {
    summary.textContent = `Held 60 FPS up to ${result.maxPassesAt60} passes: one pass of this scene uses at most about `
      + `${Math.round(result.passShareOfFrame * 100)} % of a 60 Hz frame at full GPU clocks.`;
  }
  const exportButton = document.createElement('button');
  exportButton.textContent = 'Export ramp (JSON)';
  exportButton.addEventListener('click', () => downloadJson(`gpu-ramp-${Date.now()}.json`, result));
  panel.append(summary, table, exportButton);
}
