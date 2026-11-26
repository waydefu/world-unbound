import { Euler, MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { ResolvedCamera } from './cameras';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';

export const INSPECTION_NEAR_M = .008;
export const INSPECTION_HEIGHTS = { macro: .055, standing: 1.65, raised: 7.2 } as const;

export interface InspectionPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  near: number;
}

/** World eye coordinates in metres, yaw/pitch and vertical field of view in degrees. */
export function parseInspectionPose(raw: string | null): InspectionPose | null {
  const fields = raw?.split(',');
  if (fields?.length !== 7 || fields.some((field) => field.trim() === '')) return null;
  const [x, y, z, yaw, pitch, fov, near] = fields.map(Number);
  if (![x, y, z, yaw, pitch, fov, near].every(Number.isFinite)) return null;
  if (x < WORLD_MIN || x > WORLD_MAX || z < WORLD_MIN || z > WORLD_MAX || y < -56 || y > 1500
    || Math.abs(yaw) > 180 || Math.abs(pitch) > 90 || fov < 20 || fov > 100 || near < .005 || near > 1) return null;
  return { x, y, z, yaw, pitch, fov, near };
}

export function applyInspectionPose(eye: ResolvedCamera, camera: PerspectiveCamera, pose: InspectionPose): void {
  eye.x = pose.x;
  eye.y = pose.y;
  eye.z = pose.z;
  camera.fov = pose.fov;
  camera.near = pose.near;
  camera.rotation.set(MathUtils.degToRad(pose.pitch), MathUtils.degToRad(pose.yaw), 0, 'YXZ');
}

/** Capture lens and orientation independently of scripted, mouse or touch input. */
export function sampleInspectionPose(eye: ResolvedCamera, camera: PerspectiveCamera) {
  const { x, y, z } = eye;
  const q = camera.quaternion;
  const direction = new Vector3(0, 0, -1).applyQuaternion(q);
  const euler = new Euler().setFromQuaternion(q, 'YXZ');
  const yawDeg = MathUtils.radToDeg(euler.y);
  const pitchDeg = MathUtils.radToDeg(euler.x);
  const { fov: fovDeg, near: nearM, aspect } = camera;
  return {
    eye: { x, y, z }, direction: { x: direction.x, y: direction.y, z: direction.z },
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, yawDeg, pitchDeg, fovDeg, nearM, aspect,
    query: [x, y, z, yawDeg, pitchDeg, fovDeg, nearM].join(','),
  };
}
