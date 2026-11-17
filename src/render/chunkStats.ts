import { Frustum, Matrix4, Sphere } from 'three/webgpu';
import type { TerrainChunks } from './terrainChunks';

/** Result of one chunk count. */
export interface ChunkCount {
  visible: number;
  culled: number;
  /** Triangles of the visible chunks. */
  triangles: number;
}

const sphere = new Sphere();

/**
 * Tests each resident chunk's bounding sphere against `frustum`. `spheres`
 * holds (x, y, z, radius) per slot in the chunk root's local space; the
 * frustum is in camera-relative world space, so `offset` (root position) is
 * added to the centres. A slot is resident when `triangles[slot] > 0`; when
 * `mask` is given, slots with `mask[slot] === 0` are skipped entirely.
 * Allocation-free.
 * @amortized scans every slot; telemetry tick only
 */
export function countChunks(
  frustum: Frustum, spheres: Float32Array, triangles: Int32Array, mask: Uint8Array | null,
  offsetX: number, offsetY: number, offsetZ: number, out: ChunkCount,
): ChunkCount {
  out.visible = 0;
  out.culled = 0;
  out.triangles = 0;
  for (let slot = 0; slot < triangles.length; slot++) {
    if (triangles[slot] <= 0 || (mask !== null && mask[slot] === 0)) continue;
    const o = slot * 4;
    sphere.center.set(spheres[o] + offsetX, spheres[o + 1] + offsetY, spheres[o + 2] + offsetZ);
    sphere.radius = spheres[o + 3];
    if (frustum.intersectsSphere(sphere)) {
      out.visible++;
      out.triangles += triangles[slot];
    } else {
      out.culled++;
    }
  }
  return out;
}

/** Per-tick chunk telemetry: main-camera visibility and per-cascade shadow triangles. */
export interface ChunkTelemetry {
  visible: number;
  culled: number;
  /** Resident chunks that cast shadows. */
  casters: number;
  /** Triangles of casting chunks inside each cascade's light frustum (index = cascade). */
  shadowTriangles: Float64Array;
  /** Number of cascades measured (0 when shadows are off or the cascade cameras are not reachable). */
  cascades: number;
}

export function createChunkTelemetry(): ChunkTelemetry {
  return { visible: 0, culled: 0, casters: 0, shadowTriangles: new Float64Array(4), cascades: 0 };
}

/** Anything with the two matrices a frustum is built from (a three.js camera). */
export interface FrustumSource {
  projectionMatrix: Matrix4;
  matrixWorldInverse: Matrix4;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const count: ChunkCount = { visible: 0, culled: 0, triangles: 0 };

/**
 * Measures what the renderer draws: the main camera's frustum over all resident chunks (on WebGPU the
 * bundled draws are never culled, so `culled` is wasted work; on WebGL2 it matches three's culling), and
 * for each cascade the triangles of the casting chunks that intersect the cascade's light frustum.
 * Cascade matrices are those of the last rendered frame. Allocation-free.
 * @amortized telemetry tick only
 */
export function sampleChunkStats(
  chunks: TerrainChunks, camera: FrustumSource, cascades: readonly FrustumSource[], out: ChunkTelemetry,
): void {
  const root = chunks.root.position;
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  countChunks(frustum, chunks.chunkSpheres, chunks.chunkTriangles, null, root.x, root.y, root.z, count);
  out.visible = count.visible;
  out.culled = count.culled;
  out.casters = 0;
  for (let i = 0; i < chunks.casterMask.length; i++) out.casters += chunks.casterMask[i];
  out.cascades = Math.min(cascades.length, out.shadowTriangles.length);
  for (let c = 0; c < out.cascades; c++) {
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(cascades[c].projectionMatrix, cascades[c].matrixWorldInverse));
    countChunks(frustum, chunks.chunkSpheres, chunks.chunkTriangles, chunks.casterMask, root.x, root.y, root.z, count);
    out.shadowTriangles[c] = count.triangles;
  }
}
