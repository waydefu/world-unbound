import { describe, expect, it } from 'vitest';
import { parseParams } from '../src/app/params';
import { chooseQuality, pixelRatioForBudget } from '../src/app/quality';
import { DEFAULT_DYNAMIC_RESOLUTION, DynamicResolution, snapRefreshPeriod } from '../src/perf/dynamicResolution';
import { FrameStats } from '../src/perf/frameStats';
import { BUDGET_BALANCED, MemoryPartition, MemoryRegistry, Pressure } from '../src/perf/memoryRegistry';

const P60 = 1000 / 60;
function run(d: DynamicResolution, intervalMs: number, durationMs: number): number {
  let changes = 0;
  for (let t = 0; t < durationMs; t += intervalMs) if (d.update(intervalMs)) changes++;
  return changes;
}

describe('DynamicResolution', () => {
  it('holds full scale at a steady refresh rate', () => {
    const d = new DynamicResolution();
    expect(run(d, P60, 20000)).toBe(0);
    expect(d.scale).toBe(1);
  });

  it('steps down under sustained load, not on a single spike', () => {
    const d = new DynamicResolution();
    d.update(80);
    run(d, P60, 1000);
    expect(d.scale).toBe(1);
    run(d, 24, 3000);
    expect(d.scale).toBeLessThan(1);
    expect(d.scale).toBeGreaterThanOrEqual(DEFAULT_DYNAMIC_RESOLUTION.minScale);
  });

  it('never drops below the minimum scale', () => {
    const d = new DynamicResolution();
    run(d, 40, 60000);
    expect(d.scale).toBe(DEFAULT_DYNAMIC_RESOLUTION.minScale);
  });

  it('recovers only after several seconds of headroom', () => {
    const d = new DynamicResolution();
    run(d, 26, 2000);
    const lowered = d.scale;
    expect(lowered).toBeLessThan(1);
    run(d, P60, 1500);
    expect(d.scale).toBe(lowered);
    run(d, P60, 4000);
    expect(d.scale).toBeGreaterThan(lowered);
  });

  it('holds inside the dead band between the thresholds', () => {
    const d = new DynamicResolution();
    run(d, 26, 2000);
    const lowered = d.scale;
    expect(run(d, 19, 30000)).toBe(0);
    expect(d.scale).toBe(lowered);
  });

  it('backs off instead of oscillating when a step up immediately overloads', () => {
    const d = new DynamicResolution({ ...DEFAULT_DYNAMIC_RESOLUTION, step: 0.1 });
    run(d, 26, 1000);
    // Model a device that is fine at <= 0.8 and overloaded above it.
    let changes = 0;
    for (let t = 0; t < 120000; ) {
      const interval = d.scale > 0.8 ? 26 : P60;
      if (d.update(interval)) changes++;
      t += interval;
    }
    // Without back-off this flips ~every 3.4 s (~70 changes in two minutes).
    expect(changes).toBeLessThan(24);
  });

  it('ignores tab-switch gaps and respects a pinned scale', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 50; i++) d.update(900);
    expect(d.scale).toBe(1);
    d.lock(0.7);
    run(d, 40, 5000);
    expect(d.scale).toBe(0.7);
  });

  it('scales its thresholds with the refresh period', () => {
    const d = new DynamicResolution();
    d.setRefreshPeriod(1000 / 120);
    run(d, 12, 3000); // fine at 60 Hz, overloaded at 120 Hz
    expect(d.scale).toBeLessThan(1);
    expect(snapRefreshPeriod(8.4)).toBeCloseTo(1000 / 120, 5);
    expect(snapRefreshPeriod(16.8)).toBeCloseTo(P60, 5);
    expect(snapRefreshPeriod(33)).toBeCloseTo(P60, 5);
  });
});

