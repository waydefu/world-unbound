import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { placeTurfCamera, TURF_SITES, type ResolvedCamera } from '../src/app/cameras';
import { applyInspectionPose, INSPECTION_HEIGHTS, parseInspectionPose, sampleInspectionPose } from '../src/app/inspectionPose';
import { parseParams } from '../src/app/params';
import { heightAt } from '../src/world/heightField';

const makeEye = (): ResolvedCamera => ({ x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, fovDeg: 55 });

describe('grass inspection lenses', () => {
  it('opts into free inspection on the normal, world, reference and authored tile routes', () => {
    expect(parseParams('')).toMatchObject({ cam: 5, inspect: false, inspectPose: null });
    expect(parseParams('?inspect=1&sward=world')).toMatchObject({ cam: 6, inspect: true, worldTurf: true });
    expect(parseParams('?inspect=1&sward=world&turfReference=1'))
      .toMatchObject({ cam: 6, inspect: true, turfReference: true, turfSite: 'slope' });
    expect(parseParams('?inspect=1&sod=full')).toMatchObject({ cam: 2, inspect: true, sodView: 'edge' });
    expect(parseParams('?inspect=1&sward=world&turfBench=all')).toMatchObject({ cam: 5, inspect: false });
  });

  it('aims the fixed macro pose just above the surface at all four world sites', () => {
    expect(parseParams('?turfView=macro')).toMatchObject({ cam: 6, turfSite: 'slope', turfView: 'macro', inspect: false });
    for (const site of Object.keys(TURF_SITES) as Array<keyof typeof TURF_SITES>) {
      const eye = makeEye();
      placeTurfCamera(eye, site, 'macro');
      expect(eye.y - heightAt(eye.x, eye.z)).toBeCloseTo(INSPECTION_HEIGHTS.macro);
      expect(eye.targetY - heightAt(eye.targetX, eye.targetZ)).toBeCloseTo(INSPECTION_HEIGHTS.macro);
    }
  });

  it('round trips an exact world eye, look direction, and lens through the shareable query', () => {
    const eye = makeEye();
    const camera = new PerspectiveCamera(50, 1.5, .008, 7000);
    const input = parseInspectionPose('684,25.055,444,-40,-5,50,.008');
    if (!input) throw new Error('Expected a valid inspection pose');
    applyInspectionPose(eye, camera, input);
    const sampled = sampleInspectionPose(eye, camera);
    expect(sampled).toMatchObject({ eye: { x: 684, y: 25.055, z: 444 }, fovDeg: 50, nearM: .008 });
    const params = parseParams(`?inspectPose=${encodeURIComponent(sampled.query)}`);
    const nextCamera = new PerspectiveCamera();
    const nextEye = makeEye();
    if (!params.inspectPose) throw new Error('Expected the telemetry camera pose to replay');
    applyInspectionPose(nextEye, nextCamera, params.inspectPose);
    expect(nextEye).toEqual(eye);
    expect(nextCamera.quaternion.angleTo(camera.quaternion)).toBeCloseTo(0);
    expect(nextCamera.near).toBe(camera.near);
    expect(params.inspect).toBe(false);
  });

  it('rejects incomplete, out-of-world, or invalid lens poses', () => {
    for (const pose of ['0,1,0,0,0,50', '4096,1,0,0,0,50,.008', '0,1,0,,0,50,.008',
      '0,1,0,0,0,50,0', '0,NaN,0,0,0,50,.008', '0,1,0,181,0,50,.008']) {
      expect(parseInspectionPose(pose)).toBeNull();
    }
  });
});
