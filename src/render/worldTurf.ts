import {
  DynamicDrawUsage, IndirectStorageBufferAttribute, InstancedBufferAttribute, Matrix4, type PerspectiveCamera, Vector2,
  StorageBufferAttribute, Vector3, Vector4, type Group, type Mesh, type UniformNode,
} from 'three/webgpu';
import { atomicAdd, atomicStore, attribute, dot, floor, Fn, If, instanceIndex, length, mix, storage, uint, uniform, uniformArray } from 'three/tsl';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import { frustumPlanes } from '../world/cdlodMath';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { SOD_LEAVES_PER_CROWN } from '../world/sodRoots';
import { HEIGHT_DIM, type TerrainTextureData } from '../world/terrainTextures';
import { collectTurfMasterReference, collectTurfRoots, TURF_CROWN_PADDING_M, TURF_CROWN_SPACING_M,
  TURF_DETAIL_BLEND, TURF_NATIVE_FADE_END_M, TURF_NATIVE_FADE_START_M, TURF_PROXY_CROWN_DIVISOR,
  turfDetailStart, turfEligible, turfVisible, type TurfBenchmark, type TurfTrial } from '../world/turfPopulation';
import type { RendererHandle } from './renderer';
import { TURF_REDUCED_TRIANGLES_PER_LEAF, worldTurfGeometry, worldTurfMesh, type TurfMeshOptions } from './worldTurfMesh';
import type { WorldTurfMetrics } from './worldTurfMetrics';

const CAPACITY = 524_288;
const TRIAL_CAPACITY = 131_072;
const WORKGROUP = 64;
const WINDOW_SLACK = .44;
const WINDOW_TURN = Math.cos(10 * Math.PI / 180);

interface GpuRoots {
  input: StorageBufferAttribute;
  args: IndirectStorageBufferAttribute;
  run(count: number): void;
}

interface TurfBatch {
  candidates: Float32Array;
  mesh: Mesh;
  instance: InstancedBufferAttribute | null;
  gpu: GpuRoots | null;
  cpuBytes: number;
  gpuBytes: number;
  count: number;
}

export class WorldTurf {
  readonly eye = uniform(new Vector3());
  readonly season: UniformNode<'vec3', Vector3> = uniform(new Vector3(1, 0, 0));
  readonly sunDir = uniform(new Vector3(0, 1, 0));
  readonly sunColour = uniform(new Vector3(1, 1, 1));
  readonly detailReach = uniform(new Vector2());
  private readonly reach = uniform(1);
  private readonly drawLimit = uniform(1);
  private readonly batches: TurfBatch[] = [];
  private handle: RendererHandle | null = null;
  private readonly uv = new Float64Array(2);
  private readonly planes = new Float32Array(24);
  private readonly vectors = Array.from({ length: 6 }, () => new Vector4());
  private readonly planeNodes = uniformArray<'vec4'>(this.vectors, 'vec4');
  private readonly projection = new Matrix4();
  private readonly lastProjection = new Float64Array(16).fill(NaN);
  private readonly anchor = new Vector3(Infinity, 0, 0);
  private readonly anchorDirection = new Vector3();
  private lastReach = -1;
  private lastAspectScale = 0;
  private count = 0;
  private drawn: number | null = null;
  private selectionRevision = 0;
  private sampledRevision = -1;
  private sampling = false;
  private lastSample = -Infinity;
  private lastCountAt = -Infinity;
  private collectMs = 0;
  private selectMs = 0;
  private gpuComputeMs: number | null = null;
  private overflow = false;
  private readonly capacity: number;
  readonly crownDivisor: number;

