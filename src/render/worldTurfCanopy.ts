import type { DataTexture, Node } from 'three/webgpu';
import { abs, dFdx, dFdy, dot, exp, length, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { CANOPY_AREA_RANGE } from './worldTurfAssets';
import { grassCrownField } from './grassPalette';
import { canopyWind, type GrassWindUniforms } from './grassWind';

/** Three rooted depth layers preserve projected leaf area for overhead and grazing views. */
export function worldTurfCanopy(
  layers: readonly DataTexture[], noise: DataTexture, wind: DataTexture, motion: GrassWindUniforms,
  xz: Node<'vec2'>, dist: Node<'float'>, normal: Node<'vec3'>, macro: Node<'float'>, multiscale = false,
) {
  const { gust, velocity } = canopyWind(xz, dist, wind, motion);
  const speed = length(velocity);
  const dir = velocity.div(speed.max(.1));
  const bend = speed.mul(.064).add(gust.mul(.57)).min(1);
  const sight = positionWorld.normalize();
  const incidence = abs(dot(sight, normal)).max(.16);
  const slopeRay = sight.xz.mul(normal.y.max(.15).div(incidence));
  const phase = vec2(sin(xz.y.mul(.71).add(xz.x.mul(.29))), sin(xz.x.mul(.83).sub(xz.y.mul(.32)))).mul(.53);
  const uv = xz.add(phase);
  const dX = dFdx(uv);
  const dY = dFdy(uv);
  const viewAxis = abs(sight);
  const sample = (index: number, h: number) => {
    const at = uv.sub(slopeRay.mul(h)).sub(dir.mul(bend).mul(5.7 * h * h));
    const layer = texture(layers[index], at).grad(dX, dY);
    const area = length(layer.rgb.mul(viewAxis)).mul(CANOPY_AREA_RANGE).div(incidence);
    return { pass: exp(area.mul(-1)), green: layer.a };
  };
  const root = sample(0, .014);
  const middle = sample(1, .040);
  const tip = sample(2, .069);
  const ground = root.pass.mul(middle.pass).mul(tip.pass);
  const light = tip.pass.oneMinus().mul(tip.green.mul(1.32)).add(middle.pass.oneMinus().mul(tip.pass).mul(middle.green))
    .add(root.pass.oneMinus().mul(tip.pass).mul(middle.pass).mul(root.green.mul(.68)));
  const crowns = grassCrownField(noise, xz, macro);
  const grazing = smoothstep(.09, .45, incidence).oneMinus();
  // Retain aggregated canopy relief after the individual leaf mips average out.
  const patchUv = uv.sub(dir.mul(bend).mul(.047)).mul(.31);
  const foliage = texture(layers[2], patchUv).grad(dX.mul(.31), dY.mul(.31));
  const patch = length(foliage.rgb).mul(CANOPY_AREA_RANGE).min(1.25);
  let tone = light.div(ground.oneMinus().max(.15)).mul(3.74).add(grazing.mul(.18))
    .add(patch.sub(.26).mul(.17)).add(crowns.a.sub(.5).mul(.054))
    .add(dot(dir, sight.xz).mul(bend).mul(.13)).clamp(.54, 1.45);
  let lean = dir.mul(bend).mul(.091).sub(crowns.rg.mul(2).sub(1).mul(mix(.037, .021, smoothstep(6, 23, dist))));
  if (multiscale) {
    // Once leaf frequencies mip away, retain broader variations in the source canopy's height and pigment.
    const bent = patchUv;
    const coarseUv = vec2(bent.x.mul(.79).sub(bent.y.mul(.62)), bent.x.mul(.62).add(bent.y.mul(.79))).mul(.36);
    const coarse = texture(layers[2], coarseUv).grad(dFdx(coarseUv), dFdy(coarseUv));
    const footprint = length(dX).max(length(dY));
    const closer = smoothstep(.035, .24, footprint);
    const broad = mix(foliage, coarse, closer);
    const leaflet = broad.a.sub(.24).mul(.57).add(length(broad.rgb).mul(CANOPY_AREA_RANGE).sub(.36).mul(.13));
    tone = tone.mul(.88).add(leaflet.clamp(-.13, .17)).add(gust.mul(.10)).clamp(.52, 1.45);
    lean = lean.add(broad.rb.sub(broad.g).mul(.19 * CANOPY_AREA_RANGE));
  }
  return { tone, lean: vec3(lean.x, 0, lean.y), soilGaps: ground.mul(.18).add(.008).min(.13) };
}
