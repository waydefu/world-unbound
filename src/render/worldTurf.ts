import {
  DynamicDrawUsage, IndirectStorageBufferAttribute, InstancedBufferAttribute, Matrix4, type PerspectiveCamera,
  StorageBufferAttribute, Vector3, Vector4, type Group, type Mesh, type UniformNode, type WebGPURenderer,
} from 'three/webgpu';
import { atomicAdd, atomicStore, attribute, dot, Fn, If, instanceIndex, length, storage, uint, uniform, uniformArray } from 'three/tsl';
import { frustumPlanes } from '../world/cdlodMath';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { SOD_LEAVES_PER_CROWN } from '../world/sodRoots';
import { HEIGHT_DIM, type TerrainTextureData } from '../world/terrainTextures';
import { collectTurfMasterReference, collectTurfRoots, TURF_CROWN_PADDING_M, TURF_CROWN_SPACING_M, turfEligible, turfVisible } from '../world/turfPopulation';
import type { RendererHandle } from './renderer';
import { worldTurfGeometry, worldTurfMesh, type TurfMeshOptions } from './worldTurfMesh';

const CAPACITY = 524_288;
const WORKGROUP = 64;
const WINDOW_SLACK = .44;
const WINDOW_TURN = Math.cos(10 * Math.PI / 180);

interface GpuRoots {
  renderer: WebGPURenderer;
  input: StorageBufferAttribute;
  args: IndirectStorageBufferAttribute;
  run(count: number): void;
}

export interface WorldTurfMetrics {
  mode: 'gpu-indirect' | 'cpu-instanced';
  reference: boolean;
  submittedCrowns: number | null;
  submittedLeaves: number | null;
  submittedTriangles: number | null;
  candidateCrowns: number;
  overflow: boolean;
  collectMs: number;
  selectMs: number;
  gpuComputeMs: number | null;
  proxyFrustumAreaEstimateM2: number | null;
  drawCalls: number;
  gpuSampleAgeMs: number | null;
}

export class WorldTurf {
  readonly eye = uniform(new Vector3());
  readonly season: UniformNode<'vec3', Vector3> = uniform(new Vector3(1, 0, 0));
  readonly reach = uniform(1);
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  private readonly candidates = new Float32Array(CAPACITY * 4);
  private readonly cpuRoots = new Float32Array(CAPACITY * 4);
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
  private mesh: Mesh | null = null;
  private instance: InstancedBufferAttribute | null = null;
  private gpu: GpuRoots | null = null;
  private count = 0;
  private drawn: number | null = null;
  private sampling = false;
  private lastSample = -Infinity;
  private lastCountAt = -Infinity;
  private collectMs = 0;
  private selectMs = 0;
  private gpuComputeMs: number | null = null;
  private overflow = false;

  constructor(private readonly root: Group, private readonly terrain: TerrainTextureData,
    private readonly options: Omit<TurfMeshOptions, 'eye' | 'season' | 'reach' | 'reference'>,
    private readonly reference: { readonly x: number; readonly z: number; readonly origins: Float32Array } | null, private readonly diagnostic: boolean) {
    this.cpuBytes = this.candidates.byteLength + this.cpuRoots.byteLength;
    this.gpuBytes = this.candidates.byteLength + CAPACITY * 4;
  }

