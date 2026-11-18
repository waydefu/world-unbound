import type { Camera, DataTexture, Mesh, PerspectiveCamera } from 'three/webgpu';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import type { SlidingRate } from '../perf/slidingRate';
import { createChunkTelemetry, sampleChunkStats, type FrustumSource } from '../render/chunkStats';
import { FarTerrain } from '../render/farTerrain';
import { TerrainChunks } from '../render/terrainChunks';
import type { ResolvedCamera } from './cameras';
import type { QualityTier } from './quality';
import type { AppState } from './report';
import type { TerrainBackend } from './terrainBackend';
import type { TerrainClient } from './terrainClient';
import { TerrainStreamer } from './terrainStreamer';

/** The original terrain path (`?terrain=chunks`): worker-built chunk meshes, streamed around the camera, plus the far skin. */
export class ChunkBackend implements TerrainBackend {
  readonly mode = 'chunks' as const;
  readonly chunks: TerrainChunks;
  private readonly far: FarTerrain;
  private readonly streamer: TerrainStreamer;
  private readonly telemetry = createChunkTelemetry();

  constructor(memory: MemoryRegistry, noise: DataTexture, floor: DataTexture, tier: QualityTier, uploads: SlidingRate) {
    const lite = tier.name === 'low';
    this.chunks = new TerrainChunks(memory, noise, tier.shadows.maxFar, lite);
    this.chunks.uploads = uploads;
    this.far = new FarTerrain(floor, noise, tier.lod.viewRadius, lite);
    memory.add(MemoryPartition.Gpu, this.far.gpuBytes);
    this.chunks.root.add(this.far.mesh);
    this.streamer = new TerrainStreamer(this.chunks, memory, tier.lod);
  }

  get root(): TerrainChunks['root'] {
    return this.chunks.root;
  }

  get client(): TerrainClient {
    return this.streamer.client;
  }

  get settled(): boolean {
    return this.streamer.settled;
  }

  get farMesh(): Mesh {
    return this.far.mesh;
  }

  get mainTriangles(): number {
    return this.chunks.residentTriangles;
  }

  get bundledDraws(): number {
    return this.chunks.bundledCount;
  }

  attachSun(): void {}

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  prime(x: number, z: number): void {
    this.streamer.prime(x, z);
  }

  invalidate(): void {
    this.streamer.invalidate();
  }

  /** @hot */
  update(now: number, eye: ResolvedCamera, _camera: PerspectiveCamera): void {
    this.streamer.update(now, eye.x, eye.z, 0, 0);
  }

  /** @hot */
  setEyeOffset(x: number, y: number, z: number): void {
    this.chunks.setEyeOffset(x, y, z);
    this.far.setEyeOffset(x, y, z);
  }

  setWetness(wetness: number): void {
    this.chunks.setWetness(wetness);
  }

  setBundled(bundled: boolean): void {
    this.chunks.setBundled(bundled);
  }

  seaFloorReady(): void {
    this.far.setReady();
  }

  /** @amortized scans the chunk table once per telemetry tick */
  sample(state: AppState, camera: Camera, cascades: readonly FrustumSource[]): void {
    const { streamer, chunks, telemetry: t } = this;
    chunks.rebalanceCasters();
    sampleChunkStats(chunks, camera, cascades, t);
    state.terrainRender = 'chunks';
    state.residentChunks = t.visible + t.culled;
    state.visibleChunks = t.visible;
    state.culledChunks = t.culled;
    state.shadowCasterChunks = t.casters;
    state.shadowCascades = t.cascades;
    for (let c = 0; c < t.cascades; c++) state.trisShadow[c] = t.shadowTriangles[c];
    state.chunksLoaded = streamer.requests.loadedCount;
    state.chunksInFlight = streamer.requests.inFlightCount;
    state.staleResults = streamer.requests.staleResults;
    state.lodBias = streamer.lodBias;
    state.terrainMode = streamer.client.mode;
    state.terrainWorkerLoadMs = streamer.client.workerLoadMs;
    state.workerQueued = streamer.requests.queuedCount();
    state.buildP50Ms = streamer.buildMs.percentile(0.5);
    state.buildP95Ms = streamer.buildMs.percentile(0.95);
    state.buildSamples = streamer.buildMs.count;
  }
}
