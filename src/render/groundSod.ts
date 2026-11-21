import { type Camera, type DataTexture, Matrix4, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { frustumPlanes } from '../world/cdlodMath';
import { WORLD_MIN } from '../world/constants';
import { sodBarycentric, sodCrownCount, sodHash, sodTriangleSeed, sodWorldAxis } from '../world/sodRoots';
import { HEIGHT_DIM, materialDim, type TerrainTextureData } from '../world/terrainTextures';
import type { GrassWindUniforms } from './grassWind';
import { CROWN_VARIANTS, createCrownBatch, loadCrownAtlas } from './sodCrown';

type Batch = ReturnType<typeof createCrownBatch>;
const PHASE = 2 * Math.PI / 0x100000000;
const SUBDIVISIONS = 64;

/** Native crowns are sampled on the authoritative triangles in world space. Only visible crowns are uploaded. */
export class GroundSod {
  readonly sparse: Batch;
  readonly dense: Batch;
  readonly bytes: number;
  private readonly eye = uniform(new Vector3());
  private readonly season = uniform(new Vector3(1, 0, 0));
  private readonly projection = new Matrix4();
  private readonly planes = new Float32Array(24);
  private readonly lastProjection = new Float64Array(16).fill(NaN);
  private readonly uv = new Float64Array(2);
  private readonly dim: number;
  private readonly far: number;
  private readonly near: number;
  private readonly ranks: Float32Array;
  private readonly heap: Uint16Array;

  private constructor(atlas: DataTexture, height: DataTexture, water: DataTexture, private readonly terrain: TerrainTextureData,
    high: boolean, wind: GrassWindUniforms, shadows: boolean) {
    this.dim = materialDim(terrain.materialStep);
    this.far = high ? 5.25 : 4.0;
    this.near = high ? 0.86 : 0.69;
    const common = { atlas, height, water, eye: this.eye, season: this.season, wind, shadows };
    this.sparse = createCrownBatch({ ...common, capacity: high ? 9000 : 6400, distance: this.far, near: false });
    this.dense = createCrownBatch({ ...common, capacity: high ? 6500 : 3400, distance: this.near, near: true });
    this.ranks = new Float32Array(this.dense.capacity);
    this.heap = new Uint16Array(this.dense.capacity);
    this.bytes = this.sparse.bytes + this.dense.bytes + (atlas.image.data?.byteLength ?? 0);
  }

  static async load(terrain: TerrainTextureData, height: DataTexture, water: DataTexture, high: boolean,
    wind: GrassWindUniforms, shadows: boolean): Promise<GroundSod> {
    return new GroundSod(await loadCrownAtlas(), height, water, terrain, high, wind, shadows);
  }

  setSeason(fresh: number, summer: number, straw: number): void {
    this.season.value.set(fresh, summer, straw);
  }

  /** @hot */
  update(ex: number, ey: number, ez: number, camera: Camera): void {
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const p = this.projection.elements;
    const eye = this.eye.value;
    let changed = eye.x !== ex || eye.y !== ey || eye.z !== ez;
    for (let i = 0; i < p.length; i++) if (p[i] !== this.lastProjection[i]) changed = true;
    if (!changed) return;
    this.lastProjection.set(p);
    eye.set(ex, ey, ez);

    const { sparse, dense, terrain } = this;
    sparse.mesh.geometry.instanceCount = 0;
    dense.mesh.geometry.instanceCount = 0;
    const x0 = Math.max(0, Math.floor((ex - this.far - 0.15 - WORLD_MIN) * 0.5));
    const x1 = Math.min(HEIGHT_DIM - 2, Math.floor((ex + this.far + 0.15 - WORLD_MIN) * 0.5));
    const z0 = Math.max(0, Math.floor((ez - this.far - 0.15 - WORLD_MIN) * 0.5));
    const z1 = Math.min(HEIGHT_DIM - 2, Math.floor((ez + this.far + 0.15 - WORLD_MIN) * 0.5));
    frustumPlanes(p, this.planes);
    const heights = terrain.height;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = z * HEIGHT_DIM + x;
        const h00 = heights[i];
        const h10 = heights[i + 1];
        const h01 = heights[i + HEIGHT_DIM];
        const h11 = heights[i + HEIGHT_DIM + 1];
        const closestY = Math.max(Math.min(h00, h10, h01, h11), Math.min(ey, Math.max(h00, h10, h01, h11)));
        if (Math.abs(closestY - ey) > this.far + 0.17) continue;
        this.triangle(x, z, 0, h00, h10 - h00, h01 - h00);
        this.triangle(x, z, 1, h11, h01 - h11, h10 - h11);
      }
    }
    if (sparse.mesh.geometry.instanceCount) sparse.instance.needsUpdate = true;
    if (dense.mesh.geometry.instanceCount) dense.instance.needsUpdate = true;
  }

  /** @hot */
  private triangle(ix: number, iz: number, upper: number, base: number, dx: number, dz: number): void {
    const seed = sodTriangleSeed(ix, iz, upper);
    const count = sodCrownCount(dx, dz);
    const prefix = Math.ceil(count / 48);
    for (let i = 0; i < prefix; i++) this.root(ix, iz, upper, base, dx, dz, seed, i, false);

    const eye = this.eye.value;
    const range = this.near + 0.36;
    // A depth-three child is at most 25 cm on each lattice axis. Skip its whole subtree when it lies outside the near band.
    for (let branch = 0; branch < SUBDIVISIONS; branch++) {
      sodBarycentric(branch, seed, this.uv, 3);
      const u = this.uv[0];
      const v = this.uv[1];
      const y = base + dx * u + dz * v;
      if (Math.abs(sodWorldAxis(ix, u, upper) - eye.x) > range
        || Math.abs(sodWorldAxis(iz, v, upper) - eye.z) > range
        || Math.abs(y - eye.y) > range + 0.125 * (Math.abs(dx) + Math.abs(dz))) continue;
      const first = branch + Math.max(0, Math.ceil((prefix - branch) / SUBDIVISIONS)) * SUBDIVISIONS;
      for (let i = first; i < count; i += SUBDIVISIONS) this.root(ix, iz, upper, base, dx, dz, seed, i, true);
    }
  }

  /** @hot */
  private root(ix: number, iz: number, upper: number, base: number, dx: number, dz: number, seed: number, i: number, near: boolean): void {
    sodBarycentric(i, seed, this.uv);
    const u = this.uv[0];
    const v = this.uv[1];
    const x = sodWorldAxis(ix, u, upper);
    const z = sodWorldAxis(iz, v, upper);
    const y = base + dx * u + dz * v;
    const eye = this.eye.value;
    const sx = x - eye.x;
    const sy = y - eye.y;
    const sz = z - eye.z;
    const d2 = sx * sx + sy * sy + sz * sz;
    const reach = (near ? this.near : this.far) + 0.06;
    if (d2 >= reach * reach || y <= 0.08 || !this.visible(sx, sy, sz) || !this.meadow(x, z)) return;
    const batch = near ? this.dense : this.sparse;
    const geometry = batch.mesh.geometry;
    let at = geometry.instanceCount;
    if (at === batch.capacity) {
      if (!near) return;
      at = this.heap[0];
      if (d2 >= this.ranks[at]) return;
      this.replaceDense(at, d2);
    } else {
      geometry.instanceCount++;
      if (near) this.insertDense(at, d2);
    }
    const key = sodHash(seed ^ Math.imul(i, 0x9e3779b1));
    const offset = at * 4;
    batch.roots[offset] = x;
    batch.roots[offset + 1] = z;
    batch.roots[offset + 2] = key * PHASE;
    batch.roots[offset + 3] = (key >>> 12) % CROWN_VARIANTS;
  }

  // Keep the nearest crowns when the physical mesh budget fills, without moving the instance data.
  /** @hot */
  private insertDense(at: number, d2: number): void {
    const { heap, ranks } = this;
    ranks[at] = d2;
    let item = at;
    while (item > 0) {
      const parent = (item - 1) >> 1;
      if (ranks[heap[parent]] >= d2) break;
      heap[item] = heap[parent];
      item = parent;
    }
    heap[item] = at;
  }

  /** @hot */
  private replaceDense(at: number, d2: number): void {
    const { heap, ranks } = this;
    const count = this.dense.mesh.geometry.instanceCount;
    ranks[at] = d2;
    let item = 0;
    for (let child = 1; child < count; child = item * 2 + 1) {
      if (child + 1 < count && ranks[heap[child + 1]] > ranks[heap[child]]) child++;
      if (ranks[heap[child]] <= d2) break;
      heap[item] = heap[child];
      item = child;
    }
    heap[item] = at;
  }

  /** @hot */
  private visible(x: number, y: number, z: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * (y + 0.045) + p[i + 2] * z + p[i + 3] < -0.13) return false;
    }
    return true;
  }

  /** @hot */
  private meadow(x: number, z: number): boolean {
    const veg = this.terrain.masks?.vegetation;
    if (!veg) return false;
    const step = this.terrain.materialStep * 2;
    const i = Math.min(this.dim - 1, Math.round((x - WORLD_MIN) / step));
    const j = Math.min(this.dim - 1, Math.round((z - WORLD_MIN) / step));
    const at = (i + j * this.dim) * 4;
    return veg[at] + veg[at + 1] >= 123 && veg[at + 3] < 130;
  }
}