  attach(handle: RendererHandle): void {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (!Array.isArray(this.mesh.material)) this.mesh.material.dispose();
    }
    this.gpu = null;
    this.instance = null;
    this.drawn = null;
    this.gpuComputeMs = null;
    this.lastCountAt = -Infinity;
    this.lastProjection.fill(NaN);
    this.lastReach = -1;
    const geometry = worldTurfGeometry();
    const common = { ...this.options, eye: this.eye, season: this.season, reach: this.reach, reference: this.reference !== null };
    const capacity = this.candidates.length / 4;
    if (handle.backend === 'webgpu') {
      const input = new StorageBufferAttribute(this.candidates, 4).setUsage(DynamicDrawUsage);
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
          const offset = source.element(id).xyz.sub(this.eye).toVar();
          const visibleRoot = uint(1).toVar();
          if (!this.reference) {
            If(length(offset).greaterThan(this.reach.div(.72).add(TURF_CROWN_PADDING_M)), () => { visibleRoot.assign(0); });
          }
          for (let plane = 0; plane < 6; plane++) {
            const p = this.planeNodes.element(plane);
            If(dot(p.xyz, offset).add(p.w).lessThan(-TURF_CROWN_PADDING_M), () => { visibleRoot.assign(0); });
          }
          If(visibleRoot.equal(1), () => {
            const slot = atomicAdd(indirect.element(1), 1);
            visible.element(slot).assign(id);
          });
        });
      })().computeKernel([WORKGROUP]).setName('World turf frustum compact');
      this.gpu = {
        renderer: handle.renderer, input, args,
        run: count => {
          size.value = count;
          handle.renderer.compute(clear);
          if (count) handle.renderer.compute(compact, [Math.ceil(count / WORKGROUP), 1, 1]);
        },
      };
      this.mesh = worldTurfMesh(geometry, source.element(visible.element(instanceIndex)), common);
    } else {
      this.instance = new InstancedBufferAttribute(this.cpuRoots, 4).setUsage(DynamicDrawUsage);
      geometry.setAttribute('worldTurfRoot', this.instance);
      this.mesh = worldTurfMesh(geometry, attribute('worldTurfRoot', 'vec4'), common);
    }
    this.root.add(this.mesh);
  }

  /** @hot Reuse the candidate window while looking around, then compact against the current view. */
  update(now: number, x: number, y: number, z: number, camera: PerspectiveCamera, bufferHeight: number): void {
    if (!this.mesh) return;
    const projected = Math.max(bufferHeight, 1) * camera.projectionMatrix.elements[5] * .5 * TURF_CROWN_SPACING_M;
    const reach = Math.min(3.0, Math.max(2.35, projected));
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const p = this.projection.elements;
    const eye = this.eye.value;
    let changed = eye.x !== x || eye.y !== y || eye.z !== z || this.reach.value !== reach;
    for (let i = 0; i < p.length; i++) if (p[i] !== this.lastProjection[i]) changed = true;
    if (changed) {
      this.lastProjection.set(p);
      eye.set(x, y, z);
      this.reach.value = reach;
      frustumPlanes(p, this.planes);
      const matrix = camera.matrixWorld.elements;
      const aspectScale = camera.projectionMatrix.elements[0];
      const turn = this.anchorDirection.x * matrix[8] + this.anchorDirection.y * matrix[9] + this.anchorDirection.z * matrix[10] < WINDOW_TURN;
      const grow = Math.hypot(x - this.anchor.x, y - this.anchor.y, z - this.anchor.z) > WINDOW_SLACK * .8;
      if (this.lastReach !== reach || ((!this.reference) && (grow || turn || aspectScale !== this.lastAspectScale))) {
        this.anchorDirection.set(matrix[8], matrix[9], matrix[10]);
        this.lastAspectScale = aspectScale;
        this.rebuild(x, y, z, reach);
      } else this.collectMs = 0;
      this.select(x, y, z);
    }
    if (this.diagnostic && this.gpu && !this.sampling && now - this.lastSample >= 1000) this.readGpu(now, this.gpu);
  }

  /** @amortized Rebuild only after leaving the current resident window. */
  private rebuild(x: number, y: number, z: number, reach: number): void {
    const start = performance.now();
    this.anchor.set(x, y, z);
    this.lastReach = reach;
    const radius = reach / .72 + TURF_CROWN_PADDING_M + WINDOW_SLACK;
    const count = this.reference ? collectTurfMasterReference(this.terrain, this.reference, this.reference.origins, this.candidates) : collectTurfRoots(this.terrain, {
      x, y, z, reach: radius, reference: null, hull: this.planes,
      // A plane can rotate by ten degrees before the window is rebuilt. Also cover eye translation and complete blades.
      hullMargin: radius * .20 + WINDOW_SLACK + TURF_CROWN_PADDING_M,
    }, this.candidates, this.uv);
    this.overflow = count < 0;
    this.count = Math.max(0, count);
    if (this.gpu && this.count) {
      this.gpu.input.clearUpdateRanges();
      this.gpu.input.addUpdateRange(0, this.count * 4);
      this.gpu.input.needsUpdate = true;
    }
    this.collectMs = performance.now() - start;
  }

  /** @hot */
  private select(x: number, y: number, z: number): void {
    const start = performance.now();
    if (this.gpu) {
      for (let i = 0; i < 6; i++) this.vectors[i].fromArray(this.planes, i * 4);
      this.gpu.run(this.count);
    } else if (this.instance && this.mesh) {
      const limit = (this.reach.value / .72 + TURF_CROWN_PADDING_M) ** 2;
      let size = 0;
      for (let i = 0; i < this.count * 4; i += 4) {
        const dx = this.candidates[i] - x, dy = this.candidates[i + 1] - y, dz = this.candidates[i + 2] - z;
        if ((!this.reference && dx * dx + dy * dy + dz * dz > limit) || !turfVisible(this.planes, dx, dy, dz, TURF_CROWN_PADDING_M)) continue;
        this.cpuRoots[size++] = this.candidates[i];
        this.cpuRoots[size++] = this.candidates[i + 1];
        this.cpuRoots[size++] = this.candidates[i + 2];
        this.cpuRoots[size++] = this.candidates[i + 3];
      }
      this.drawn = size / 4;
      (this.mesh.geometry as ReturnType<typeof worldTurfGeometry>).instanceCount = this.drawn;
      if (size) {
        this.instance.clearUpdateRanges();
        this.instance.addUpdateRange(0, size);
        this.instance.needsUpdate = true;
      }
    }
    this.selectMs = performance.now() - start;
  }

  /** @amortized Optional once-per-second diagnostics. */
  private readGpu(now: number, gpu: GpuRoots): void {
    this.lastSample = now;
    this.sampling = true;
    void gpu.renderer.getArrayBufferAsync(gpu.args).then(bytes => {
      if (this.gpu !== gpu) return;
      this.drawn = new Uint32Array(bytes)[1];
      this.lastCountAt = performance.now();
    }).catch(() => undefined).finally(() => { this.sampling = false; });
    if (gpu.renderer.hasFeature('timestamp-query')) {
      void gpu.renderer.resolveTimestampsAsync('compute').then(ms => { if (gpu === this.gpu) this.gpuComputeMs = ms ?? null; }).catch(() => undefined);
    }
  }

  /** A frustum estimate from 16 m ground samples. Includes terrain that may be occluded by nearer ground. */
  private proxyArea(): number | null {
    if (!this.diagnostic) return null;
    const eye = this.eye.value;
    const reach = this.reach.value / .72;
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
    const drawCalls = Number(!!this.gpu || (this.drawn ?? 0) > 0);
    return {
      mode: this.gpu ? 'gpu-indirect' : 'cpu-instanced', reference: this.reference !== null,
      submittedCrowns: this.drawn, submittedLeaves: this.drawn === null ? null : this.drawn * SOD_LEAVES_PER_CROWN,
      submittedTriangles: this.drawn === null ? null : this.drawn * SOD_LEAVES_PER_CROWN * 22,
      candidateCrowns: this.count, overflow: this.overflow, collectMs: this.collectMs, selectMs: this.selectMs,
      gpuComputeMs: this.gpuComputeMs, proxyFrustumAreaEstimateM2: this.proxyArea(),
      drawCalls, gpuSampleAgeMs: this.gpu && this.drawn !== null ? Math.round(performance.now() - this.lastCountAt) : null,
    };
  }
}