describe('FrameStats', () => {
  it('computes percentiles and long-frame counts', () => {
    const s = new FrameStats();
    for (let i = 0; i < 97; i++) s.push(16, 1);
    s.push(60, 1);
    s.push(120, 1);
    s.push(55, 1);
    const p = s.percentiles({ p50: 0, p95: 0, p99: 0, mean: 0 });
    expect(p.p50).toBe(16);
    expect(p.p99).toBe(120);
    expect(s.longFrames50).toBe(3);
    expect(s.longFrames100).toBe(1);
    expect(s.totalFrames).toBe(100);
  });

  it('excludes the frame after a background resume and records soak windows', () => {
    const s = new FrameStats();
    s.push(16, 1);
    s.noteResume();
    s.push(45000, 1);
    expect(s.totalFrames).toBe(1);
    expect(s.longFrames100).toBe(0);
    for (let i = 0; i < 1300; i++) s.push(16, 0.9);
    expect(s.historyCount).toBe(2);
    expect(s.historyMean[0]).toBeCloseTo(16, 3);
    expect(s.historyScale[0]).toBeCloseTo(0.9, 5);
  });
});

describe('MemoryRegistry', () => {
  it('raises reclaim at 80 % and full at 100 % per partition', () => {
    const m = new MemoryRegistry(BUDGET_BALANCED);
    const mib = 1024 * 1024;
    m.add(MemoryPartition.Gpu, 150 * mib);
    expect(m.pressure(MemoryPartition.Gpu)).toBe(Pressure.Ok);
    m.add(MemoryPartition.Gpu, 4 * mib);
    expect(m.pressure(MemoryPartition.Gpu)).toBe(Pressure.Reclaim);
    m.add(MemoryPartition.Gpu, 40 * mib);
    expect(m.pressure(MemoryPartition.Gpu)).toBe(Pressure.Full);
    expect(m.pressure(MemoryPartition.Staging)).toBe(Pressure.Ok);
    expect(m.worstPressure()).toBe(Pressure.Full);
    m.remove(MemoryPartition.Gpu, 194 * mib);
    expect(m.used[MemoryPartition.Gpu]).toBe(0);
    expect(m.snapshot().gpu.peakMiB).toBe(194);
    expect(() => m.remove(MemoryPartition.Wasm, 1)).toThrow();
  });
});

describe('debug parameters and quality', () => {
  it('parses valid parameters', () => {
    const p = parseParams('?cam=3&backend=webgl2&q=high&scale=0.75&hour=18.5&wx=storm&day=20.5&hud=0');
    expect(p).toMatchObject({
      cam: 3, backend: 'webgl2', quality: 'high', scale: 0.75, hour: 18.5, weather: 'storm', day: 20.5,
      hourExplicit: true, weatherExplicit: true, dayExplicit: true, hud: false,
    });
  });

  it('falls back to defaults on invalid input', () => {
    const p = parseParams('?cam=9&backend=vulkan&q=ultra&scale=4&hour=-2&wx=snow&day=40');
    expect(p).toMatchObject({
      cam: 5, backend: 'auto', quality: null, scale: null, hour: 13, weather: 'clear', day: 6,
      hourExplicit: false, weatherExplicit: false, dayExplicit: false, hud: true,
    });
    expect(parseParams('?hour=24').hour).toBe(0);
    expect(parseParams('?day=32').day).toBe(0);
  });

  it('caps the pixel ratio to the pixel budget', () => {
    // POCO F8 Ultra landscape: 2608 x 1200 physical at dpr 3.
    const ratio = pixelRatioForBudget(2608 / 3, 1200 / 3, 3, 2_200_000);
    expect((2608 / 3) * (1200 / 3) * ratio * ratio).toBeLessThanOrEqual(2_200_000 * 1.0001);
    expect(pixelRatioForBudget(800, 400, 2, 3_200_000)).toBe(2);
  });

  it('chooses a safe tier after an abnormal reload', () => {
    expect(chooseQuality(null, { mobile: false, recoveredFromCrash: true, webgpu: true })).toBe('low');
    expect(chooseQuality(null, { mobile: true, recoveredFromCrash: false, webgpu: true })).toBe('med');
    expect(chooseQuality('high', { mobile: true, recoveredFromCrash: true, webgpu: false })).toBe('high');
  });
});
