import { SEA_LEVEL, TOWN_X, TOWN_Z } from '../world/constants';
import { heightAt } from '../world/heightField';
import type { Weather } from '../env/weather';

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

/** Interim poses around the village; the G1.5 phase C commit re-poses them from the baked data. */
export const CAMERAS: readonly CameraSpec[] = [
  { name: 'coast-low', x: TOWN_X + 40, z: TOWN_Z, lift: 1.5, targetX: TOWN_X + 300, targetZ: TOWN_Z - 200, targetLift: 0.5, fovDeg: 58 },
  { name: 'architecture-detail', x: TOWN_X, z: TOWN_Z + 20, lift: 1.7, targetX: TOWN_X - 40, targetZ: TOWN_Z - 60, targetLift: 1.4, fovDeg: 55 },
  { name: 'vegetation-near', x: TOWN_X - 100, z: TOWN_Z + 200, lift: 1.2, targetX: TOWN_X - 50, targetZ: TOWN_Z + 300, targetLift: 1, fovDeg: 60 },
  { name: 'backlit-dusk-water', x: TOWN_X, z: TOWN_Z - 20, lift: 2, targetX: TOWN_X + 300, targetZ: TOWN_Z - 500, targetLift: 0, fovDeg: 55, hour: 19.6 },
  { name: 'rain-night', x: TOWN_X - 50, z: TOWN_Z + 30, lift: 1.7, targetX: TOWN_X + 50, targetZ: TOWN_Z - 60, targetLift: 1.5, fovDeg: 60, hour: 22.5, weather: 'rain' },
  { name: 'town-harbour-overview', x: TOWN_X - 300, z: TOWN_Z + 400, lift: 170, targetX: TOWN_X, targetZ: TOWN_Z - 100, targetLift: 0, fovDeg: 50 },
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