  constructor(private readonly root: Group, private readonly terrain: TerrainTextureData,
    private readonly options: Omit<TurfMeshOptions, 'eye' | 'season' | 'reach' | 'reference' | 'unfaded'>,
    private readonly reference: { readonly x: number; readonly z: number; readonly origins: Float32Array } | null,
    private readonly diagnostic: boolean, private readonly benchmark: TurfBenchmark | null, private readonly memory: MemoryRegistry,
    private readonly trial: TurfTrial | null = null, private readonly folded = false,
    private readonly experiment?: { readonly drawOff: boolean; readonly earlyCull: boolean }) {
    this.capacity = trial === 'canopy' || (trial !== null && !folded) ? TRIAL_CAPACITY : CAPACITY;
    this.crownDivisor = trial === 'canopy' && folded ? TURF_PROXY_CROWN_DIVISOR : 1;
  }

  attach(handle: RendererHandle): void {
    for (const { mesh, cpuBytes, gpuBytes } of this.batches) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
      this.memory.remove(MemoryPartition.CpuRetained, cpuBytes);
      this.memory.remove(MemoryPartition.Gpu, gpuBytes);
    }
    this.batches.length = 0;
    this.handle = handle;
    this.drawn = null;
    this.sampledRevision = -1;
    this.gpuComputeMs = null;
    this.lastCountAt = -Infinity;
    this.lastSample = -Infinity;
    this.sampling = false;
    this.lastProjection.fill(NaN);
    this.lastReach = -1;
    this.addBatch(handle);
  }
  /** @amortized A retained batch keeps indirect dispatch within device limits while preserving every crown. */
  private addBatch(handle: RendererHandle): TurfBatch {
    const capacity = this.capacity;
    const candidates = new Float32Array(capacity * 4);
    const geometry = worldTurfGeometry(this.folded);
    const common = { ...this.options, eye: this.eye, season: this.season, reach: this.reach, sunDir: this.sunDir, sunColour: this.sunColour,
      reference: this.reference !== null, unfaded: this.reference !== null || this.benchmark !== null || (!!this.options.surfaceFrame && !!this.trial && !this.folded),
      proxyLeaf: this.trial === 'canopy' && this.folded };
    let mesh: Mesh;
    let gpu: GpuRoots | null = null;
    let instance: InstancedBufferAttribute | null = null;
    let gpuBytes: number;
    if (handle.backend === 'webgpu') {
      const input = new StorageBufferAttribute(candidates, 4).setUsage(DynamicDrawUsage);
      const source = storage(input, 'vec4', capacity).toReadOnly();
      const visible = storage(new StorageBufferAttribute(new Uint32Array(capacity), 1), 'uint', capacity);
      const args = new IndirectStorageBufferAttribute(new Uint32Array([geometry.index?.count ?? 0, 0, 0, 0, 0]), 1);
      geometry.setIndirect(args);
      geometry.instanceCount = capacity;
      const indirect = storage(args, 'uint', 5).toAtomic();
      const size = uniform(0, 'uint');
      const clear = Fn(() => { atomicStore(indirect.element(1), 0); })().compute(1).setName('World turf reset');
      const compact = Fn(() => {
        const id = instanceIndex;
        If(id.lessThan(size), () => {
          const root = source.element(id).toVar();
          const offset = root.xyz.sub(this.eye).toVar();
          const visibleRoot = uint(1).toVar();
          if (!this.reference && this.benchmark !== 'all') {
            const distance = length(offset).toVar();
            If(distance.greaterThan(this.drawLimit), () => { visibleRoot.assign(0); });
            if (this.trial) {
              const limit = mix(this.detailReach.x, this.detailReach.y, root.w.sub(floor(root.w)));
              If(this.folded ? distance.lessThan(limit) : distance.greaterThanEqual(limit), () => { visibleRoot.assign(0); });
            }
          }
          const testFrustum = () => {
            for (let plane = 0; plane < 6; plane++) {
              const p = this.planeNodes.element(plane);
              If(dot(p.xyz, offset).add(p.w).lessThan(-TURF_CROWN_PADDING_M), () => { visibleRoot.assign(0); });
            }
          };
          If(visibleRoot.equal(1), testFrustum);
          If(visibleRoot.equal(1), () => {
            const slot = atomicAdd(indirect.element(1), 1);
            visible.element(slot).assign(id);
          });
        });
      })().computeKernel([WORKGROUP]).setName('World turf frustum compact');
      gpu = {
        input, args,
        run: count => {
          size.value = count;
          handle.renderer.compute(clear);
          if (count) handle.renderer.compute(compact, [Math.ceil(count / WORKGROUP), 1, 1]);
        },
      };
      mesh = worldTurfMesh(geometry, source.element(visible.element(instanceIndex)), common);
      gpuBytes = candidates.byteLength + capacity * 4 + args.array.byteLength;
    } else {
      instance = new InstancedBufferAttribute(new Float32Array(candidates.length), 4).setUsage(DynamicDrawUsage);
      geometry.setAttribute('worldTurfRoot', instance);
      mesh = worldTurfMesh(geometry, attribute('worldTurfRoot', 'vec4'), common);
      gpuBytes = instance.array.byteLength;
    }
    const cpuBytes = gpu ? gpuBytes : candidates.byteLength + gpuBytes;
    const batch = { candidates, mesh, instance, gpu, cpuBytes, gpuBytes, count: 0 };
    this.batches.push(batch);
    this.memory.add(MemoryPartition.CpuRetained, cpuBytes);
    this.memory.add(MemoryPartition.Gpu, gpuBytes);
    mesh.visible = !this.experiment?.drawOff;
    this.root.add(mesh);
    return batch;
  }
  /** @hot Reuse the candidate window while looking around, then compact against the current view. */
  update(now: number, x: number, y: number, z: number, camera: PerspectiveCamera, bufferHeight: number): void {
    const handle = this.handle;
    if (!handle) return;
    const focal = Math.max(bufferHeight, 1) * camera.projectionMatrix.elements[5] * .5;
    const projected = focal * TURF_CROWN_SPACING_M;
    const detailStart = this.trial ? turfDetailStart(focal) : 0;
    const detailEnd = detailStart * TURF_DETAIL_BLEND;
    const reach = this.trial && !this.folded ? detailEnd : this.benchmark === 'all' ? Infinity : this.benchmark
      ?? (this.options.ribbonHandoff ? TURF_NATIVE_FADE_END_M : Math.min(3.0, Math.max(2.35, projected)));
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const p = this.projection.elements;
    const eye = this.eye.value;
    let changed = eye.x !== x || eye.y !== y || eye.z !== z || this.reach.value !== reach || this.detailReach.value.x !== detailStart;
    for (let i = 0; i < p.length; i++) if (p[i] !== this.lastProjection[i]) changed = true;
    if (changed) {
      this.lastProjection.set(p);
      eye.set(x, y, z);
      this.reach.value = reach;
      this.detailReach.value.set(detailStart, detailEnd);
      this.drawLimit.value = this.benchmark === null && !this.options.ribbonHandoff ? reach / .72 + TURF_CROWN_PADDING_M : reach;
      frustumPlanes(p, this.planes);
      const matrix = camera.matrixWorld.elements;
      const aspectScale = camera.projectionMatrix.elements[0];
      const turn = this.anchorDirection.x * matrix[8] + this.anchorDirection.y * matrix[9] + this.anchorDirection.z * matrix[10] < WINDOW_TURN;
      const grow = Math.hypot(x - this.anchor.x, y - this.anchor.y, z - this.anchor.z) > WINDOW_SLACK * .8;
      if (this.lastReach !== reach || ((!this.reference) && (grow || turn || aspectScale !== this.lastAspectScale))) {
        this.anchorDirection.set(matrix[8], matrix[9], matrix[10]);
        this.lastAspectScale = aspectScale;
        this.rebuild(handle, x, y, z, reach);
      } else this.collectMs = 0;
      this.select(x, y, z);
    }
    if (this.diagnostic && handle.backend === 'webgpu' && !this.sampling && now - this.lastSample >= 1000) this.readGpu(now, handle);
  }
  /** @amortized Rebuild only after leaving the current resident window. */
  private rebuild(handle: RendererHandle, x: number, y: number, z: number, reach: number): void {
    const start = performance.now();
    this.anchor.set(x, y, z);
    this.lastReach = reach;
    const radius = this.drawLimit.value + WINDOW_SLACK;
    const first = this.batches[0].candidates;
    let next = 1;
    const nextBatch = this.options.ribbonHandoff ? () => {
      const batch = this.batches[next] ?? this.addBatch(handle);
      next++;
      return batch.candidates;
    } : undefined;
    const count = this.reference ? collectTurfMasterReference(this.terrain, this.reference, this.reference.origins, first) : collectTurfRoots(this.terrain, {
      x, y, z, reach: radius, reference: null, hull: this.planes, crownDivisor: this.crownDivisor,
      // A plane can rotate by ten degrees before the window is rebuilt. Also cover eye translation and complete blades.
      hullMargin: this.benchmark === 'all' ? TURF_CROWN_PADDING_M : radius * .20 + WINDOW_SLACK + TURF_CROWN_PADDING_M,
    }, first, this.uv, nextBatch);
    this.overflow = count < 0;
    this.count = Math.max(0, count);
    let remaining = this.count;
    for (const batch of this.batches) {
      batch.count = Math.min(this.capacity, remaining);
      remaining -= batch.count;
      if (batch.gpu && batch.count) {
        batch.gpu.input.clearUpdateRanges();
        batch.gpu.input.addUpdateRange(0, batch.count * 4);
        batch.gpu.input.needsUpdate = true;
      }
    }
    this.collectMs = performance.now() - start;
  }
  /** @hot */
  private select(x: number, y: number, z: number): void {
    this.selectionRevision++;
    const start = performance.now();
    if (this.handle?.backend === 'webgpu') {
      for (let i = 0; i < 6; i++) this.vectors[i].fromArray(this.planes, i * 4);
      for (let b = 0; b < this.batches.length; b++) {
        const batch = this.batches[b];
        batch.mesh.visible = batch.count !== 0 && !this.experiment?.drawOff;
        if (batch.count) batch.gpu?.run(batch.count);
      }
    } else {
      const limit = this.drawLimit.value ** 2;
      const detailStart = this.detailReach.value.x;
      const detailSpan = this.detailReach.value.y - detailStart;
      this.drawn = 0;
      for (let b = 0; b < this.batches.length; b++) {
        const { mesh, instance, candidates, count } = this.batches[b];
        if (!instance) continue;
        const roots = instance.array;
        let size = 0;
        for (let i = 0; i < count * 4; i += 4) {
          const dx = candidates[i] - x, dy = candidates[i + 1] - y, dz = candidates[i + 2] - z;
          const distance2 = dx * dx + dy * dy + dz * dz;
          if ((!this.reference && distance2 > limit) || !turfVisible(this.planes, dx, dy, dz, TURF_CROWN_PADDING_M)) continue;
          if (this.trial) {
            const idAndPhase = candidates[i + 3];
            const handoff = detailStart + (idAndPhase - Math.floor(idAndPhase)) * detailSpan;
            if (this.folded !== (distance2 >= handoff * handoff)) continue;
          }
          roots[size++] = candidates[i];
          roots[size++] = candidates[i + 1];
          roots[size++] = candidates[i + 2];
          roots[size++] = candidates[i + 3];
        }
        this.drawn += size / 4;
        (mesh.geometry as ReturnType<typeof worldTurfGeometry>).instanceCount = size / 4;
        mesh.visible = size !== 0 && !this.experiment?.drawOff;
        if (size) {
          instance.clearUpdateRanges();
          instance.addUpdateRange(0, size);
          instance.needsUpdate = true;
        }
      }
    }
    this.selectMs = performance.now() - start;
  }
  /** @amortized Optional once-per-second diagnostics. */
  private readGpu(now: number, handle: RendererHandle): void {
    this.lastSample = now;
    this.sampling = true;
    const revision = this.selectionRevision;
    const { renderer } = handle;
    const counts = this.batches.flatMap(batch => batch.gpu && batch.count ? [renderer.getArrayBufferAsync(batch.gpu.args)] : []);
    void Promise.all(counts).then(results => {
      if (this.handle !== handle) return;
      this.drawn = results.reduce((sum, bytes) => sum + new Uint32Array(bytes)[1], 0);
      this.lastCountAt = performance.now();
      this.sampledRevision = revision;
    }).catch(() => undefined).finally(() => { if (this.handle === handle) this.sampling = false; });
    if (renderer.hasFeature('timestamp-query')) {
      void renderer.resolveTimestampsAsync('compute').then(ms => { if (this.handle === handle) this.gpuComputeMs = ms ?? null; }).catch(() => undefined);
    }
  }
  /** A frustum estimate from 16 m ground samples. Includes terrain that may be occluded by nearer ground. */
  private frustumArea(reach: number): number {
    const eye = this.eye.value;
    const h = this.terrain.height;
    let area = 0;
    for (let z = WORLD_MIN + 8; z < WORLD_MAX; z += 16) for (let x = WORLD_MIN + 8; x < WORLD_MAX; x += 16) {
      const i = ((z - WORLD_MIN) / 2) * HEIGHT_DIM + (x - WORLD_MIN) / 2;
      const ground = h[i];
      if (ground <= .08 || !turfEligible(this.terrain, x, z)) continue;
      const dx = x - eye.x, dy = ground - eye.y, dz = z - eye.z;
      if (dx * dx + dy * dy + dz * dz <= reach * reach || !turfVisible(this.planes, dx, dy, dz, 8)) continue;
      area += 256 * Math.hypot(1, (h[i + 1] - h[i - 1]) * .25, (h[i + HEIGHT_DIM] - h[i - HEIGHT_DIM]) * .25);
    }
    return Math.round(area);
  }
  metrics(): WorldTurfMetrics {
    const gpu = this.handle?.backend === 'webgpu';
    const drawCalls = this.batches.reduce((sum, batch) => sum + Number(batch.mesh.visible && batch.count > 0), 0);
    const stale = gpu && this.drawn !== null && this.sampledRevision !== this.selectionRevision;
    const submitted = drawCalls === 0 ? 0 : stale ? null : this.drawn;
    return {
      countSource: drawCalls === 0 ? 'no-draw' : !gpu ? 'cpu' : !this.diagnostic ? 'gpu-disabled' : stale ? 'gpu-stale' : submitted === null ? 'gpu-pending' : 'gpu-sample',
      mode: gpu ? 'gpu-indirect' : 'cpu-instanced', reference: this.reference !== null,
      submittedCrowns: submitted, submittedLeaves: submitted === null ? null : submitted * SOD_LEAVES_PER_CROWN,
      submittedTriangles: submitted === null ? null : submitted * SOD_LEAVES_PER_CROWN * (this.folded ? TURF_REDUCED_TRIANGLES_PER_LEAF : 22),
      candidateCrowns: this.count, overflow: this.overflow, collectMs: this.collectMs, selectMs: this.selectMs,
      gpuComputeMs: this.gpuComputeMs,
      proxyFrustumAreaEstimateM2: this.diagnostic && this.benchmark === null && (!this.trial || this.folded)
        ? this.frustumArea(this.trial === 'canopy' ? this.detailReach.value.y
          : this.options.ribbonHandoff ? this.drawLimit.value : this.reach.value / .72) : null,
      benchmark: this.benchmark === null ? null : {
        radius: this.benchmark, candidateCapacity: CAPACITY,
        frustumGrassAreaEstimateM2: this.benchmark === 'all' ? this.frustumArea(0) : null,
      },
      ribbonLod: null,
      nativeFade: this.options.ribbonHandoff ? { startM: TURF_NATIVE_FADE_START_M, endM: TURF_NATIVE_FADE_END_M } : null,
      residentBatches: this.batches.length,
      drawCalls, gpuSampleAgeMs: gpu && drawCalls !== 0 && this.drawn !== null ? Math.round(performance.now() - this.lastCountAt) : null,
    };
  }
}
