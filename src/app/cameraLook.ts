import { MathUtils, type Camera } from 'three/webgpu';

const RADIANS_PER_PIXEL = 0.005;
const MAX_PITCH = MathUtils.degToRad(88);

/** First-person look around a fixed camera position. */
export class CameraLook {
  private enabled = false;
  private pointer: number | null = null;
  private x = 0;
  private y = 0;

  constructor(private readonly viewport: HTMLElement, private readonly camera: Camera) {
    viewport.addEventListener('pointerdown', this.start);
    viewport.addEventListener('pointermove', this.move);
    viewport.addEventListener('pointerup', this.end);
    viewport.addEventListener('pointercancel', this.end);
    viewport.addEventListener('lostpointercapture', this.end);
  }

  reset(enabled: boolean): void {
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer !== null && this.viewport.hasPointerCapture(pointer)) this.viewport.releasePointerCapture(pointer);
    this.enabled = enabled;
    this.viewport.classList.toggle('look-enabled', enabled);
  }

  private readonly start = (event: PointerEvent): void => {
    if (!this.enabled || this.pointer !== null || !event.isPrimary || event.button !== 0) return;
    this.viewport.setPointerCapture(event.pointerId);
    this.pointer = event.pointerId;
    this.x = event.clientX;
    this.y = event.clientY;
    this.camera.rotation.reorder('YXZ');
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    const { clientX, clientY } = event;
    const rotation = this.camera.rotation;
    const pitch = rotation.x - (clientY - this.y) * RADIANS_PER_PIXEL;
    const yaw = rotation.y - (clientX - this.x) * RADIANS_PER_PIXEL;
    rotation.set(MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH), yaw, 0, 'YXZ');
    this.x = clientX;
    this.y = clientY;
  };

  private readonly end = (event: PointerEvent): void => {
    if (event.pointerId === this.pointer) this.pointer = null;
  };
}
