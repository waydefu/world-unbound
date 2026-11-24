import {
  BufferAttribute, type DataTexture, DoubleSide, InstancedBufferGeometry, Mesh, MeshSSSNodeMaterial,
  type Node, type UniformNode, type Vector3,
} from 'three/webgpu';
import {
  abs, dot, float, floor, Fn, ivec2, length, mix, normalize, sign, smoothstep, texture,
  transformNormalToView, varyingProperty, vec3, vertexIndex,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import { SOD_LEAVES_PER_CROWN, SOD_ROOT_INSET_M } from '../world/sodRoots';
import { TURF_NATIVE_FADE_END_M, TURF_NATIVE_FADE_START_M } from '../world/turfPopulation';
import { grassCarpetColour, seasonal } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';
import { terrainHeightNode } from './terrainHeightNode';
import { CROWN_VERTICES, LEAF_VERTICES, MASTER_WIDTH } from './worldTurfAssets';

export const TURF_REDUCED_TRIANGLES_PER_LEAF = 10;
const REDUCED_ROWS = [0, 2, 3] as const;
const FULL_ROWS = [0, 1, 2, 3, 4, 5] as const;

export function worldTurfGeometry(reduced = false): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(CROWN_VERTICES * 3), 3));
  const indices: number[] = [];
  const rows = reduced ? REDUCED_ROWS : FULL_ROWS;
  for (let leaf = 0; leaf < SOD_LEAVES_PER_CROWN; leaf++) {
    const base = leaf * LEAF_VERTICES;
    for (let row = 1; row < rows.length; row++) {
      const a = base + rows[row - 1] * 3;
      const b = base + rows[row] * 3;
      indices.push(a, b, b + 1, a, b + 1, a + 1, a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
    }
    const last = base + rows[rows.length - 1] * 3;
    indices.push(last, base + 18, last + 1, last + 1, base + 18, last + 2);
  }
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
  geometry.instanceCount = 0;
  return geometry;
}

export interface TurfMeshOptions {
  master: readonly DataTexture[]; height: DataTexture; water: DataTexture;
  eye: UniformNode<'vec3', Vector3>; season: UniformNode<'vec3', Vector3>; reach: UniformNode<'float', number>;
  wind: GrassWindUniforms; reference: boolean; shadows: boolean;
  unfaded: boolean;
  ribbonHandoff?: boolean;
  proxyLeaf?: boolean;
  surfaceFrame?: boolean;
}

/** Shortest rotation from +Y to the upward terrain normal; lengths and the leaf fold are preserved. */
function fromTurfPlane(v: Node<'vec3'>, n: Node<'vec3'>) {
  const along = dot(n.xz, v.xz).toVar();
  const lateral = v.xz.add(n.xz.mul(v.y.sub(along.div(n.y.add(1)))));
  return vec3(lateral.x, n.y.mul(v.y).sub(along), lateral.y);
}

export function nativeTurfCoverage(distance: Node<'float'>) {
  return smoothstep(TURF_NATIVE_FADE_START_M, TURF_NATIVE_FADE_END_M, distance).oneMinus();
}

