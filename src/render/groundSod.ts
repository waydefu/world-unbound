import { BufferAttribute, BufferGeometry, type Camera, DynamicDrawUsage, InstancedMesh, Matrix4, type Node, type UniformNode, Vector3 } from 'three/webgpu';
import { float, length, mix, normalViewGeometry, normalize, positionGeometry, positionLocal, smoothstep, transformNormalToView, uniform, vec2, vec3 } from 'three/tsl';
import { frustumPlanes } from '../world/cdlodMath';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { interpolateCell } from '../world/heightField';
import { HEIGHT_DIM, materialDim, type TerrainTextureData } from '../world/terrainTextures';
import { createSodLeafMaterial, loadSodPatch } from './fullSod';
import { grassCarpetColour } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';

export const SOD_PATCH_M = 0.25;
const HALF_PATCH_M = SOD_PATCH_M * 0.5;
const INDICES_PER_LEAF = 66;
const LEAF_STEP = 32;

function separateLeaves(source: BufferGeometry, leaves: number, sparse: boolean): BufferGeometry {
  const src = source.index?.array;
  if (!src) throw new Error('Sod leaves require indexed geometry');
  const count = Math.ceil(leaves / LEAF_STEP);
  const indices = new Uint32Array((sparse ? count : leaves - count) * INDICES_PER_LEAF);
  let at = 0;
  for (let leaf = 0; leaf < leaves; leaf++) {
    // One leaf from each spatial group of 32, with a stable varied offset across neighbouring groups.
    const group = Math.floor(leaf / LEAF_STEP);
    const kept = leaf % LEAF_STEP === (group * 13) % Math.min(LEAF_STEP, leaves - group * LEAF_STEP);
    if (kept !== sparse) continue;
    const begin = leaf * INDICES_PER_LEAF;
    indices.set(src.subarray(begin, begin + INDICES_PER_LEAF), at);
    at += INDICES_PER_LEAF;
  }
  const geom = new BufferGeometry();
  for (const attribute of ['position', 'normal', 'color']) geom.setAttribute(attribute, source.getAttribute(attribute));
  geom.setIndex(new BufferAttribute(indices, 1));
  return geom;
}

function createSodBatch(
  geometry: BufferGeometry, capacity: number, distance: number, eye: UniformNode<'vec3', Vector3>,
  season: UniformNode<'vec3', Vector3>, wind: GrassWindUniforms, shadows: boolean, sparse: boolean,
) {
  const material = createSodLeafMaterial(1.24);
  material.specularIntensity = 0;
  material.thicknessAttenuationNode = float(sparse ? 0.045 : 0.16);
  const fade = float(1).sub(smoothstep(distance * (sparse ? 0.57 : 0.62), distance, length(positionLocal.sub(eye))));
  const height = positionGeometry.y;
  const gust = grassGust(positionLocal.xz, float(0.53), wind);
  const flex = height.max(0).pow(2).mul(gust.mul(1.8).add(0.25)).mul(wind.wind.z.min(8)).mul(fade);
  const sway = vec2(wind.wind.x, wind.wind.y).mul(flex);
  material.positionNode = positionLocal.add(vec3(sway.x, height.mul(fade.sub(1)).sub(fade.oneMinus().mul(0.020)), sway.y));
  const colour = material.colorNode as Node<'vec3'> | null;
  if (colour) material.colorNode = mix(colour, grassCarpetColour(season), sparse ? 0.56 : 0.63);
  // The canopy underneath supplies its light at distance. Bring the leaves' light toward that surface
  // as they become subpixel, and keep the bent surfaces readable at arm's length.
  material.normalNode = normalize(mix(normalViewGeometry, transformNormalToView(vec3(0, 1, 0)), sparse ? 0.81 : 0.62));
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = sparse ? 'terrain-sod-leaves' : 'terrain-sod-near-leaves';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = shadows;
  mesh.count = 0;
  return { mesh, limit: capacity, triangles: (geometry.index?.count ?? 0) / 3 };
}

/** Ground-fixed master foliage. The sparse set persists through both distance bands to avoid visible rings. */
export class GroundSod {
  readonly sparse;
  readonly dense;
  readonly bytes: number;
  private readonly eye = uniform(new Vector3());
  private readonly season = uniform(new Vector3(1, 0, 0));
  private readonly matrix = new Matrix4();
  private readonly projection = new Matrix4();
  private readonly planes = new Float32Array(24);
  private readonly lastProjection = new Float64Array(16);
  private readonly dim: number;
  private readonly far: number;
  private readonly near: number;
  private readonly denseRanks: Float32Array;

