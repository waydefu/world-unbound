import {
  BufferAttribute, ClampToEdgeWrapping, DataTexture, DoubleSide, DynamicDrawUsage, FloatType,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshSSSNodeMaterial, NearestFilter, RGBAFormat,
  type Node, type UniformNode, type Vector3,
} from 'three/webgpu';
import {
  Fn, attribute, clamp, cos, float, floor, ivec2, length, mix, normalize, sin, smoothstep, texture,
  transformNormalToView, varyingProperty, vec2, vec3, vertexIndex,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { SOD_ROOT_INSET_M } from '../world/sodRoots';
import { HEIGHT_DIM } from '../world/terrainTextures';
import { grassCarpetColour, seasonal } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';

const VERTICES_PER_LEAF = 19;
const VERTICES_PER_CROWN = 171;
export const CROWN_VARIANTS = 16;
const atlasUrls = import.meta.glob<string>('../../assets/grass/sod-crowns.bin', { query: '?url', import: 'default', eager: true });

export function decodeCrownAtlas(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength !== 12 + VERTICES_PER_CROWN * CROWN_VARIANTS * 4 * 16) throw new Error('Wrong native crown atlas size');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x314e5243 || view.getUint32(4, true) !== CROWN_VARIANTS
    || view.getUint32(8, true) !== VERTICES_PER_CROWN) throw new Error('Unknown native crown atlas');
  return new Float32Array(buffer, 12);
}

