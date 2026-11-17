import {
  BufferAttribute, BufferGeometry, type DataTexture, FrontSide, Mesh, MeshStandardNodeMaterial, type Node, Vector3,
} from 'three/webgpu';
import {
  Fn, clamp, float, length, mix, mx_noise_float, normalize, positionLocal, positionWorld, smoothstep, texture,
  transformNormalToView, uniform, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';

/** 256 x 256 quads over the whole 4096 m world: 16 m spacing (128 x 128, 32 m, on the lite tier). */
const CELLS = 256;
const CELLS_LITE = 128;
const NOT_READY_Y = -50;
/** Normal sampling step in metres (the sea-floor texel is 4 m). */
const STEP = 8;
const SEABED = vec3(0.105, 0.118, 0.098);
const SAND = vec3(0.52, 0.45, 0.31);
const GRASS_DRY = vec3(0.21, 0.24, 0.085);
const GRASS_LUSH = vec3(0.075, 0.16, 0.045);

function buildGrid(cells: number): BufferGeometry {
  const side = cells + 1;
  const span = WORLD_MAX - WORLD_MIN;
  const positions = new Float32Array(side * side * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const o = (j * side + i) * 3;
      positions[o] = WORLD_MIN + (i / cells) * span;
      positions[o + 2] = WORLD_MIN + (j / cells) * span;
    }
  }
  // 66 049 vertices do not fit 16-bit indices.
  const indices = new Uint32Array(cells * cells * 6);
  let k = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * side + i;
      const b = a + side;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
      indices[k++] = a + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Cheap whole-world ground skin (G1.4 phase D). It sits slightly below the
 * streamed terrain so chunks always win the depth test, and shows terrain-
 * coloured ground where chunks are not streamed in. Heights come from the
 * ocean's sea-floor texture; the mesh lives under the terrain root and its
 * vertices are absolute world coordinates.
 */
export class FarTerrain {
  readonly mesh: Mesh;
  /** GPU bytes held by the grid. */
  readonly gpuBytes: number;
  private readonly eyeOffset = uniform(new Vector3());
  private readonly ready = uniform(0);

  constructor(floor: DataTexture, lite = false) {
    const geometry = buildGrid(lite ? CELLS_LITE : CELLS);
    this.mesh = new Mesh(geometry, this.createMaterial(floor));
    this.mesh.name = 'far-terrain';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.gpuBytes = geometry.getAttribute('position').array.byteLength + (geometry.index?.array.byteLength ?? 0);
  }

  /** The sea-floor heights have been uploaded; until then the skin hides 50 m down. */
  setReady(): void {
    this.ready.value = 1;
  }

  /** @hot writes an existing uniform only */
  setEyeOffset(x: number, y: number, z: number): void {
    this.eyeOffset.value.set(x, y, z);
  }

  private createMaterial(floor: DataTexture): MeshStandardNodeMaterial {
    const eye = this.eyeOffset;
    const vNormal = varyingProperty('vec3', 'farNormal');
    const vHeight = varyingProperty('float', 'farHeight');
    const height = (p: Node<'vec2'>) =>
      texture(floor, p.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN)).level(float(0)).r;

    const material = new MeshStandardNodeMaterial({ metalness: 0, side: FrontSide });
    material.name = 'far-terrain';
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;

    material.positionNode = Fn(() => {
      const p = positionLocal.xz;
      const h = height(p);
      const dist = length(vec3(p.x.sub(eye.x), h.sub(eye.y), p.y.sub(eye.z)));
      const lowered = h.sub(dist.mul(0.004).add(0.6));
      const gx = height(p.add(vec2(STEP, 0))).sub(height(p.sub(vec2(STEP, 0)))).div(2 * STEP);
      const gz = height(p.add(vec2(0, STEP))).sub(height(p.sub(vec2(0, STEP)))).div(2 * STEP);
      vNormal.assign(normalize(vec3(gx.negate(), 1, gz.negate())));
      vHeight.assign(h);
      return vec3(p.x, mix(float(NOT_READY_Y), lowered, this.ready), p.y);
    })();

    const pW = positionWorld.add(eye);
    const macro = mx_noise_float(pW.xz.mul(0.027));
    const grass = mix(GRASS_DRY, GRASS_LUSH, smoothstep(-0.6, 0.6, macro).mul(0.6).add(0.2));
    const sandy = mix(grass, SAND, float(1).sub(smoothstep(1.6, 2.4, vHeight)));
    material.colorNode = mix(SEABED, sandy, clamp(smoothstep(-2.2, -0.2, vHeight), 0, 1));
    material.roughnessNode = float(0.9);
    material.normalNode = transformNormalToView(vNormal);
    return material;
  }
}
