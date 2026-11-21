import { DoubleSide, MeshLambertNodeMaterial, type DataTexture, type Node } from 'three/webgpu';
import {
  Fn, attribute, cos, dot, float, length, mix, normalGeometry, normalize, positionGeometry, sin, smoothstep,
  texture, transformNormalToView, uv, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { FLOWER_CELL_M, SPECIMEN_CELL_M } from '../world/grassCells';
import { grassField, type GrassInputs, type GrassLayout, type GrassUniforms } from './grassField';
import { grassCarpetColour, grassCarpetWeight, grassCrownField, seasonal } from './grassPalette';
import type { GrassKind } from './grassMaterial';

/** Grow the same model at stable terrain roots. Wind deforms positions and leaves the basal sheath fixed. */
export function createSpecimenMaterial(kind: GrassKind, inputs: GrassInputs, u: GrassUniforms, layout: GrassLayout, tuft: DataTexture | null) {
  const colour = varyingProperty('vec3', `specimenColour_${kind}`);
  const normal = varyingProperty('vec3', `specimenNormal_${kind}`);
  const flower = kind === 'card';
  const tuftCoverage = tuft ? varyingProperty('float', 'fescueTuftCoverage') : null;
  const position = Fn(() => {
    const index = attribute('plantIndex', 'float');
    const field = grassField(inputs, u, layout, flower ? 7919 : 0, null, index, flower ? FLOWER_CELL_M : SPECIMEN_CELL_M);
    const weight = grassCarpetWeight(field.veg.r);
    const exists = field.rnd(8).lessThan(weight.mul(flower ? 0.68 : 1)).select(1, 0);
    const near = u.rings.x;
    const distance = field.dist;
    const reach = tuft ? u.rings.w : near;
    // Stagger the handoff across neighbouring crowns while keeping its outer edge inside the culling range.
    const start = tuft ? reach.mul(field.rnd(5).mul(0.21).add(0.43)) : reach.mul(0.62);
    let fade: Node<'float'> = float(1).sub(smoothstep(start, reach, distance));
    if (flower) {
      fade = float(1).sub(smoothstep(u.rings.y.mul(0.66), u.rings.y, distance));
    } else if (!tuft) {
      fade = fade.mul(float(1).sub(smoothstep(near.mul(0.35), near.mul(0.5), field.cellDist)));
    }
    if (tuftCoverage) tuftCoverage.assign(smoothstep(0, 0.58, fade));
    const yaw = field.rnd(9).mul(2 * Math.PI);
    const c = cos(yaw);
    const s = sin(yaw);
    const local = positionGeometry;
    const scale = field.rnd(4).mul(tuft ? 0.16 : 0.28).add(tuft ? 0.92 : 0.86).mul(exists);
    // Keep overlapping footprints until the top strands have lowered into the terrain carpet.
    const width = scale.mul(tuft ? smoothstep(0, 0.50, fade) : fade);
    const height = scale.mul(tuft ? fade.mul(0.92).add(0.08).mul(smoothstep(0, 0.12, fade)) : fade);
    const rotate = (x: typeof distance, z: typeof distance) => vec2(c.mul(x).sub(s.mul(z)), s.mul(x).add(c.mul(z)));
    const lean = field.lean(float(flower ? 0.84 : 0.92));
    const flex = length(local).pow(2).mul(flower ? 1.2 : 6.0);
    const offset = rotate(local.x, local.z).add(field.windDir.mul(flex.mul(lean))).mul(width);
    const lifted = local.y.sub(flex.mul(lean.mul(lean)).mul(0.28)).mul(height);
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
    const lift = flower ? float(1) : mix(tuft ? 0.94 : 0.79, tuft ? 1.09 : 1.22, smoothstep(0.006, 0.071, local.y));
    const crowns = flower ? float(1) : grassCrownField(inputs.noise, field.root.xz, field.macro).level(float(0)).a.sub(0.5).mul(0.16).add(1);
    colour.assign(mix(base, tint, flower ? 1 : 0.78)
      .mul(field.rnd(15).mul(0.12).add(0.96)).mul(wet).mul(lift).mul(crowns));
    const soil = field.root.y.add(field.rootInset).sub(0.005);
    // Fit the whole 27 cm side projection to the ground slope so seams stay in the sward.
    const baseHeight = tuft ? soil.add(dot(offset, field.rootSlope)) : soil;
    return vec3(field.root.x.add(offset.x), baseHeight.add(lifted), field.root.z.add(offset.y));
  });
  const material = new MeshLambertNodeMaterial({ side: DoubleSide });
  material.name = flower ? 'grass-flowering-specimens' : tuft ? 'grass-fescue-tufts' : 'grass-fescue-mesh';
  material.positionNode = position();
  if (tuft && tuftCoverage) {
    const leaf = texture(tuft, uv());
    material.opacityNode = leaf.r.mul(tuftCoverage);
    material.alphaTest = 0.31;
    material.alphaToCoverage = true;
    const leafLight = leaf.g.mul(0.42).add(0.63);
    material.colorNode = colour.mul(mix(1, leafLight, tuftCoverage));
  } else {
    material.colorNode = colour;
  }
  material.normalNode = transformNormalToView(normal);
  return material;
}
