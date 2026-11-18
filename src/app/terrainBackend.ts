import type { Camera, DirectionalLight, Group, Mesh, PerspectiveCamera } from 'three/webgpu';
import type { FrustumSource } from '../render/chunkStats';
import type { ResolvedCamera } from './cameras';
import type { AppState } from './report';
import type { TerrainClient } from './terrainClient';

/** How the ground is drawn: GPU height texture + CDLOD nodes (default), or one CPU-built mesh per chunk (rollback). */
export type TerrainMode = 'cdlod' | 'chunks';

/**
 * What the app needs from either terrain renderer. The chunk path (streamer, worker meshes, far skin) and the
 * CDLOD path (height textures, node selection) both sit behind it, so App.ts stays path-agnostic.
 */
export interface TerrainBackend {
  readonly mode: TerrainMode;
  /** Moved by -eye every frame; holds everything the backend draws. */
  readonly root: Group;
  /** The terrain worker connection (also serves the sea floor). */
  readonly client: TerrainClient;
  /** Everything wanted is resident and drawn. */
  readonly settled: boolean;
  /** The far skin mesh (chunk path only) for triangle accounting. */
  readonly farMesh: Mesh | null;
  /** Terrain triangles in the main pass. */
  readonly mainTriangles: number;
  /** Draws replayed from a render bundle and so missing from renderer.info (chunk path on WebGPU). */
  readonly bundledDraws: number;
  /** The sun whose shadow cascades the terrain casts into (CDLOD culls casters per cascade). */
  attachSun(sun: DirectionalLight): void;
  /** Resolves when the terrain can be drawn (CDLOD: the worker's textures have arrived). Call before warm-up. */
  prepare(): Promise<void>;
  /** Makes the ground under (x, z) available synchronously so shader warm-up has terrain to compile against. */
  prime(x: number, z: number): void;
  /** Forces a refresh on the next update (camera cut). */
  invalidate(): void;
  /** Per-frame work: streaming (chunks) or node selection (CDLOD). @hot */
  update(now: number, eye: ResolvedCamera, camera: PerspectiveCamera): void;
  /** @hot */
  setEyeOffset(x: number, y: number, z: number): void;
  setWetness(wetness: number): void;
  /** The backend is known (WebGPU bundles chunk draws). */
  setBundled(bundled: boolean): void;
  /** The sea-floor heights are uploaded (the chunk path's far skin shows then). */
  seaFloorReady(): void;
  /** Fills the terrain-specific telemetry fields at the 2 Hz tick. */
  sample(state: AppState, camera: Camera, cascades: readonly FrustumSource[]): void;
}
