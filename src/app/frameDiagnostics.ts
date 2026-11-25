import { SampleRing } from '../perf/sampleRing';
import type { ResolvedCamera } from './cameras';

const SAMPLE_COUNT = 1024;
const HITCH_LIMIT = 32;
const HITCH_FIELDS = 9;

/** Optional CPU work split, plus bounded records correlating long rAF gaps with preceding app work. */
export class FrameDiagnostics {
  private readonly terrain = new SampleRing(SAMPLE_COUNT);
  private readonly vegetation = new SampleRing(SAMPLE_COUNT);
  private readonly submit = new SampleRing(SAMPLE_COUNT);
  private readonly total = new SampleRing(SAMPLE_COUNT);
  private readonly hitches = new Float64Array(HITCH_LIMIT * HITCH_FIELDS);
  private frames = 0;
  private previousCpuMs = 0;
  private previousTerrainMs = 0;
  private previousVegetationMs = 0;
  private hitchCount = 0;
  private previousCamera = 0;
  private previousX = 0;
  private previousY = 0;
  private previousZ = 0;

  /** @hot */
  push(elapsed: number, interval: number, frameStart: number, terrainMs: number, vegetationMs: number, submitMs: number, camera: number, eye: ResolvedCamera): void {
    if (this.frames > 0 && interval > 50) {
      const i = this.hitchCount++ % HITCH_LIMIT * HITCH_FIELDS;
      this.hitches[i] = elapsed;
      this.hitches[i + 1] = interval;
      this.hitches[i + 2] = this.previousCpuMs;
      this.hitches[i + 3] = this.previousTerrainMs;
      this.hitches[i + 4] = this.previousVegetationMs;
      this.hitches[i + 5] = this.previousCamera;
      this.hitches[i + 6] = this.previousX;
      this.hitches[i + 7] = this.previousY;
      this.hitches[i + 8] = this.previousZ;
    }
    this.previousCpuMs = performance.now() - frameStart;
    this.previousTerrainMs = terrainMs;
    this.previousVegetationMs = vegetationMs;
    this.previousCamera = camera;
    this.previousX = eye.x;
    this.previousY = eye.y;
    this.previousZ = eye.z;
    this.terrain.push(terrainMs);
    this.vegetation.push(vegetationMs);
    this.submit.push(submitMs);
    this.total.push(this.previousCpuMs);
    this.frames++;
  }

  report() {
    const phases = { terrainUpdate: this.terrain, vegetationUpdate: this.vegetation, renderSubmit: this.submit, frameCallback: this.total };
    const recentLongIntervals = [];
    for (let i = Math.max(0, this.hitchCount - HITCH_LIMIT); i < this.hitchCount; i++) {
      const offset = i % HITCH_LIMIT * HITCH_FIELDS;
      recentLongIntervals.push({ elapsedMs: this.hitches[offset], intervalMs: this.hitches[offset + 1],
        previousCallbackMs: this.hitches[offset + 2], previousTerrainMs: this.hitches[offset + 3], previousVegetationMs: this.hitches[offset + 4],
        cameraIndex: this.hitches[offset + 5], eye: { x: this.hitches[offset + 6], y: this.hitches[offset + 7], z: this.hitches[offset + 8] } });
    }
    return {
      phases: Object.fromEntries(Object.entries(phases).map(([phase, ring]) =>
        [phase, { samples: ring.count, p50Ms: ring.percentile(.5), p95Ms: ring.percentile(.95) }])),
      recentLongIntervals, totalLongIntervals: this.hitchCount,
    };
  }
}
