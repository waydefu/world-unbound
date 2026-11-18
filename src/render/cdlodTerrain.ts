import {
  BufferAttribute, type Camera, FrontSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4,
  Mesh, MeshBasicNodeMaterial, type MeshStandardNodeMaterial, Vector3, type DataTexture,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import { CdlodSelector, MAX_CASCADES, MAX_NODES, frustumPlanes } from '../world/cdlod';
import { LEVELS, PATCH } from '../world/cdlodPyramid';
import { createCdlodShaders } from './cdlodShader';
import type { CascadeCamera } from './shadows';
import { createTerrainMaterial, type TerrainMaterial } from './terrainMaterial';
import type { TerrainTextures } from './terrainTextures';

/** Triangles in one node patch. */
export const PATCH_TRIANGLES = PATCH * PATCH * 2;
/**
 * Layers that only the shadow cameras see: cascade c's caster mesh lives on layer 1 + c, so it is drawn into that
 * cascade's shadow map and never into the main view (attachSunShadows enables the layers on the sun's shadow camera;
 * `setCascadeCameras` narrows each cascade camera to its own).
 */
export const SHADOW_ONLY_LAYER = 1;
/** Casters are culled against each cascade's light frustum pushed outwards by this many metres (the matrices are a frame old). */
const CASCADE_MARGIN = 24;

/** The 33 x 33 vertex grid patch every node is drawn with: uv in [0, 1] in the x and z slots, 16-bit indices. */
function buildPatch(): { position: BufferAttribute; index: BufferAttribute } {
  const side = PATCH + 1;
  const position = new Float32Array(side * side * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      position[(j * side + i) * 3] = i / PATCH;
      position[(j * side + i) * 3 + 2] = j / PATCH;
    }
  }
  const indices = new Uint16Array(PATCH * PATCH * 6);
  let k = 0;
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const v00 = j * side + i;
      const v01 = v00 + side;
      // Same winding and diagonal as the chunk path and heightField.interpolateCell.
      indices[k++] = v00; indices[k++] = v01; indices[k++] = v00 + 1;
      indices[k++] = v00 + 1; indices[k++] = v01; indices[k++] = v01 + 1;
    }
  }
  return { position: new BufferAttribute(position, 3), index: new BufferAttribute(indices, 1) };
}

/** An instanced draw of the patch whose instance attributes alias the selector's arrays. */
function instancedPatch(
  patch: { position: BufferAttribute; index: BufferAttribute }, nodes: Float32Array, edges: Float32Array,
): Buffers {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', patch.position);
  geometry.setIndex(patch.index);
  const info = new InstancedBufferAttribute(nodes, 4);
  const edge = new InstancedBufferAttribute(edges, 1);
  // Static usage: the GPU copy (20 KB at most) is rewritten only when `needsUpdate` is raised, i.e. when the
  // selection changed. No update ranges: three clears them after each use.
  geometry.setAttribute('nodeInfo', info);
  geometry.setAttribute('nodeEdge', edge);
  geometry.instanceCount = 0;
  return { geometry, info, edge };
}

export interface CdlodOptions {
  readonly textures: TerrainTextures;
  readonly pyramid: Float32Array;
  readonly noise: DataTexture;
  readonly lod0Distance: number;
  /** Shadow casters are the nodes within this distance of the eye (the tier's CSM maxFar). */
  readonly shadowFar: number;
  /** Shadow cascades the tier renders; 0 when shadows are off (no caster meshes). */
  readonly cascades: number;
  readonly lite: boolean;
}

/**
 * CDLOD terrain (ADR-0003): the whole 4 km world as a quadtree of identical grid patches, drawn with one
 * instanced draw, displaced and morphed in the vertex shader from the height texture. Nodes are selected on the
 * CPU each frame the eye or the frustum changes (a few hundred nodes, world/cdlod.ts), culled per node, and
 * written straight into the instance buffers. A second instanced draw on a shadow-only layer carries the
 * casters: nodes near the eye, no frustum test. Positions are absolute world coordinates; `root` is moved by
 * -eye each frame like the chunk root.
 */
export class CdlodTerrain {
  readonly root = new Group();
  readonly material: MeshStandardNodeMaterial;
  readonly selector: CdlodSelector;
  private readonly terrainMaterial: TerrainMaterial;
  private readonly mesh: Mesh;
  private readonly mainBuffers: Buffers;
  private readonly casterBuffers: Buffers[] = [];
  private readonly eye = uniform(new Vector3());
  private readonly viewProjection = new Matrix4();
  private readonly planes = new Float32Array(24);
  private readonly cascadePlanes = new Float32Array(24);
  private masksSet = false;
  /** Bytes of the patch and instance buffers (GPU copy; the CPU arrays are retained too). */
  readonly bufferBytes: number;