  private constructor(patch: Awaited<ReturnType<typeof loadSodPatch>>, private readonly terrain: TerrainTextureData,
    high: boolean, wind: GrassWindUniforms, shadows: boolean) {
    this.dim = materialDim(terrain.materialStep);
    this.far = high ? 5.25 : 4.0;
    this.near = high ? 0.86 : 0.69;
    this.sparse = createSodBatch(separateLeaves(patch.geometry, patch.leaves, true), high ? 400 : 256,
      this.far, this.eye, this.season, wind, shadows, true);
    this.dense = createSodBatch(separateLeaves(patch.geometry, patch.leaves, false), high ? 14 : 5,
      this.near, this.eye, this.season, wind, shadows, false);
    this.lastProjection.fill(NaN);
    this.denseRanks = new Float32Array(this.dense.limit);
    this.bytes = patch.bytes + this.sparse.mesh.instanceMatrix.array.byteLength + this.dense.mesh.instanceMatrix.array.byteLength;
  }

  static async load(terrain: TerrainTextureData, high: boolean, wind: GrassWindUniforms, shadows: boolean): Promise<GroundSod> {
    return new GroundSod(await loadSodPatch(), terrain, high, wind, shadows);
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

    const sparse = this.sparse;
    const dense = this.dense;
    sparse.mesh.count = 0;
    dense.mesh.count = 0;
    if (ey - this.groundY(ex, ez) > this.far + 1.5) return;
    frustumPlanes(p, this.planes);
    const far2 = (this.far + HALF_PATCH_M) ** 2;
    const near2 = (this.near + HALF_PATCH_M) ** 2;
    const xmin = Math.floor((ex - this.far) / SOD_PATCH_M);
    const xmax = Math.floor((ex + this.far) / SOD_PATCH_M);
    const zmin = Math.floor((ez - this.far) / SOD_PATCH_M);
    const zmax = Math.floor((ez + this.far) / SOD_PATCH_M);
    for (let iz = zmin; iz <= zmax; iz++) {
      for (let ix = xmin; ix <= xmax; ix++) {
        const x = (ix + 0.5) * SOD_PATCH_M;
        const z = (iz + 0.5) * SOD_PATCH_M;
        const xz2 = (x - ex) ** 2 + (z - ez) ** 2;
        if (xz2 >= far2 || !this.meadow(x, z)) continue;
        const y = this.groundY(x, z);
        const distance2 = xz2 + (y - ey) ** 2;
        if (y < 0.65 || distance2 > far2 || !this.visible(x - ex, y - ey, z - ez)) continue;
        const dx = (this.groundY(x + 0.08, z) - this.groundY(x - 0.08, z)) / 0.16;
        const dz = (this.groundY(x, z + 0.08) - this.groundY(x, z - 0.08)) / 0.16;
        if (dx * dx + dz * dz > 0.61) continue;
        this.matrix.set(1, 0, 0, x, dx, 1, dz, y - 0.002, 0, 0, 1, z, 0, 0, 0, 1);
        if (sparse.mesh.count < sparse.limit) sparse.mesh.setMatrixAt(sparse.mesh.count++, this.matrix);
        if (distance2 <= near2) this.addDense(distance2);
      }
    }
    if (sparse.mesh.count) sparse.mesh.instanceMatrix.needsUpdate = true;
    if (dense.mesh.count) dense.mesh.instanceMatrix.needsUpdate = true;
  }

  /** @hot */
  private addDense(distance2: number): void {
    const { mesh, limit } = this.dense;
    if (mesh.count < limit) {
      this.denseRanks[mesh.count] = distance2;
      mesh.setMatrixAt(mesh.count++, this.matrix);
      return;
    }
    let farthest = 0;
    for (let i = 1; i < limit; i++) if (this.denseRanks[i] > this.denseRanks[farthest]) farthest = i;
    if (distance2 >= this.denseRanks[farthest]) return;
    this.denseRanks[farthest] = distance2;
    mesh.setMatrixAt(farthest, this.matrix);
  }

  /** @hot */
  private visible(x: number, y: number, z: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * (y + 0.04) + p[i + 2] * z + p[i + 3] < -0.30) return false;
    }
    return true;
  }

  /** @hot */
  private meadow(x: number, z: number): boolean {
    const veg = this.terrain.masks?.vegetation;
    if (!veg || x < WORLD_MIN || z < WORLD_MIN || x >= WORLD_MAX || z >= WORLD_MAX) return false;
    const m = this.terrain.materialStep * 2;
    const i = Math.min(this.dim - 1, Math.round((x - WORLD_MIN) / m));
    const j = Math.min(this.dim - 1, Math.round((z - WORLD_MIN) / m));
    const at = (i + j * this.dim) * 4;
    return veg[at] + veg[at + 1] * 0.6 > 116 && veg[at + 3] < 90;
  }

  /** @hot */
  private groundY(x: number, z: number): number {
    const gx = Math.min(HEIGHT_DIM - 1, Math.max(0, (x - WORLD_MIN) * 0.5));
    const gz = Math.min(HEIGHT_DIM - 1, Math.max(0, (z - WORLD_MIN) * 0.5));
    const i = Math.min(HEIGHT_DIM - 2, Math.floor(gx));
    const j = Math.min(HEIGHT_DIM - 2, Math.floor(gz));
    const at = i + j * HEIGHT_DIM;
    const h = this.terrain.height;
    return interpolateCell(h[at], h[at + 1], h[at + HEIGHT_DIM], h[at + HEIGHT_DIM + 1], gx - i, gz - j);
  }
}
