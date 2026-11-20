import { DoubleSide, MeshLambertNodeMaterial, type DataTexture, type Node } from 'three/webgpu';
import {
  Fn, attribute, cos, float, length, mix, normalGeometry, normalize, positionGeometry, sin, smoothstep,
  texture, transformNormalToView, uv, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { FLOWER_CELL_M, SPECIMEN_CELL_M } from '../world/grassCells';
import { grassField, type GrassInputs, type GrassLayout, type GrassUniforms } from './grassField';
import { grassCarpetColour, grassCarpetWeight, seasonal } from './grassPalette';
import type { GrassKind } from './grassMaterial';

/** Grow the same model at stable terrain roots. Wind deforms positions and leaves the basal sheath fixed. */
export function createSpecimenMaterial(kind: GrassKind, inputs: GrassInputs, u: GrassUniforms, layout: GrassLayout, tuft: DataTexture | null) {
  const colour = varyingProperty('vec3', `specimenColour_${kind}`);
  const normal = varyingProperty('vec3', `specimenNormal_${kind}`);
  const flower = kind === 'card';
  const position = Fn(() => {
    const index = attribute('plantIndex', 'float');
    const field = grassField(inputs, u, layout, flower ? 7919 : 0, null, index, flower ? FLOWER_CELL_M : SPECIMEN_CELL_M);
    const weight = grassCarpetWeight(field.veg.r);
    const exists = field.rnd(8).lessThan(weight.mul(flower ? 0.68 : 1)).select(1, 0);
    const near = u.rings.x;
    const distance = field.dist;
    const reach = tuft ? u.rings.w : near;
    let fade: Node<'float'> = float(1).sub(smoothstep(reach.mul(tuft ? 0.48 : 0.62), reach, distance));
    if (flower) {
      fade = float(1).sub(smoothstep(u.rings.y.mul(0.66), u.rings.y, distance));
    } else if (!tuft) {
      fade = fade.mul(float(1).sub(smoothstep(near.mul(0.35), near.mul(0.5), field.cellDist)));
    }
    const yaw = field.rnd(9).mul(2 * Math.PI);
    const c = cos(yaw);
    const s = sin(yaw);
    const local = positionGeometry;
    const scale = field.rnd(4).mul(0.28).add(0.86).mul(exists).mul(fade);
    const rotate = (x: typeof distance, z: typeof distance) => vec2(c.mul(x).sub(s.mul(z)), s.mul(x).add(c.mul(z)));
    const lean = field.lean(float(flower ? 0.84 : 0.92));
    const flex = length(local).pow(2).mul(flower ? 1.2 : 6.0);
    const offset = rotate(local.x, local.z).add(field.windDir.mul(flex.mul(lean))).mul(scale);
    const lifted = local.y.sub(flex.mul(lean.mul(lean)).mul(0.28)).mul(scale);
    // Use the mesh's actual creases, with the ground normal softening the light at the carpet base.
    if (tuft) {
      normal.assign(field.terrainNormal);
    } else {
      const n = normalGeometry;
      const xz = rotate(n.x, n.z);
      normal.assign(normalize(mix(field.terrainNormal, vec3(xz.x, n.y, xz.y), flower ? 0.72 : 0.46)));
    }
    const base = grassCarpetColour(u.season);
    const tint = tuft ? base : seasonal(attribute('specimenColour', 'vec3'), u.season);
    const wet = float(1).sub(u.wetness.mul(0.45));
    const lift = flower ? float(1) : mix(0.94, 1.27, smoothstep(0.006, 0.078, local.y));
    colour.assign(mix(base, tint, flower ? 1 : 0.78)
      .mul(field.rnd(15).mul(0.16).add(0.94)).mul(wet).mul(lift));
    const soil = field.root.y.add(field.rootInset).sub(0.005);
    return vec3(field.root.x.add(offset.x), soil.add(lifted), field.root.z.add(offset.y));
  });
  const material = new MeshLambertNodeMaterial({ side: DoubleSide });
  material.name = flower ? 'grass-flowering-specimens' : tuft ? 'grass-fescue-tufts' : 'grass-fescue-mesh';
  material.positionNode = position();
  if (tuft) {
    const leaf = texture(tuft, uv());
    material.opacityNode = leaf.r;
    material.alphaTest = 0.31;
    material.alphaToCoverage = true;
    material.colorNode = colour.mul(leaf.g.mul(0.8).add(0.42));
  } else {
    material.colorNode = colour;
  }
  material.normalNode = transformNormalToView(normal);
  return material;
}
