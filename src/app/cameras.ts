import { SEA_LEVEL } from '../world/constants';
import { heightAt } from '../world/heightField';
import type { Weather } from '../env/weather';
import type { SodView } from './params';

/**
 * The fixed test cameras at Hellesylt. Positions are plain constants
 * read off the baked terrain (the village shore faces north-east: the flat
 * ground lies south-west of the waterline); heights are given relative to the
 * authoritative ground (or the sea surface when over water).
 */
export interface CameraSpec {
  readonly name: string;
  readonly label?: string;
  readonly x: number;
  readonly z: number;
  /** Eye height above ground/sea in metres. */
  readonly lift: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly targetLift: number;
  readonly fovDeg: number;
  readonly nearM?: number;
  readonly allowLook?: boolean;
  /** Used when the URL does not pin ?hour / ?wx. */
  readonly hour?: number;
  readonly weather?: Weather;
}

export const CAMERAS: readonly CameraSpec[] = [
  // Village shore at the head of the fjord, looking along the waterline (water on the left).
  { name: 'coast-low', x: 70, z: -324, lift: 1.5, targetX: 240, targetZ: -215, targetLift: 0.5, fovDeg: 58 },
  // Village ground (flat, ~1.7 m) looking across the harbour basin towards the dock.
  { name: 'architecture-detail', x: 150, z: -170, lift: 1.7, targetX: 232, targetZ: -112, targetLift: 1.4, fovDeg: 55 },
  // Grass slope rising behind the village, looking up it.
  { name: 'vegetation-near', x: 20, z: -40, lift: 1.2, targetX: -40, targetZ: 30, targetLift: 1, fovDeg: 60 },
  // Waterfront on the fjord shore, looking up the open fjord (azimuth 42 deg, no terrain above 0 deg). From
  // here the western evening sun (azimuth ~313 deg at 4 deg) is behind a 600 m mountain wall, so the
  // visible-direction sun is the early one: 03:30 puts it 3.7 deg up at azimuth 48 deg, just right of centre.
  {
    name: 'backlit-dusk-water', x: 220, z: -252, lift: 2, targetX: 634, targetZ: -684, targetLift: 0,
    fovDeg: 55, hour: 3.5,
  },
  // Village ground towards the dock.
  {
    name: 'rain-night', x: 60, z: -200, lift: 1.7, targetX: 240, targetZ: -100, targetLift: 1.2,
    fovDeg: 60, hour: 22.5, weather: 'rain',
  },
  // South-west of the village, ~230 m above its ground, looking over the harbour and up the fjord.
  { name: 'town-harbour-overview', x: -100, z: 60, lift: 170, targetX: 350, targetZ: -400, targetLift: 0, fovDeg: 50 },
  // Same patch as camera 2, looking down to the roots in the live sward.
  {
    name: 'grass-closeup', label: '6 Grass', x: 20, z: -40, lift: 0.16,
    targetX: 19.73, targetZ: -39.68, targetLift: 0, fovDeg: 50, nearM: 0.035, allowLook: true,
  },
];

export interface ResolvedCamera {
  x: number; y: number; z: number;
  targetX: number; targetY: number; targetZ: number;
  fovDeg: number;
}

export const TURF_SITES = {
  slope: { x: 20, z: -40 }, lowland: { x: 684, z: 444 }, highland: { x: -660, z: 492 },
} as const;
export type TurfSite = keyof typeof TURF_SITES;
export type TurfView = 'close' | 'standing' | 'raised';

export function placeTurfCamera(eye: ResolvedCamera, site: TurfSite, view: TurfView): void {
  const { x, z } = TURF_SITES[site];
  eye.x = x;
  eye.z = z;
  eye.y = heightAt(x, z) + (view === 'close' ? .16 : view === 'standing' ? 1.2 : 7.2);
  eye.targetX = x - .64;
  eye.targetZ = z + .77;
  eye.targetY = eye.y - (view === 'close' ? .42 : view === 'standing' ? .42 : 2.55);
  eye.fovDeg = 50;
}

