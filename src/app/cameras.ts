import { SEA_LEVEL } from '../world/constants';
import { heightAt } from '../world/heightField';
import type { Weather } from '../env/weather';

/**
 * The six fixed acceptance cameras at Hellesylt. Positions are plain constants
 * read off the baked terrain (the village shore faces north-east: the flat
 * ground lies south-west of the waterline); heights are given relative to the
 * authoritative ground (or the sea surface when over water).
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
