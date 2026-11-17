import type { Pose, SpikeScene } from './sceneData';

/** What every engine adapter must provide to the spike harness. */
export interface Runner {
  readonly engine: string;
  readonly backend: 'webgpu' | 'webgl2';
  /** Where the GPU time comes from; engines measure different scopes. */
  readonly gpuScope: string;
  readonly snapshotActive: boolean;
  setPose(pose: Pose): void;
  /** Builds and submits one frame synchronously. */
  render(): void;
  drawCalls(): number;
  /** Called once per frame after render(); may start async GPU timing work. */
  afterFrame(frame: number): void;
  /** Latest GPU time per frame in ms, or null when not available. */
  gpuMs(): number | null;
  dispose(): void;
}

export interface RunnerOptions {
  backend: 'webgpu' | 'webgl2';
  width: number;
  height: number;
  snapshot: boolean;
}

export type RunnerFactory = (canvas: HTMLCanvasElement, scene: SpikeScene, options: RunnerOptions) => Promise<Runner>;
