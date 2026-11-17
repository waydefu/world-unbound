import {
  BufferAttribute, BufferGeometry, BundleGroup, type DataTexture, Group, Mesh, type MeshStandardNodeMaterial, Sphere, Vector3,
} from 'three/webgpu';
import { resultBytes, type TerrainResult } from '../world/terrainJob';
import type { SlidingRate } from '../perf/slidingRate';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import { CHUNK_COUNT, CHUNK_SIZE, MAX_LOD } from '../world/constants';
import { lodIndexCount, lodVertexCount, slotCx, slotCz } from '../world/chunkGrid';
import { buildLodIndices } from '../world/terrainMesh';
import { createTerrainMaterial, type TerrainMaterial } from './terrainMaterial';

const BYTES_PER_VERTEX = 12 + 12 + 4;
const POOL_LIMIT = 24;

/**
 * GPU-facing terrain: one Mesh per resident chunk, geometries pooled per LOD
 * and index buffers shared per LOD. Vertex data stays chunk-local; chunk
 * meshes sit under `root`, which the app moves by -camera each frame so the
 * GPU only ever sees camera-relative f32 positions.
 *
 * Chunks live in a BundleGroup (ADR-0002 §10): on WebGPU the draws are
 * recorded once into a render bundle and replayed, re-recorded only when a
 * chunk is installed or evicted. A bundle is recorded from one view, so chunks
 * are not frustum culled while bundling; on WebGL2 the group is a plain group
 * and culling stays on.
 */
export class TerrainChunks {
  readonly root = new Group();
  private readonly bundle = new BundleGroup();
  private bundled = false;
  /** Chunk meshes currently installed (counted in apply/evict, not by scanning). */
  private residentChunkCount = 0;
  readonly material: MeshStandardNodeMaterial;
  private readonly terrainMaterial: TerrainMaterial;
  private readonly meshes: (Mesh | null)[] = new Array<Mesh | null>(CHUNK_COUNT).fill(null);
  private readonly meshLod = new Int8Array(CHUNK_COUNT).fill(-1);
  private readonly geometryPool: BufferGeometry[][] = [];
  private readonly meshPool: Mesh[] = [];
  private readonly indices: BufferAttribute[] = [];
  residentTriangles = 0;
  /** Per slot: bounding sphere (x, y, z, radius) in `root` space; telemetry reads it (frustum counts). */
  readonly chunkSpheres = new Float32Array(CHUNK_COUNT * 4);
  /** Per slot: triangles of the resident mesh (0 = not resident). */
  readonly chunkTriangles = new Int32Array(CHUNK_COUNT);
  /** Per slot: 1 when the chunk casts shadows. */
  readonly casterMask = new Uint8Array(CHUNK_COUNT);
  /** Receives the bytes of every geometry upload (set by the app). */
  uploads: SlidingRate | null = null;

  constructor(private readonly memory: MemoryRegistry, noise: DataTexture, lite = false) {
    this.terrainMaterial = createTerrainMaterial(noise, lite);
    this.material = this.terrainMaterial.material;
    for (let lod = 0; lod <= MAX_LOD; lod++) {
      this.geometryPool.push([]);
      const index = new BufferAttribute(buildLodIndices(lod), 1);
      this.indices.push(index);
      // Shared buffers are accounted once, not per chunk.
      memory.add(MemoryPartition.Gpu, index.array.byteLength);
      memory.add(MemoryPartition.CpuRetained, index.array.byteLength);
    }
    this.root.name = 'terrain-root';
    this.bundle.name = 'terrain-bundle';
    this.root.add(this.bundle);
  }

  /** @hot delegates to a uniform write */
  setEyeOffset(x: number, y: number, z: number): void {
    this.terrainMaterial.setEyeOffset(x, y, z);
  }

  setWetness(wetness: number): void {
    this.terrainMaterial.setWetness(wetness);
  }

  /** Draws replayed from the render bundle (not counted by renderer.info); 0 when not bundling. */
  get bundledCount(): number {
    return this.bundled ? this.residentChunkCount : 0;
  }

  /** Called once the backend is known (and again after a device-loss rebuild). */
  setBundled(bundled: boolean): void {
    this.bundled = bundled;
    for (const mesh of this.meshes) if (mesh) mesh.frustumCulled = !bundled;
    for (const mesh of this.meshPool) mesh.frustumCulled = !bundled;
    this.bundle.needsUpdate = true;
  }