export function turfWalkCamera(eye: ResolvedCamera, spec: CameraSpec): CameraSpec {
  return {
    ...spec, x: eye.x, z: eye.z, targetX: eye.targetX, targetZ: eye.targetZ,
    lift: eye.y - heightAt(eye.x, eye.z),
  };
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

/** A nearly level 2 m terrain cell near camera 2; the rigid 1 m tile spans less than 1 cm of relief here. */
export const SOD_ORIGIN = { x: 31, z: -49 } as const;

export function sodBaseY(): number {
  return heightAt(SOD_ORIGIN.x, SOD_ORIGIN.z) + 0.032;
}

// The master camera positions and lenses from tools/build-sod.py, converted from Blender Z-up to game Y-up.
const SOD_CAMERAS = {
  edge: { eye: [0.27, 0.115, 0.84], target: [0.085, 0.018, 0.43], lens: 66, aspect: 1100 / 800 },
  standing: { eye: [0.35, 1.62, 1.58], target: [0.01, 0.013, 0.04], lens: 54, aspect: 1060 / 810 },
  elevated: { eye: [0.12, 2.5, 0.34], target: [0, 0.013, 0], lens: 71, aspect: 1060 / 950 },
  backlight: { eye: [0.065, 0.188, 0.73], target: [-0.07, 0.039, 0.029], lens: 68, aspect: 1160 / 790 },
} as const;

export function resolveSodCamera(view: SodView, out: ResolvedCamera): void {
  const { eye, target, lens, aspect } = SOD_CAMERAS[view];
  const y = sodBaseY();
  out.x = SOD_ORIGIN.x + eye[0];
  out.y = y + eye[1];
  out.z = SOD_ORIGIN.z + eye[2];
  out.targetX = SOD_ORIGIN.x + target[0];
  out.targetY = y + target[1];
  out.targetZ = SOD_ORIGIN.z + target[2];
  out.fovDeg = 360 / Math.PI * Math.atan(36 / (2 * lens * aspect));
}

const WALK_METRES = 8.4;
const WALK_DURATION_MS = 12000;
const WALK_GROUND_STEPS = 84;

/** Repeat an 8.4 m out-and-back path at fixed eye height above ground for phone A/B captures. */
export class GrassTestWalk {
  private spec: CameraSpec | null = null;
  private start = -1;
  private dx = 0;
  private dz = 0;
  private readonly ground = new Float32Array(WALK_GROUND_STEPS + 1);

  reset(spec: CameraSpec | null): void {
    this.spec = spec;
    this.start = -1;
    if (!spec) return;
    const dx = spec.targetX - spec.x;
    const dz = spec.targetZ - spec.z;
    const length = Math.hypot(dx, dz);
    this.dx = dx / length;
    this.dz = dz / length;
    for (let i = 0; i <= WALK_GROUND_STEPS; i++) {
      const distance = i * WALK_METRES / WALK_GROUND_STEPS;
      this.ground[i] = Math.max(heightAt(spec.x + this.dx * distance, spec.z + this.dz * distance), SEA_LEVEL) + spec.lift;
    }
  }

  /** @hot */
  update(now: number, eye: ResolvedCamera): void {
    const spec = this.spec;
    if (!spec) return;
    if (this.start < 0) this.start = now;
    const phase = ((now - this.start) % WALK_DURATION_MS) / WALK_DURATION_MS;
    const progress = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
    const distance = progress * WALK_METRES;
    const at = progress * WALK_GROUND_STEPS;
    const i = Math.min(Math.floor(at), WALK_GROUND_STEPS - 1);
    eye.x = spec.x + this.dx * distance;
    eye.z = spec.z + this.dz * distance;
    eye.y = this.ground[i] + (this.ground[i + 1] - this.ground[i]) * (at - i);
  }
}
