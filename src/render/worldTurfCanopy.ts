import type { DataTexture, Node } from 'three/webgpu';
import { abs, dFdx, dFdy, dot, exp, length, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { CANOPY_AREA_RANGE } from './worldTurfAssets';
import { grassCrownField } from './grassPalette';
import { canopyWind, type GrassWindUniforms } from './grassWind';

/** Three rooted depth layers preserve projected leaf area for overhead and grazing views. */
export function worldTurfCanopy(
  layers: readonly DataTexture[], noise: DataTexture, wind: DataTexture, motion: GrassWindUniforms,
  xz: Node<'vec2'>, dist: Node<'float'>, normal: Node<'vec3'>, macro: Node<'float'>, multiscale = false, filtered = false,
) {
  const { gust, velocity } = canopyWind(xz, dist, wind, motion);
  const speed = length(velocity);
  const dir = velocity.div(speed.max(.1));
  const bend = speed.mul(.064).add(gust.mul(.57)).min(1);
  const sight = positionWorld.normalize();
  const incidence = abs(dot(sight, normal)).max(.16);
  const slopeRay = sight.xz.mul(normal.y.max(.15).div(incidence));
  const crowns = grassCrownField(noise, xz, macro);
  const phase = vec2(sin(xz.y.mul(.71).add(xz.x.mul(.29))), sin(xz.x.mul(.83).sub(xz.y.mul(.32)))).mul(.53);
  // Break up correlated repeats in the one-metre bake using world-fixed crown variation.
  const uv = filtered ? xz.add(crowns.rg.sub(.5).mul(.72)) : xz.add(phase);
  const dX = dFdx(uv);
  const dY = dFdy(uv);
  const viewAxis = abs(sight);
  const sample = (index: number, h: number) => {
    const at = uv.sub(slopeRay.mul(h)).sub(dir.mul(bend).mul(5.7 * h * h));
    // Include the footprint of the sloped ray and the moving leaf tips in the mip choice.
    const layer = texture(layers[index], at).grad(filtered ? dFdx(at) : dX, filtered ? dFdy(at) : dY);
    const directional = filtered ? dot(layer.rgb, viewAxis).mul(.78) : length(layer.rgb.mul(viewAxis));
    const area = directional.mul(CANOPY_AREA_RANGE).div(incidence);
    return { pass: exp(area.mul(-1)), green: layer.a, dir: layer.rgb };
  };
  const root = sample(0, .014);
  const middle = sample(1, .040);
  const tip = sample(2, .069);
  const ground = root.pass.mul(middle.pass).mul(tip.pass);
  // Emergent crest and deep trough contrast from the three height layers without extra texture fetches.
  const crestRelief = tip.pass.oneMinus().sub(root.pass.oneMinus().mul(tip.pass).mul(.42));
  const light = tip.pass.oneMinus().mul(tip.green.mul(1.36)).add(middle.pass.oneMinus().mul(tip.pass).mul(middle.green))
    .add(root.pass.oneMinus().mul(tip.pass).mul(middle.pass).mul(root.green.mul(.62)));
  const grazing = smoothstep(.09, .48, incidence).oneMinus();
  // Retain aggregated canopy relief after the individual leaf mips average out.
  const patchUv = uv.sub(dir.mul(bend).mul(.047)).mul(.31);
  const foliage = texture(layers[2], patchUv).grad(dX.mul(.31), dY.mul(.31));
  const patch = length(foliage.rgb).mul(CANOPY_AREA_RANGE).min(1.25);
  let tone = light.div(ground.oneMinus().max(.15)).mul(3.74).add(grazing.mul(.21))
    .add(crestRelief.mul(.12)).add(patch.sub(.26).mul(.21)).add(crowns.a.sub(.5).mul(.095))
    .add(dot(dir, sight.xz).mul(bend).mul(.15)).clamp(.50, 1.48);
  const microSway = tip.dir.rb.sub(root.dir.rb).mul(.18);
  let lean = dir.mul(bend).mul(.125).add(microSway).sub(crowns.rg.mul(2).sub(1).mul(mix(.065, .038, smoothstep(6, 28, dist))));
  if (multiscale) {
    // Once leaf frequencies mip away, retain broader variations in the source canopy's height and pigment.
    const bent = patchUv;
    const coarseUv = vec2(bent.x.mul(.79).sub(bent.y.mul(.62)), bent.x.mul(.62).add(bent.y.mul(.79))).mul(.36);
    const coarse = texture(layers[2], coarseUv).grad(dFdx(coarseUv), dFdy(coarseUv));
    const footprint = length(dX).max(length(dY));
    const closer = smoothstep(.035, .24, footprint);
    const broad = mix(foliage, coarse, closer);
    const leaflet = broad.a.sub(.24).mul(.62).add(length(broad.rgb).mul(CANOPY_AREA_RANGE).sub(.36).mul(.16));
    tone = tone.mul(.88).add(leaflet.clamp(-.15, .19)).add(gust.mul(.12)).clamp(.50, 1.48);
    lean = lean.add(broad.rb.sub(broad.g).mul(.24 * CANOPY_AREA_RANGE));
    if (filtered) {
      const silhouette = dot(broad.rgb, viewAxis).mul(CANOPY_AREA_RANGE).clamp(0, 1);
      tone = tone.add(silhouette.sub(.29).mul(.16)).clamp(.50, 1.50);
      lean = lean.add(dir.mul(bend).mul(silhouette.mul(.115)));
    }
  }
  return { tone, lean: vec3(lean.x, 0, lean.y), soilGaps: ground.mul(.18).add(.008).min(.13) };
}
