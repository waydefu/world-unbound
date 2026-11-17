import { QUAY_Z, SEA_LEVEL } from '../world/constants';
import { heightAt } from '../world/heightField';
import { coastlineZ } from '../world/terrainShape';
import type { Weather } from './params';

/**
 * The six fixed acceptance cameras. Positions are given relative to the
 * authoritative ground (or the sea surface when over water) so they stay
 * valid when the terrain shape is tuned.
 */
export interface CameraSpec {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** Eye height above ground/sea in metres. */
  readonly lift: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly targetLift: number;
  readonly fovDeg: number;
  /** Used when the URL does not pin ?hour / ?wx. */
  readonly hour?: number;
  readonly weather?: Weather;
}

const EAST_SHORE_X = 560;

export const CAMERAS: readonly CameraSpec[] = [
  {
    name: 'coast-low', x: EAST_SHORE_X, z: coastlineZ(EAST_SHORE_X) + 14, lift: 1.5,
    targetX: 300, targetZ: coastlineZ(300) - 60, targetLift: 0.5, fovDeg: 58,
  },
  { name: 'architecture-detail', x: 24, z: 36, lift: 1.7, targetX: -10, targetZ: -60, targetLift: 1.4, fovDeg: 55 },
  { name: 'vegetation-near', x: 400, z: 340, lift: 1.2, targetX: 470, targetZ: 470, targetLift: 1, fovDeg: 60 },
  {
    name: 'backlit-dusk-water', x: -30, z: QUAY_Z + 8, lift: 2, targetX: -260, targetZ: QUAY_Z - 420, targetLift: 0,
    fovDeg: 55, hour: 19.6,
  },
  {
    name: 'rain-night', x: -70, z: -110, lift: 1.7, targetX: 30, targetZ: QUAY_Z, targetLift: 1.5,
    fovDeg: 60, hour: 22.5, weather: 'rain',
  },
  { name: 'town-harbour-overview', x: -560, z: 640, lift: 170, targetX: 20, targetZ: -170, targetLift: 0, fovDeg: 50 },
];

export interface ResolvedCamera {
  x: number; y: number; z: number;
  targetX: number; targetY: number; targetZ: number;
  fovDeg: number;
}

export function resolveCamera(spec: CameraSpec, out: ResolvedCamera): ResolvedCamera {
  out.x = spec.x;
  out.z = spec.z;
  out.y = Math.max(heightAt(spec.x, spec.z), SEA_LEVEL) + spec.lift;
  out.targetX = spec.targetX;
  out.targetZ = spec.targetZ;
  out.targetY = Math.max(heightAt(spec.targetX, spec.targetZ), SEA_LEVEL) + spec.targetLift;
  out.fovDeg = spec.fovDeg;
  return out;
}