  private acquireGeometry(lod: number): BufferGeometry {
    const pooled = this.geometryPool[lod].pop();
    if (pooled) return pooled;
    const count = lodVertexCount(lod);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new BufferAttribute(new Uint8Array(count * 4), 4, true));
    geometry.setIndex(this.indices[lod]);
    geometry.boundingSphere = new Sphere(new Vector3(), 1);
    const bytes = count * BYTES_PER_VERTEX;
    this.memory.add(MemoryPartition.Gpu, bytes);
    // three.js keeps the CPU copy so the data survives a device loss.
    this.memory.add(MemoryPartition.CpuRetained, bytes);
    return geometry;
  }

  private releaseGeometry(lod: number, geometry: BufferGeometry): void {
    const pool = this.geometryPool[lod];
    if (pool.length < POOL_LIMIT) {
      pool.push(geometry);
      return;
    }
    const bytes = lodVertexCount(lod) * BYTES_PER_VERTEX;
    this.memory.remove(MemoryPartition.Gpu, bytes);
    this.memory.remove(MemoryPartition.CpuRetained, bytes);
    geometry.setIndex(null);
    geometry.dispose();
  }

  /** Installs a finished chunk mesh, replacing any other LOD of the same chunk. */
  apply(result: TerrainResult): void {
    const { slot, lod } = result;
    let mesh = this.meshes[slot];
    if (mesh) {
      this.releaseGeometry(this.meshLod[slot], mesh.geometry);
      this.residentTriangles -= lodIndexCount(this.meshLod[slot]) / 3;
    } else {
      mesh = this.meshPool.pop() ?? this.createMesh();
      mesh.position.set(slotCx(slot) * CHUNK_SIZE, 0, slotCz(slot) * CHUNK_SIZE);
      mesh.updateMatrix();
      this.meshes[slot] = mesh;
      this.bundle.add(mesh);
      this.residentChunkCount++;
    }
    const geometry = this.acquireGeometry(lod);
    copyInto(geometry.getAttribute('position') as BufferAttribute, result.positions);
    copyInto(geometry.getAttribute('normal') as BufferAttribute, result.normals);
    copyInto(geometry.getAttribute('color') as BufferAttribute, result.colors);
    const half = CHUNK_SIZE / 2;
    const midY = (result.minY + result.maxY) / 2;
    const sphere = geometry.boundingSphere as Sphere;
    sphere.center.set(half, midY, half);
    sphere.radius = Math.hypot(half, half, (result.maxY - result.minY) / 2);
    mesh.geometry = geometry;
    const o = slot * 4;
    this.chunkSpheres[o] = mesh.position.x + half;
    this.chunkSpheres[o + 1] = midY;
    this.chunkSpheres[o + 2] = mesh.position.z + half;
    this.chunkSpheres[o + 3] = sphere.radius;
    this.chunkTriangles[slot] = lodIndexCount(lod) / 3;
    this.casterMask[slot] = mesh.castShadow ? 1 : 0;
    this.uploads?.add(performance.now(), resultBytes(result));
    this.meshLod[slot] = lod;
    this.residentTriangles += lodIndexCount(lod) / 3;
    this.bundle.needsUpdate = true;
  }

  private createMesh(): Mesh {
    const mesh = new Mesh(undefined, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = !this.bundled;
    return mesh;
  }

  evict(slot: number): void {
    const mesh = this.meshes[slot];
    if (!mesh) return;
    this.releaseGeometry(this.meshLod[slot], mesh.geometry);
    this.residentTriangles -= lodIndexCount(this.meshLod[slot]) / 3;
    this.bundle.remove(mesh);
    this.bundle.needsUpdate = true;
    this.meshes[slot] = null;
    this.meshLod[slot] = -1;
    this.chunkTriangles[slot] = 0;
    this.casterMask[slot] = 0;
    this.residentChunkCount--;
    this.meshPool.push(mesh);
  }
}

function copyInto(attribute: BufferAttribute, source: Float32Array | Uint8Array): void {
  (attribute.array as Float32Array | Uint8Array).set(source);
  attribute.needsUpdate = true;
}