export function worldTurfMesh(geometry: InstancedBufferGeometry, root: Node<'vec4'>, options: TurfMeshOptions): Mesh {
  const { master, height, water, eye, season, reach, wind, reference, unfaded, ribbonHandoff, proxyLeaf } = options;
  const material = new MeshSSSNodeMaterial({ side: DoubleSide, roughness: .49, specularIntensity: .26, alphaHash: !unfaded });
  const pigment = varyingProperty('vec3', 'worldTurfPigment');
  const normal = varyingProperty('vec3', 'worldTurfNormal');
  const bladeHeight = varyingProperty('float', 'worldTurfHeight');
  const moisture = varyingProperty('float', 'worldTurfMoisture');
  const visibility = varyingProperty('float', 'worldTurfVisibility');
  const normalDetail = varyingProperty('float', 'worldTurfNormalDetail');
  const terrainNormal = varyingProperty('vec3', 'worldTurfTerrainNormal');
  const canopyBlend = ribbonHandoff ? varyingProperty('float', 'worldTurfCanopyBlend') : null;
  const shadingBlend = ribbonHandoff ? varyingProperty('float', 'worldTurfShadingBlend') : null;
  const tables = master.map(tex => texture(tex));
  const terrainY = terrainHeightNode(height);
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
    const ground = terrainY.withNormal(foot);
    const y = ground.y;
    const distance = length(r.xyz.sub(eye)).max(.01);
    const combined = smoothstep(1.2, 5.5, distance);
    canopyBlend?.assign(combined);
    shadingBlend?.assign(smoothstep(5.0, TURF_NATIVE_FADE_END_M, distance));
    const coverage = unfaded ? float(1) : ribbonHandoff ? nativeTurfCoverage(distance) : smoothstep(.72, 1.25, reach.div(distance));
    visibility.assign(coverage);
    normalDetail.assign(reference ? float(1) : mix(1, ribbonHandoff ? .24 : .48, smoothstep(1.2, 7.5, distance)));
    const h = p.y.sub(leaf.y);
    bladeHeight.assign(h);
    const gust = grassGust(base, phase, wind);
    const sway = wind.wind.xy.mul(h.max(0).pow(2).mul(gust.mul(1.7).add(.2)).mul(wind.wind.z.min(8)));
    const relative = vec3(p.x.sub(leaf.x).add(sway.x), h, p.z.sub(leaf.z).add(sway.y));
    const offset = options.surfaceFrame ? fromTurfPlane(relative, ground.normal).toVar() : relative;
    const top = options.surfaceFrame ? foot.add(offset.xz) : base.add(p.xz).add(sway);
    const oct = detail.xy.mul(2).sub(1);
    const nz = abs(oct.x).add(abs(oct.y)).oneMinus();
    const unfolded = nz.lessThan(0).select(abs(oct.yx).oneMinus().mul(sign(oct)), oct);
    const windTilt = vec3(sway.x.mul(3.2), 0, sway.y.mul(3.2));
    const n = normalize(vec3(unfolded, nz).add(windTilt));
    terrainNormal.assign(normalize(ground.normal.add(windTilt.mul(.45))));
    pigment.assign(vec3(lo.a, hi.a, detail.b));
    normal.assign(options.surfaceFrame ? fromTurfPlane(n, ground.normal) : n);
    moisture.assign(texture(water, base.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN)).level(float(0)).r);
    return vec3(top.x, y.sub(SOD_ROOT_INSET_M).add(offset.y), top.y);
  })();
  const native = seasonal(pigment.mul(vec3(.26, .34, .19)), season);
  const contact = mix(.58, 1, smoothstep(.005, .076, bladeHeight));
  const canopy = grassCarpetColour(season).mul(proxyLeaf ? mix(.72, .94, pigment.g) : mix(.82, 1.08, pigment.g)).mul(mix(.76, 1.06, contact));
  const colour = canopyBlend ? mix(native.mul(contact), canopy, canopyBlend) : native.mul(contact);
  material.colorNode = colour
    .mul(mix(1, .91, smoothstep(.45, .95, moisture)));
  if (!unfaded) material.opacityNode = visibility;
  material.normalNode = transformNormalToView(normalize(mix(terrainNormal, normal, normalDetail)));
  const ao = mix(.42, 1, smoothstep(0, .068, bladeHeight));
  material.aoNode = shadingBlend ? mix(ao, .86, shadingBlend) : ao;
  if (shadingBlend) {
    material.roughnessNode = mix(.49, .82, shadingBlend);
    material.specularIntensityNode = mix(.26, proxyLeaf ? .08 : .15, shadingBlend);
  }
  material.thicknessColorNode = pigment.mul(vec3(.27, .30, .13));
  material.thicknessAttenuationNode = visibility.mul(proxyLeaf ? .12 : .29);
  material.thicknessAmbientNode = float(0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = options.shadows;
  mesh.name = 'world-turf-native';
  return mesh;
}
