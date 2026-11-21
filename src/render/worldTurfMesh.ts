import {
  BufferAttribute, type DataTexture, DoubleSide, InstancedBufferGeometry, Mesh, MeshSSSNodeMaterial,
  type Node, type UniformNode, type Vector3,
} from 'three/webgpu';
import {
  abs, float, floor, Fn, ivec2, length, mix, normalize, sign, smoothstep, texture,
  transformNormalToView, varyingProperty, vec3, vertexIndex,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { SOD_LEAVES_PER_CROWN, SOD_ROOT_INSET_M } from '../world/sodRoots';
import { HEIGHT_DIM } from '../world/terrainTextures';
import { seasonal } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';
import { CROWN_VERTICES, LEAF_VERTICES, MASTER_WIDTH } from './worldTurfAssets';

export function worldTurfGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(CROWN_VERTICES * 3), 3));
  const indices: number[] = [];
  for (let leaf = 0; leaf < SOD_LEAVES_PER_CROWN; leaf++) {
    const base = leaf * LEAF_VERTICES;
    for (let row = 0; row < 5; row++) {
      const a = base + row * 3;
      indices.push(a, a + 3, a + 4, a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 1, a + 5, a + 2);
    }
    indices.push(base + 15, base + 18, base + 16, base + 16, base + 18, base + 17);
  }
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
  geometry.instanceCount = 0;
  return geometry;
}

export interface TurfMeshOptions {
  master: readonly DataTexture[]; height: DataTexture; water: DataTexture;
  eye: UniformNode<'vec3', Vector3>; season: UniformNode<'vec3', Vector3>; reach: UniformNode<'float', number>;
  wind: GrassWindUniforms; reference: boolean; shadows: boolean;
}

export function worldTurfMesh(geometry: InstancedBufferGeometry, root: Node<'vec4'>, options: TurfMeshOptions): Mesh {
  const { master, height, water, eye, season, reach, wind, reference } = options;
  const material = new MeshSSSNodeMaterial({ side: DoubleSide, roughness: .49, specularIntensity: .26, alphaHash: !reference });
  const pigment = varyingProperty('vec3', 'worldTurfPigment');
  const normal = varyingProperty('vec3', 'worldTurfNormal');
  const bladeHeight = varyingProperty('float', 'worldTurfHeight');
  const moisture = varyingProperty('float', 'worldTurfMoisture');
  const visibility = varyingProperty('float', 'worldTurfVisibility');
  const normalDetail = varyingProperty('float', 'worldTurfNormalDetail');
  const tables = master.map(tex => texture(tex));
  const ground = texture(height);
  const terrainY = (x: Node<'float'>, z: Node<'float'>) =>
    ground.load(ivec2(x.clamp(0, HEIGHT_DIM - 1).toInt(), z.clamp(0, HEIGHT_DIM - 1).toInt())).r;
  const address = (i: Node<'float'>) => ivec2(i.mod(MASTER_WIDTH).toInt(), floor(i.div(MASTER_WIDTH)).toInt());
  material.positionNode = Fn(() => {
    const r = root.toVar();
    const id = floor(r.w);
    const localIndex = vertexIndex.toFloat();
    const i = id.mul(CROWN_VERTICES).add(localIndex);
    const footIndex = id.mul(CROWN_VERTICES).add(floor(localIndex.div(LEAF_VERTICES)).mul(LEAF_VERTICES)).add(1);
    const decode = (lo: Node<'vec3'>, hi: Node<'vec3'>) => lo.mul(255).add(hi.mul(65280)).mul(.32 / 65535).sub(.16);
    const lo = tables[0].load(address(i));
    const hi = tables[1].load(address(i));
    const detail = tables[2].load(address(i));
    const p = decode(lo.xyz, hi.xyz);
    const leaf = decode(tables[0].load(address(footIndex)).xyz, tables[1].load(address(footIndex)).xyz);
    const phase = r.w.sub(id);
    const base = r.xz;
    const foot = base.add(leaf.xz);
    const lattice = foot.sub(WORLD_MIN).mul(.5);
    const cell = floor(lattice);
    const f = lattice.sub(cell);
    const a = terrainY(cell.x, cell.y);
    const b = terrainY(cell.x.add(1), cell.y);
    const cc = terrainY(cell.x, cell.y.add(1));
    const d = terrainY(cell.x.add(1), cell.y.add(1));
    const lower = a.add(b.sub(a).mul(f.x)).add(cc.sub(a).mul(f.y));
    const upper = d.add(cc.sub(d).mul(f.x.oneMinus())).add(b.sub(d).mul(f.y.oneMinus()));
    const y = f.x.add(f.y).lessThanEqual(1).select(lower, upper);
    const distance = length(r.xyz.sub(eye)).max(.01);
    const coverage = reference ? float(1) : smoothstep(.72, 1.25, reach.div(distance));
    visibility.assign(coverage);
    normalDetail.assign(reference ? float(1) : mix(1, .44, smoothstep(.65, 2.55, distance)));
    const h = p.y.sub(leaf.y);
    bladeHeight.assign(h);
    const gust = grassGust(base, phase, wind);
    const sway = wind.wind.xy.mul(h.max(0).pow(2).mul(gust.mul(1.7).add(.2)).mul(wind.wind.z.min(8)));
    const top = base.add(p.xz).add(sway);
    const oct = detail.xy.mul(2).sub(1);
    const nz = abs(oct.x).add(abs(oct.y)).oneMinus();
    const unfolded = nz.lessThan(0).select(abs(oct.yx).oneMinus().mul(sign(oct)), oct);
    const n = normalize(vec3(unfolded, nz));
    pigment.assign(vec3(lo.a, hi.a, detail.b));
    normal.assign(n);
    moisture.assign(texture(water, base.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN)).level(float(0)).r);
    return vec3(top.x, y.sub(SOD_ROOT_INSET_M).add(h), top.y);
  })();
  const native = seasonal(pigment.mul(vec3(.26, .34, .19)), season);
  const contact = mix(.60, 1, smoothstep(.006, .076, bladeHeight));
  material.colorNode = native.mul(contact)
    .mul(mix(1, .91, smoothstep(.45, .95, moisture)));
  if (!reference) material.opacityNode = visibility;
  material.normalNode = transformNormalToView(normalize(mix(vec3(0, 1, 0), normal, normalDetail)));
  material.aoNode = mix(.44, 1, smoothstep(0, .065, bladeHeight));
  material.thicknessColorNode = pigment.mul(vec3(.27, .30, .13));
  material.thicknessAttenuationNode = visibility.mul(.29);
  material.thicknessAmbientNode = float(0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = options.shadows;
  mesh.name = 'world-turf-native';
  return mesh;
}
