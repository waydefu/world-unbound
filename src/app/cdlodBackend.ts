import { type Camera, type DataTexture, type DirectionalLight, Group, type Mesh, type PerspectiveCamera } from 'three/webgpu';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import type { SlidingRate } from '../perf/slidingRate';
import type { FrustumSource } from '../render/chunkStats';
import { CdlodTerrain } from '../render/cdlodTerrain';
import { createGrassCoverTexture } from '../render/noiseTextures';
import { cascadeCameras, type CascadeCamera } from '../render/shadows';
import { createTerrainTextures, type TerrainTextures } from '../render/terrainTextures';
import { LEVELS } from '../world/cdlodPyramid';
import type { MaterialStep, TerrainTextureData } from '../world/terrainTextures';
import type { ResolvedCamera } from './cameras';
import type { QualityTier } from './quality';
import type { AppState } from './report';
import type { TerrainBackend } from './terrainBackend';
import { TerrainClient } from './terrainClient';

/**
 * GPU height texture + CDLOD (ADR-0003, the default). The worker builds the textures while the renderer starts;
 * `prepare()` waits for them, then the terrain exists and every frame only selects nodes. The streamer, the chunk
 * meshes and the far skin are not used: the root node covers the whole world.
 */
export class CdlodBackend implements TerrainBackend {
  readonly mode = 'cdlod' as const;
  readonly root = new Group();
  readonly client = new TerrainClient();
  readonly farMesh: Mesh | null = null;
  private terrain: CdlodTerrain | null = null;
  private readonly textures: Promise<TerrainTextureData>;
  private texturesMs = 0;
  private masksMs = 0;
  /** The baked data the vegetation layer reads on the CPU (null before `prepare`). */
  data: TerrainTextureData | null = null;
  gpu: TerrainTextures | null = null;
  private season = [1, 0, 0];
  private updates = 0;
  private wetness = 0;
  private sun: DirectionalLight | null = null;
  private cascadeCams: readonly CascadeCamera[] = [];

  constructor(
    private readonly memory: MemoryRegistry,
    private readonly noise: DataTexture,
    private readonly tier: QualityTier,
    private readonly uploads: SlidingRate,
    /** Shadow cascades to cull casters for; 0 when shadows are off. */
    private readonly cascades: number,
  ) {
    this.root.name = 'terrain-root';
    // The low tier keeps the material texture at 4 m texels (1025 squared): a quarter of the memory.
    const step: MaterialStep = tier.name === 'low' ? 2 : 1;
    this.textures = this.client.requestTextures(step);
  }

  get settled(): boolean {
    return this.terrain !== null && this.updates > 0;
  }

  get mainTriangles(): number {
    return this.terrain?.mainTriangles ?? 0;
  }

  get bundledDraws(): number {
    return 0;
  }

  /**
   * Uploads the worker's textures and builds the terrain.
   * @amortized once at start-up
   */
  async prepare(): Promise<void> {
    const data = await this.textures;
    const textures = createTerrainTextures(data);
    this.data = data;
    this.gpu = textures;
    this.texturesMs = data.ms;
    this.masksMs = data.masks?.ms ?? 0;
    const { memory } = this;
    memory.add(MemoryPartition.Gpu, textures.heightBytes + textures.materialBytes + textures.normalBytes + textures.vegetationBytes);
    // three.js keeps the CPU arrays so a device loss can re-upload. The wind channel stays too (wind texture refresh).
    const masks = data.masks;
    memory.add(MemoryPartition.CpuRetained, data.height.byteLength + data.material.byteLength + data.normal.byteLength + data.pyramid.byteLength
      + (masks ? masks.vegetation.byteLength + masks.wetness.byteLength + masks.windChannel.byteLength + masks.openness.byteLength : 0));
    this.uploads.add(performance.now(), textures.uploadBytes + textures.normalUploadBytes + textures.vegetationUploadBytes);
    const lite = this.tier.name === 'low';
    const grassCover = lite ? null : createGrassCoverTexture();
    if (grassCover) {
      memory.add(MemoryPartition.Gpu, grassCover.gpuBytes);
      memory.add(MemoryPartition.CpuRetained, grassCover.uploadBytes);
      this.uploads.add(performance.now(), grassCover.uploadBytes);
    }
    const terrain = new CdlodTerrain({
      textures,
      pyramid: data.pyramid,
      noise: this.noise,
      lod0Distance: this.tier.lod.lod0Distance,
      shadowFar: this.tier.shadows.maxFar,
      cascades: this.cascades,
      lite,
      grassCover: grassCover?.texture ?? null,
    });
    terrain.account(memory);
    this.root.add(terrain.root);
    terrain.setWetness(this.wetness);
    terrain.setSeason(this.season[0], this.season[1], this.season[2]);
    this.terrain = terrain;
  }

  attachSun(sun: DirectionalLight): void {
    this.sun = sun;
  }

  prime(): void {}

  invalidate(): void {}

  /** @hot */
  update(_now: number, eye: ResolvedCamera, camera: PerspectiveCamera): void {
    const terrain = this.terrain;
    if (terrain === null) return;
    camera.updateMatrixWorld();
    // The cascade light cameras exist after the first shadowed frame; look for them until they do.
    if (this.cascadeCams.length === 0 && this.sun !== null && (this.updates & 15) === 0) this.cascadeCams = cascadeCameras(this.sun);
    terrain.update(eye.x, eye.y, eye.z, camera, this.cascadeCams);
    this.updates++;
  }

  /** @hot */
  setEyeOffset(x: number, y: number, z: number): void {
    this.terrain?.setEyeOffset(x, y, z);
  }

  setWetness(wetness: number): void {
    this.terrain?.setWetness(wetness);
    this.wetness = wetness;
  }

  /** Season weights of the grass colour (fresh, summer, straw). */
  setSeason(fresh: number, summer: number, straw: number): void {
    this.season = [fresh, summer, straw];
    this.terrain?.setSeason(fresh, summer, straw);
  }

  /** Grass reach in metres (0 = none): the ground is shaded between the blades out to there. */
  setGrassRange(midM: number): void {
    this.terrain?.setGrassRange(midM);
  }

  setBundled(): void {}

  seaFloorReady(): void {}

  /** @amortized once per telemetry tick */
  sample(state: AppState, _camera: Camera, cascades: readonly FrustumSource[]): void {
    const sel = this.terrain?.selector;
    state.terrainRender = 'cdlod';
    state.terrainTexturesMs = this.texturesMs;
    state.terrainMasksMs = this.masksMs;
    state.terrainMode = this.client.mode;
    state.terrainWorkerLoadMs = this.client.workerLoadMs;
    if (!sel || !this.terrain) return;
    state.nodesSelected = sel.count;
    state.nodesCulled = sel.culled;
    for (let level = 0; level < LEVELS; level++) state.nodesPerLevel[level] = sel.perLevel[level];
    state.shadowCasterNodes = sel.casterCount;
    // Triangles per cascade: its casters inside the light frustum times the patch (instances are not culled further).
    state.shadowCascades = Math.min(cascades.length, state.trisShadow.length);
    for (let c = 0; c < state.shadowCascades; c++) state.trisShadow[c] = this.terrain.casterTriangles(c);
    // The visual audit's "terrain is resident" check reads chunksLoaded: here it counts the drawn nodes.
    state.chunksLoaded = sel.count;
    state.chunksInFlight = 0;
  }
}