export async function loadCrownAtlas() {
  const url = atlasUrls['../../assets/grass/sod-crowns.bin'];
  if (!url) throw new Error('Missing native crown atlas');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Native crowns: HTTP ${response.status}`);
  const atlas = new DataTexture(decodeCrownAtlas(await response.arrayBuffer()), VERTICES_PER_CROWN, CROWN_VARIANTS * 4, RGBAFormat, FloatType);
  atlas.name = 'native-sod-crowns';
  atlas.minFilter = atlas.magFilter = NearestFilter;
  atlas.wrapS = atlas.wrapT = ClampToEdgeWrapping;
  atlas.needsUpdate = true;
  return atlas;
}

function crownIndices(first: number, end: number): Uint16Array {
  const indices: number[] = [];
  for (let leaf = first; leaf < end; leaf++) {
    const base = leaf * VERTICES_PER_LEAF;
    for (let row = 0; row < 5; row++) {
      const a = base + row * 3;
      indices.push(a, a + 3, a + 4, a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 1, a + 5, a + 2);
    }
    indices.push(base + 15, base + 18, base + 16, base + 16, base + 18, base + 17);
  }
  return new Uint16Array(indices);
}

export function createCrownBatch(options: {
  atlas: DataTexture; height: DataTexture; water: DataTexture;
  capacity: number; distance: number; near: boolean; shadows: boolean;
  eye: UniformNode<'vec3', Vector3>; season: UniformNode<'vec3', Vector3>; wind: GrassWindUniforms;
}) {
  const { atlas, height, water, capacity, distance, near, eye, season, wind } = options;
  const roots = new Float32Array(capacity * 4);
  const instance = new InstancedBufferAttribute(roots, 4).setUsage(DynamicDrawUsage);
  const geometry = new InstancedBufferGeometry();
  // Three.js uses this vertex count. The position node reads the crown's original XYZ from the atlas.
  const positions = new Float32Array(VERTICES_PER_CROWN * 3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('crownRoot', instance);
  const indices = crownIndices(0, near ? 9 : 3);
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = 0;

  const material = new MeshSSSNodeMaterial({ side: DoubleSide, roughness: 0.52, specularIntensity: 0.015 });
  const pigment = varyingProperty('vec3', near ? 'crownPigmentN' : 'crownPigmentS');
  const shapeNormal = varyingProperty('vec3', near ? 'crownNormalN' : 'crownNormalS');
  const bladeHeight = varyingProperty('float', near ? 'crownHeightN' : 'crownHeightS');
  const moisture = varyingProperty('float', near ? 'crownMoistureN' : 'crownMoistureS');
  const crowns = texture(atlas);
  const ground = texture(height);
  const load = (x: Node<'float'>, z: Node<'float'>) =>
    ground.load(ivec2(clamp(x, 0, HEIGHT_DIM - 1).toInt(), clamp(z, 0, HEIGHT_DIM - 1).toInt())).r;

  material.positionNode = Fn(() => {
    const r = attribute('crownRoot', 'vec4');
    const row = r.w.mul(4).toInt();
    const index = vertexIndex.toInt();
    const p = crowns.load(ivec2(index, row)).xyz;
    const n = crowns.load(ivec2(index, row.add(1))).xyz;
    const leaf = crowns.load(ivec2(index, row.add(3))).xyz;
    const s = sin(r.z);
    const c = cos(r.z);
    const base = vec2(r.x, r.y);
    const foot = base.add(vec2(leaf.x.mul(c).sub(leaf.z.mul(s)), leaf.x.mul(s).add(leaf.z.mul(c))));
    const xz = base.add(vec2(p.x.mul(c).sub(p.z.mul(s)), p.x.mul(s).add(p.z.mul(c))));
    const u = foot.sub(WORLD_MIN).mul(0.5);
    const i = floor(u);
    const f = u.sub(i);
    const h00 = load(i.x, i.y);
    const h10 = load(i.x.add(1), i.y);
    const h01 = load(i.x, i.y.add(1));
    const h11 = load(i.x.add(1), i.y.add(1));
    const lower = h00.add(h10.sub(h00).mul(f.x)).add(h01.sub(h00).mul(f.y));
    const upper = h11.add(h01.sub(h11).mul(f.x.oneMinus())).add(h10.sub(h11).mul(f.y.oneMinus()));
    const y = f.x.add(f.y).lessThanEqual(1).select(lower, upper);
    const d = length(vec3(base.x.sub(eye.x), y.sub(eye.y), base.y.sub(eye.z)));
    const fade = float(1).sub(smoothstep(distance * (near ? 0.57 : 0.60), distance, d));
    const h = p.y.sub(leaf.y);
    const gust = grassGust(base, float(0.53), wind);
    const bend = h.max(0).pow(2).mul(gust.mul(1.7).add(0.2)).mul(wind.wind.z.min(8)).mul(fade);
    const sway = wind.wind.xy.mul(bend);
    pigment.assign(crowns.load(ivec2(index, row.add(2))).rgb);
    shapeNormal.assign(vec3(n.x.mul(c).sub(n.z.mul(s)), n.y, n.x.mul(s).add(n.z.mul(c))));
    bladeHeight.assign(h);
    moisture.assign(texture(water, base.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN)).level(float(0)).r);
    return vec3(xz.x.add(sway.x), y.sub(SOD_ROOT_INSET_M).add(h.mul(fade)).sub(fade.oneMinus().mul(0.015)), xz.y.add(sway.y));
  })();

  const contact = mix(0.61, 1, smoothstep(0.004, 0.064, bladeHeight));
  const nativeAlbedo = seasonal(pigment.mul(vec3(0.26, 0.34, 0.19)), season);
  material.colorNode = mix(nativeAlbedo, grassCarpetColour(season), near ? 0.12 : 0.45)
    .mul(contact).mul(mix(1, 0.91, smoothstep(0.45, 0.95, moisture)));
  material.normalNode = transformNormalToView(normalize(mix(shapeNormal, vec3(0, 1, 0), near ? 0.36 : 0.66)));
  material.aoNode = mix(0.52, 1, smoothstep(0, 0.061, bladeHeight));
  material.thicknessColorNode = pigment.mul(vec3(0.27, 0.30, 0.13));
  material.thicknessAttenuationNode = float(near ? 0.22 : 0.055);
  material.thicknessAmbientNode = float(0);

  const mesh = new Mesh(geometry, material);
  mesh.name = near ? 'rooted-native-crowns' : 'rooted-native-sparse-crowns';
  mesh.frustumCulled = false;
  mesh.receiveShadow = options.shadows;
  return { roots, instance, mesh, triangles: indices.length / 3, leaves: near ? 9 : 3, capacity,
    bytes: roots.byteLength + indices.byteLength + positions.byteLength };
}
