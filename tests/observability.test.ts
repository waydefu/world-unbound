import { describe, expect, it } from 'vitest';
import { Frustum, Matrix4, PerspectiveCamera } from 'three/webgpu';
import { SlidingRate } from '../src/perf/slidingRate';
import { SampleRing } from '../src/perf/sampleRing';
import { ChunkRequests } from '../src/world/chunkRequests';
import { countChunks } from '../src/render/chunkStats';

describe('SlidingRate', () => {
  it('reports the per-second sum over the window and forgets old events', () => {
    const r = new SlidingRate(2000, 16);
    r.add(0, 1000);
    r.add(1000, 3000);
    expect(r.perSecond(1500)).toBeCloseTo(2000, 6);
    expect(r.perSecond(2500)).toBeCloseTo(1500, 6);
    expect(r.perSecond(10000)).toBe(0);
  });

  it('overwrites the oldest events when the ring is full', () => {
    const r = new SlidingRate(1000, 4);
    for (let i = 0; i < 10; i++) r.add(i, 1);
    expect(r.perSecond(10)).toBeCloseTo(4, 6);
  });
});

describe('build-time ring', () => {
  it('keeps the latest 120 samples for percentiles', () => {
    const ring = new SampleRing(120);
    for (let i = 1; i <= 300; i++) ring.push(i);
    expect(ring.count).toBe(120);
    expect(ring.percentile(0.5)).toBe(241);
    expect(ring.percentile(0)).toBe(181);
    expect(ring.percentile(1)).toBe(300);
  });
});

describe('countChunks', () => {
  const camera = new PerspectiveCamera(60, 1, 1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  // Slots: 0 ahead, 1 behind, 2 ahead but huge sphere reaching sideways, 3 empty, 4 far left.
  const spheres = new Float32Array([
    0, 0, -100, 10,
    0, 0, 100, 10,
    500, 0, -100, 450,
    0, 0, -100, 10,
    -900, 0, -100, 10,
  ]);
  const tris = new Int32Array([100, 100, 50, 0, 70]);

  it('splits resident spheres into visible and culled and sums visible triangles', () => {
    const c = countChunks(frustum, spheres, tris, null, 0, 0, 0, { visible: 0, culled: 0, triangles: 0 });
    expect(c.visible).toBe(2);
    expect(c.culled).toBe(2);
    expect(c.visible + c.culled).toBe(4);
    expect(c.triangles).toBe(150);
  });

  it('honours the mask and the root offset', () => {
    const mask = new Uint8Array([1, 1, 0, 1, 1]);
    const c = countChunks(frustum, spheres, tris, mask, 0, 0, 0, { visible: 0, culled: 0, triangles: 0 });
    expect(c.visible + c.culled).toBe(3);
    const moved = countChunks(frustum, spheres, tris, mask, 0, 0, 1000, { visible: 0, culled: 0, triangles: 0 });
    expect(moved.visible).toBe(0);
  });
});

describe('ChunkRequests.queuedCount', () => {
  it('counts wanted slots that are neither resident nor in flight', () => {
    const r = new ChunkRequests();
    r.updateDesired(0, 0, 0, 0, 0, { lod0Distance: 100, viewRadius: 300 }, 0);
    const wanted = r.desired.filter((d) => d >= 0).length;
    expect(wanted).toBeGreaterThan(4);
    expect(r.queuedCount()).toBe(wanted);
    const slot = r.nextToDispatch();
    r.dispatch(slot);
    expect(r.queuedCount()).toBe(wanted - 1);
  });
});