  constructor(options: CdlodOptions) {
    const { textures, pyramid, noise, lod0Distance, shadowFar, lite } = options;
    this.selector = new CdlodSelector(pyramid, lod0Distance, shadowFar);
    const shaders = createCdlodShaders(textures.height, this.eye, uniform(lod0Distance));
    this.terrainMaterial = createTerrainMaterial(noise, lite, {
      material: textures.material,
      normal: textures.normal,
      materialDim: textures.materialDim,
      materialStep: textures.materialStep,
      vegetation: textures.vegetation,
      wetness: textures.wetness,
    });
    this.material = this.terrainMaterial.material;
    this.material.positionNode = shaders.position;

    const patch = buildPatch();
    this.mainBuffers = instancedPatch(patch, this.selector.nodes, this.selector.edges);
    this.mesh = new Mesh(this.mainBuffers.geometry, this.material);
    this.mesh.name = 'cdlod-terrain';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.root.name = 'terrain-root';
    this.root.add(this.mesh);

    // Shadow casters: one instanced draw per cascade on its own shadow-only layer (invisible to the main camera).
    const cascades = Math.min(options.cascades, MAX_CASCADES);
    if (cascades > 0) {
      const casterMaterial = new MeshBasicNodeMaterial({ side: FrontSide });
      casterMaterial.name = 'cdlod-terrain-shadow';
      casterMaterial.colorWrite = false;
      casterMaterial.positionNode = shaders.position;
      for (let c = 0; c < cascades; c++) {
        const buffers = instancedPatch(patch, this.selector.cascadeNodes[c], this.selector.cascadeEdges[c]);
        const caster = new Mesh(buffers.geometry, casterMaterial);
        caster.name = `cdlod-terrain-casters-${c}`;
        caster.frustumCulled = false;
        caster.castShadow = true;
        caster.receiveShadow = false;
        caster.layers.set(SHADOW_ONLY_LAYER + c);
        this.casterBuffers.push(buffers);
        this.root.add(caster);
      }
    }
    // Shared patch once, plus the instance buffers (info vec4 + edge float per node) of the main list and each cascade.
    this.bufferBytes = patch.position.array.byteLength + patch.index.array.byteLength + (1 + cascades) * MAX_NODES * 5 * 4;
  }

  /** Accounts the patch and instance buffers (the textures are accounted by the app). */
  account(memory: MemoryRegistry): void {
    memory.add(MemoryPartition.Gpu, this.bufferBytes);
    memory.add(MemoryPartition.CpuRetained, this.bufferBytes);
  }

  /** @hot writes an existing uniform only */
  setEyeOffset(x: number, y: number, z: number): void {
    this.eye.value.set(x, y, z);
    this.terrainMaterial.setEyeOffset(x, y, z);
  }

  setWetness(wetness: number): void {
    this.terrainMaterial.setWetness(wetness);
  }

  setSeason(fresh: number, summer: number, straw: number): void {
    this.terrainMaterial.setSeason(fresh, summer, straw);
  }

  /**
   * Selects the nodes for the eye and the camera's frustum, culls the casters per cascade against the light
   * frustums, and refreshes the instance buffers that changed. The matrices must be current (the app updates the
   * camera before calling; the cascade cameras are those of the last rendered frame).
   * @hot
   */
  update(ex: number, ey: number, ez: number, camera: Camera, cascades: readonly CascadeCamera[]): void {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustumPlanes(this.viewProjection.elements, this.planes);
    const sel = this.selector;
    sel.select(ex, ey, ez, this.planes);
    if (sel.nodesChanged) publish(this.mainBuffers, sel.count);
    for (let c = 0; c < this.casterBuffers.length; c++) {
      let planes: Float32Array | null = null;
      if (c < cascades.length) {
        const light = cascades[c];
        if (!this.masksSet) light.layers.mask = 1 | (2 << c);
        this.viewProjection.multiplyMatrices(light.projectionMatrix, light.matrixWorldInverse);
        planes = frustumPlanes(this.viewProjection.elements, this.cascadePlanes);
        for (let p = 3; p < 24; p += 4) planes[p] += CASCADE_MARGIN;
      }
      sel.cullCascade(c, ex, ey, ez, planes);
      if (sel.cascadeChanged[c] === 1) publish(this.casterBuffers[c], sel.cascadeCount[c]);
    }
    if (cascades.length >= this.casterBuffers.length) this.masksSet = true;
  }

  /** Triangles drawn by the main pass (instances x patch). */
  get mainTriangles(): number {
    return this.selector.count * PATCH_TRIANGLES;
  }

  /** Triangles drawn into shadow cascade `c` (its casters inside the light frustum). */
  casterTriangles(c: number): number {
    return this.selector.cascadeCount[c] * PATCH_TRIANGLES;
  }

  get levelCount(): number {
    return LEVELS;
  }
}

interface Buffers {
  geometry: InstancedBufferGeometry;
  info: InstancedBufferAttribute;
  edge: InstancedBufferAttribute;
}

/** Draws the first `count` nodes and schedules the buffers for upload. @hot */
function publish(buffers: Buffers, count: number): void {
  buffers.geometry.instanceCount = count;
  buffers.info.needsUpdate = true;
  buffers.edge.needsUpdate = true;
}
