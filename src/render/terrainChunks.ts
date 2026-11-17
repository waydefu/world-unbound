import {
  BufferAttribute, BufferGeometry, FrontSide, Group, Mesh, MeshStandardNodeMaterial, Sphere, Vector3,
} from 'three/webgpu';
import type { TerrainResult } from '../app/terrainJob';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import { CHUNK_COUNT, CHUNK_SIZE, MAX_LOD } from '../world/constants';
import { lodIndexCount, lodVertexCount, slotCx, slotCz } from '../world/chunkGrid';
import { buildLodIndices } from '../world/terrainMesh';

const BYTES_PER_VERTEX = 12 + 12 + 4;
const POOL_LIMIT = 24;

/**
 * GPU-facing terrain: one Mesh per resident chunk, geometries pooled per LOD
 * and index buffers shared per LOD. Vertex data stays chunk-local; chunk
 * meshes sit under `root`, which the app moves by -camera each frame so the
 * GPU only ever sees camera-relative f32 positions.
 */
export class TerrainChunks {
  readonly root = new Group();
  readonly material: MeshStandardNodeMaterial;
  private readonly meshes: (Mesh | null)[] = new Array<Mesh | null>(CHUNK_COUNT).fill(null);
  private readonly meshLod = new Int8Array(CHUNK_COUNT).fill(-1);
  private readonly geometryPool: BufferGeometry[][] = [];
  private readonly meshPool: Mesh[] = [];
  private readonly indices: BufferAttribute[] = [];
  residentTriangles = 0;

  constructor(private readonly memory: MemoryRegistry) {
    this.material = new MeshStandardNodeMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      side: FrontSide,
    });
    this.material.name = 'terrain';
    for (let lod = 0; lod <= MAX_LOD; lod++) {
      this.geometryPool.push([]);
      const index = new BufferAttribute(buildLodIndices(lod), 1);
      this.indices.push(index);
      // Shared buffers are accounted once, not per chunk.
      memory.add(MemoryPartition.Gpu, index.array.byteLength);
      memory.add(MemoryPartition.CpuRetained, index.array.byteLength);
    }
    this.root.name = 'terrain-root';
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
      mesh = this.meshPool.pop() ?? new Mesh(undefined, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.position.set(slotCx(slot) * CHUNK_SIZE, 0, slotCz(slot) * CHUNK_SIZE);
      mesh.updateMatrix();
      this.meshes[slot] = mesh;
      this.root.add(mesh);
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
    this.meshLod[slot] = lod;
    this.residentTriangles += lodIndexCount(lod) / 3;
  }

  evict(slot: number): void {
    const mesh = this.meshes[slot];
    if (!mesh) return;
    this.releaseGeometry(this.meshLod[slot], mesh.geometry);
    this.residentTriangles -= lodIndexCount(this.meshLod[slot]) / 3;
    this.root.remove(mesh);
    this.meshes[slot] = null;
    this.meshLod[slot] = -1;
    this.meshPool.push(mesh);
  }
}

function copyInto(attribute: BufferAttribute, source: Float32Array | Uint8Array): void {
  (attribute.array as Float32Array | Uint8Array).set(source);
  attribute.needsUpdate = true;
}
