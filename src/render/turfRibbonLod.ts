import {
  DataTexture, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, type InstancedBufferGeometry,
  LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshLambertNodeMaterial, RGFormat, UnsignedByteType, Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  abs, attribute, cos, dot, Fn, mix, normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, texture,
  transformNormalToView, uv, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { frustumPlanes } from '../world/cdlodMath';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { HeightCellSampler } from '../world/heightField';
import { sodHash } from '../world/sodRoots';
import { HEIGHT_DIM, type TerrainTextureData } from '../world/terrainTextures';
import { TURF_NATIVE_FADE_START_M, turfEligible, turfVisible } from '../world/turfPopulation';
import { grassCarpetColour } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';
import type { RendererHandle } from './renderer';
import { terrainHeightNode } from './terrainHeightNode';
import {
  createTurfQualityGeometry, createTurfRibbonGeometry, createTurfSolidGeometry,
  RIBBON_ATLAS_BYTES, RIBBON_ATLAS_HEIGHT, RIBBON_ATLAS_WIDTH, turfRibbonAtlasTop, type TurfRibbonTrial,
} from './turfRibbonGeometry';
import type { WorldTurf } from './worldTurf';
import { nativeTurfCoverage } from './worldTurfMesh';

const STEP_M = .145;
const TILE_CELLS = 16;
const PADDING_M = .32;
const CAMERA_SLACK_M = .60;
const ROTATION_SLACK = Math.cos(8 * Math.PI / 180);
const RIBBON_TRIANGLES = 4;
const QUALITY_TRIANGLES = 6;
const SOLID_TRIANGLES = 15;
const RIBBON_ALPHA_CUTOFF = .035;
const sideAssets = import.meta.glob<string>('../../assets/grass/sod-side.bin', { query: '?url&no-inline', import: 'default', eager: true });

async function loadSideAtlas(): Promise<DataTexture> {
  const response = await fetch(sideAssets['../../assets/grass/sod-side.bin']);
  if (!response.ok) throw new Error(`Grass side profile: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== RIBBON_ATLAS_BYTES) throw new Error('Invalid grass side profile');
  const atlas = new DataTexture(bytes, RIBBON_ATLAS_WIDTH, RIBBON_ATLAS_HEIGHT, RGFormat, UnsignedByteType);
  atlas.magFilter = LinearFilter;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  atlas.anisotropy = 4;
  atlas.needsUpdate = true;
  return atlas;
}

/** Two rooted side projections carry the original foliage silhouette beyond the full blade geometry. */
export class TurfRibbonLod {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshLambertNodeMaterial>;
  private readonly roots: InstancedBufferAttribute;
  private readonly projection = new Matrix4();
  private readonly planes = new Float32Array(24);
  private readonly direction = new Vector3();
  private readonly sampler = new HeightCellSampler();
  private x = NaN;
  private y = NaN;
  private z = NaN;
  private fov = 0;
  private aspect = 0;
  private rebuildMs = 0;
  readonly cpuBytes: number;
  readonly gpuBytes: number;

  private constructor(atlas: DataTexture | null, height: DataTexture, private readonly terrain: TerrainTextureData,
    private readonly range: number, native: WorldTurf, wind: GrassWindUniforms, shadows: boolean, private readonly proxy: boolean,
    private readonly trial: TurfRibbonTrial | null, private readonly top: number) {
    const quality = trial === 'quality';
    const solid = trial === 'solid';
    const geometry = solid ? createTurfSolidGeometry() : quality ? createTurfQualityGeometry(top) : createTurfRibbonGeometry(top);
    const capacity = (Math.ceil(2 * (range + CAMERA_SLACK_M) / STEP_M) + 3) ** 2;
    this.roots = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    geometry.setAttribute('ribbonRoot', this.roots);
    geometry.instanceCount = 0;
    const root = attribute('ribbonRoot', 'vec4');
    const atlasSample = atlas ? texture(atlas, uv()) : null;
    const d = root.xyz.sub(native.eye).length().max(.01);
    const near = proxy ? smoothstep(native.detailReach.x, native.detailReach.y, d) : nativeTurfCoverage(d).oneMinus();
    const far = smoothstep(range * .75, range, d).oneMinus();
    // Lambert avoids full physical PBR overhead on 50k mid-range tufts; `solid` writes depth with zero alpha/discard.
    const material = solid
      ? new MeshLambertNodeMaterial({ side: DoubleSide, transparent: false, depthWrite: true })
      : new MeshLambertNodeMaterial({
        side: DoubleSide, transparent: true, depthWrite: false, alphaTest: RIBBON_ALPHA_CUTOFF, forceSinglePass: true,
      });
    const sampleHeight = terrainHeightNode(height);
    const ribbonNormal = varyingProperty('vec3', 'turfRibbonNormal');
    const ribbonTip = varyingProperty('float', 'turfRibbonTip');
    material.positionNode = Fn(() => {
      const solidScale = solid ? near.mul(far) : 1;
      const h = positionGeometry.y.mul(solid ? .095 : .105).mul(solidScale);
      const angle = root.w.mul(6.2831853).add(positionGeometry.z.mul(quality || solid ? 2.0943951 : 1.16));
      const along = vec2(cos(angle), sin(angle));
      const across = vec2(along.y.negate(), along.x);
      const spread = across.mul(h.mul(mix(1.10, 1.50, root.w)));
      const widthM = solid ? mix(.055, .085, root.w).mul(solidScale) : mix(.17, .24, root.w);
      const base = root.xz.add(along.mul(positionGeometry.x).mul(widthM)).add(spread).toVar();
      const gust = grassGust(root.xz, root.w, wind);
      const sway = wind.wind.xy.mul(h.pow(2).mul(gust.mul(1.7).add(.2)).mul(wind.wind.z.min(8)));
      // The quality/solid silhouette bends its tip without moving its anchored root.
      const curl = quality || solid ? along.mul(positionGeometry.y.mul(positionGeometry.y).mul(solid ? .028 : .020)).mul(solidScale) : vec2(0, 0);
      const tip = base.add(sway).add(curl);
      const ground = sampleHeight.withNormal(base);
      const tilt = vec3(across.x.mul(.18).add(sway.x.mul(2.4)), 0, across.y.mul(.18).add(sway.y.mul(2.4)));
      const bladeBend = quality || solid ? positionGeometry.y.mul(.16) : 0;
      ribbonNormal.assign(normalize(ground.normal.add(tilt).add(quality || solid
        ? vec3(along.x.mul(bladeBend), 0, along.y.mul(bladeBend)) : vec3(0, 0, 0))));
      ribbonTip.assign(positionGeometry.y);
      return vec3(tip.x, ground.y.add(h).sub(.002), tip.y);
    })();
    material.normalNode = transformNormalToView(ribbonNormal);
    const tone = atlasSample
      ? (quality ? mix(.59, 1.21, atlasSample.g) : mix(.72, 1.08, atlasSample.g))
      : mix(.76, 1.16, root.w);
    const ribbonColour = grassCarpetColour(native.season)
      .mul(tone)
      .mul(quality || solid ? mix(.62, 1.20, uv().y) : mix(.78, 1.12, uv().y));
    material.colorNode = ribbonColour;
    material.aoNode = mix(quality || solid ? .44 : .62, 1, smoothstep(0, .72, uv().y));
    const view = normalize(positionWorld.negate());
    const backlit = pow(saturate(dot(view, native.sunDir.negate())), 3.5).mul(smoothstep(.25, 1, ribbonTip));
    material.emissiveNode = ribbonColour.mul(native.sunColour).mul(backlit).mul(.24 / Math.PI);
    if (!solid && atlasSample) {
      const alpha = atlasSample.r.mul(smoothstep(0, .23, uv().y));
      // Split the atlas opacity between crossed projections in optical-depth space.
      if (proxy) {
        // Side silhouettes are strongest at grazing angles; the three ground layers cover overhead views.
        const sideWeight = mix(.5, .13, smoothstep(.35, .86, abs(positionWorld.normalize().y)));
        material.opacityNode = alpha.min(.999).oneMinus().pow(near.mul(far).mul(sideWeight).mul(quality ? .6666667 : 1)).oneMinus();
      } else {
        material.opacityNode = quality
          ? alpha.min(.999).oneMinus().pow(near.mul(far).mul(.6666667)).oneMinus()
          : alpha.mul(near).mul(far);
      }
    }
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = shadows;
    mesh.name = 'world-turf-ribbons';
    this.mesh = mesh;
    const atlasCpu = atlas ? RIBBON_ATLAS_BYTES : 0;
    const atlasGpu = atlas ? Math.ceil(RIBBON_ATLAS_BYTES * 4 / 3) : 0;
    const geomBytes = solid ? 21 * 5 * 4 + 45 * 2 : quality ? 12 * 5 * 4 + 18 * 2 : 8 * 5 * 4 + 12 * 2;
    this.cpuBytes = this.roots.array.byteLength + atlasCpu + geomBytes;
    this.gpuBytes = this.roots.array.byteLength + atlasGpu + geomBytes;
  }

  static async load(height: DataTexture, terrain: TerrainTextureData, range: number, native: WorldTurf, wind: GrassWindUniforms,
    shadows: boolean, proxy: boolean, trial: TurfRibbonTrial | null = null) {
    const atlas = trial === 'solid' ? null : await loadSideAtlas();
    const top = atlas && trial ? turfRibbonAtlasTop(atlas.image.data as Uint8Array) : 1;
    return new TurfRibbonLod(atlas, height, terrain, range, native, wind, shadows, proxy, trial, top);
  }

  setRenderer(handle: RendererHandle): void {
    if (this.trial === 'solid') return;
    const depth = this.trial === 'depth' && handle.backend === 'webgpu' && handle.renderer.currentSamples > 1;
    const { material } = this.mesh;
    if (material.alphaToCoverage === depth) return;
    material.transparent = !depth;
    material.depthWrite = depth;
    // Let MSAA convert the original opacity to coverage. Keep three.js's alpha-test edge remap off in this mode.
    material.alphaToCoverage = depth;
    material.alphaTest = depth ? 0 : RIBBON_ALPHA_CUTOFF;
    material.needsUpdate = true;
  }

  /** @hot Update only after leaving the padded view window. */
  update(x: number, y: number, z: number, camera: PerspectiveCamera): void {
    const matrix = camera.matrixWorld.elements;
    const turned = this.direction.x * matrix[8] + this.direction.y * matrix[9] + this.direction.z * matrix[10] < ROTATION_SLACK;
    const moved = !Number.isFinite(this.x) || (x - this.x) ** 2 + (y - this.y) ** 2 + (z - this.z) ** 2 > .45 ** 2;
    if (moved || turned || this.fov !== camera.fov || this.aspect !== camera.aspect) {
      this.direction.set(matrix[8], matrix[9], matrix[10]);
      this.rebuild(x, y, z, camera);
    }
  }

  /** @amortized Rebuild a padded view window, using world-fixed root positions and coarse tile skipping. */
  private rebuild(x: number, y: number, z: number, camera: PerspectiveCamera): void {
    const start = performance.now();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.x = x; this.y = y; this.z = z;
    this.fov = camera.fov; this.aspect = camera.aspect;
    frustumPlanes(this.projection.elements, this.planes);
    const radius = this.range + CAMERA_SLACK_M;
    const padding = PADDING_M + CAMERA_SLACK_M + radius * .14;
    const left = Math.ceil(Math.max(WORLD_MIN, x - radius) / STEP_M);
    const right = Math.floor(Math.min(WORLD_MAX, x + radius) / STEP_M);
    const back = Math.ceil(Math.max(WORLD_MIN, z - radius) / STEP_M);
    const front = Math.floor(Math.min(WORLD_MAX, z + radius) / STEP_M);
    const r2 = radius ** 2;
    const hidden2 = this.proxy ? 0 : (TURF_NATIVE_FADE_START_M - CAMERA_SLACK_M) ** 2;
    const roots = this.roots.array;
    let at = 0;
    const jitter = this.proxy ? STEP_M : .11;
    const tileHalf = (TILE_CELLS * .5 + .5) * STEP_M;
    const tileRadius = radius + tileHalf * Math.SQRT2;
    const tileR2 = tileRadius ** 2;
    const heights = this.terrain.height;
    const { sampler } = this;
    sampler.reset();
    // Collect visible tiles and sort front-to-back so depth-writing modes maximize hardware Early-Z rejection.
    const tiles: { tx: number; tz: number; xEnd: number; zEnd: number; d2: number }[] = [];
    for (let tz = back; tz <= front; tz += TILE_CELLS) {
      const zEnd = Math.min(front, tz + TILE_CELLS - 1);
      const cz = (tz + zEnd) * .5 * STEP_M;
      const tdz = cz - z;
      for (let tx = left; tx <= right; tx += TILE_CELLS) {
        const xEnd = Math.min(right, tx + TILE_CELLS - 1);
        const cx = (tx + xEnd) * .5 * STEP_M;
        const tdx = cx - x;
        const d2 = tdx * tdx + tdz * tdz;
        if (d2 >= tileR2) continue;
        const lx = Math.max(0, Math.min(HEIGHT_DIM - 2, Math.floor((cx - WORLD_MIN) * .5)));
        const lz = Math.max(0, Math.min(HEIGHT_DIM - 2, Math.floor((cz - WORLD_MIN) * .5)));
        const li = lz * HEIGHT_DIM + lx;
        const hMin = Math.min(heights[li], heights[li + 1], heights[li + HEIGHT_DIM], heights[li + HEIGHT_DIM + 1]);
        const hMax = Math.max(heights[li], heights[li + 1], heights[li + HEIGHT_DIM], heights[li + HEIGHT_DIM + 1]);
        const tilePad = padding + Math.hypot(tileHalf, (hMax - hMin) * .5 + 1.2, tileHalf);
        if (!turfVisible(this.planes, tdx, (hMin + hMax) * .5 - y, tdz, tilePad)) continue;
        tiles.push({ tx, tz, xEnd, zEnd, d2 });
      }
    }
    tiles.sort((a, b) => a.d2 - b.d2);
    for (let t = 0; t < tiles.length; t++) {
      const { tx, tz, xEnd, zEnd } = tiles[t];
      for (let iz = tz; iz <= zEnd; iz++) for (let ix = tx; ix <= xEnd; ix++) {
        const seed = sodHash(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663));
        const wx = ix * STEP_M + ((seed & 255) / 255 - .5) * jitter;
        const wz = iz * STEP_M + ((seed >>> 8 & 255) / 255 - .5) * jitter;
        const dx = wx - x, dz = wz - z;
        const xz2 = dx * dx + dz * dz;
        if (xz2 >= r2 || !turfEligible(this.terrain, wx, wz)) continue;
        const h = sampler.heightAt(wx, wz);
        const dy = h - y;
        const distance2 = xz2 + dy * dy;
        if (h <= .08 || distance2 >= r2 || distance2 <= hidden2 || !turfVisible(this.planes, dx, dy, dz, padding)) continue;
        roots[at++] = wx;
        roots[at++] = h;
        roots[at++] = wz;
        roots[at++] = (seed >>> 16) / 65536;
      }
    }
    this.mesh.geometry.instanceCount = at / 4;
    if (at) {
      this.roots.clearUpdateRanges();
      this.roots.addUpdateRange(0, at);
      this.roots.needsUpdate = true;
    }
    this.rebuildMs = performance.now() - start;
  }

  metrics() {
    const cells = this.mesh.geometry.instanceCount;
    const mode: 'blend' | TurfRibbonTrial = this.trial === 'solid' ? 'solid'
      : this.mesh.material.alphaToCoverage ? 'depth' : this.trial === 'quality' ? 'quality' : this.trial ? 'trim' : 'blend';
    const perCell = mode === 'solid' ? SOLID_TRIANGLES : mode === 'quality' ? QUALITY_TRIANGLES : RIBBON_TRIANGLES;
    return { rangeM: this.range, cells, triangles: this.mesh.visible ? cells * perCell : 0,
      rebuildMs: this.rebuildMs, mode, topV: this.top };
  }
}
