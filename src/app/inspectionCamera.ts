import { MathUtils, type PerspectiveCamera } from 'three/webgpu';
import { CELL_SIZE, SEA_LEVEL, WORLD_MAX, WORLD_MIN } from '../world/constants';
import { heightAt, interpolateCell } from '../world/heightField';
import { createInspectionControls, type InspectionHeight } from '../ui/inspectionControls';
import type { ResolvedCamera } from './cameras';
import { INSPECTION_HEIGHTS } from './inspectionPose';

const FORWARD = 1;
const BACK = 2;
const LEFT = 4;
const RIGHT = 8;
const MOVEMENT = { KeyW: FORWARD, ArrowUp: FORWARD, KeyS: BACK, ArrowDown: BACK,
  KeyA: LEFT, ArrowLeft: LEFT, KeyD: RIGHT, ArrowRight: RIGHT } as const;

export class InspectionCamera {
  private readonly keys = new Set<keyof typeof MOVEMENT>();
  private readonly controls;
  private buttons = 0;
  private pendingHeight: InspectionHeight | null = null;
  private lift: number = INSPECTION_HEIGHTS.standing;
  private groundX = Infinity;
  private groundZ = Infinity;
  private h00 = 0;
  private h10 = 0;
  private h01 = 0;
  private h11 = 0;

  constructor(viewport: HTMLElement) {
    this.controls = createInspectionControls(viewport, {
      move: (action, held) => {
        const mask = MOVEMENT[action];
        this.buttons = held ? this.buttons | mask : this.buttons & ~mask;
      },
      height: (height) => { this.pendingHeight = height; },
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  reset(eye: ResolvedCamera): void {
    this.clear();
    this.pendingHeight = null;
    this.lift = eye.y - this.groundAt(eye.x, eye.z);
    this.controls.setHeight(this.lift);
  }

  private readonly clear = (): void => {
    this.keys.clear();
    this.buttons = 0;
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (event.altKey || event.ctrlKey || event.metaKey || (target instanceof HTMLElement
      && (target.isContentEditable || target.matches('input, select, textarea')))) return;
    switch (event.code) {
      case 'KeyC': this.pendingHeight = 'macro'; break;
      case 'KeyV': this.pendingHeight = 'standing'; break;
      case 'KeyB': this.pendingHeight = 'raised'; break;
      default:
        if (!Object.hasOwn(MOVEMENT, event.code)) return;
        this.keys.add(event.code as keyof typeof MOVEMENT);
    }
    event.preventDefault();
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code as keyof typeof MOVEMENT);
  };

  /** @amortized Sample the authoritative terrain only on entry into a new 2 m cell. */
  private loadGroundCell(x: number, z: number): void {
    this.groundX = x;
    this.groundZ = z;
    this.h00 = heightAt(x, z);
    this.h10 = heightAt(x + CELL_SIZE, z);
    this.h01 = heightAt(x, z + CELL_SIZE);
    this.h11 = heightAt(x + CELL_SIZE, z + CELL_SIZE);
  }

  /** @hot Match the heightfield's two-triangle interpolation inside a resident cell. */
  private groundAt(x: number, z: number): number {
    const cellX = Math.floor(x / CELL_SIZE) * CELL_SIZE;
    const cellZ = Math.floor(z / CELL_SIZE) * CELL_SIZE;
    if (cellX !== this.groundX || cellZ !== this.groundZ) this.loadGroundCell(cellX, cellZ);
    const fx = (x - cellX) / CELL_SIZE;
    const fz = (z - cellZ) / CELL_SIZE;
    const ground = interpolateCell(this.h00, this.h10, this.h01, this.h11, fx, fz);
    return Math.max(ground, SEA_LEVEL);
  }

  /** @hot */
  update(eye: ResolvedCamera, camera: PerspectiveCamera, interval: number): void {
    let held = this.buttons;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) held |= FORWARD;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) held |= BACK;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) held |= LEFT;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) held |= RIGHT;
    const strafe = Number(!!(held & RIGHT)) - Number(!!(held & LEFT));
    const forward = Number(!!(held & FORWARD)) - Number(!!(held & BACK));
    if (!strafe && !forward && this.pendingHeight === null) return;
    if (this.pendingHeight !== null) {
      this.lift = INSPECTION_HEIGHTS[this.pendingHeight];
      this.controls.setHeight(this.lift);
      this.pendingHeight = null;
    }
    if (strafe || forward) {
      const yaw = camera.rotation.y;
      const speed = this.lift < .2 ? .65 : 2.5;
      const step = speed * Math.min(Math.max(interval, 0), 50) / (1000 * Math.hypot(strafe, forward));
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      eye.x = MathUtils.clamp(eye.x + step * (strafe * cos - forward * sin), WORLD_MIN, WORLD_MAX);
      eye.z = MathUtils.clamp(eye.z - step * (strafe * sin + forward * cos), WORLD_MIN, WORLD_MAX);
    }
    eye.y = this.groundAt(eye.x, eye.z) + Math.max(INSPECTION_HEIGHTS.macro, this.lift);
  }

}

