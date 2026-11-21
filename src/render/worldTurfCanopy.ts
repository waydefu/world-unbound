import type { DataTexture, Node } from 'three/webgpu';
import { abs, dFdx, dFdy, dot, exp, length, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { CANOPY_AREA_RANGE } from './worldTurfAssets';
import { grassCrownField } from './grassPalette';
import { canopyWind, type GrassWindUniforms } from './grassWind';

/** Three rooted depth layers preserve projected leaf area for overhead and grazing views. */
export function worldTurfCanopy(
  layers: readonly DataTexture[], noise: DataTexture, wind: DataTexture, motion: GrassWindUniforms,
  xz: Node<'vec2'>, dist: Node<'float'>, normal: Node<'vec3'>, macro: Node<'float'>,
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
  const tone = light.div(ground.oneMinus().max(.15)).mul(4.55).add(grazing.mul(.24))
    .add(crowns.a.sub(.5).mul(.054)).add(dot(dir, sight.xz).mul(bend).mul(.13)).clamp(.65, 1.65);
  const lean = dir.mul(bend).mul(.091).sub(crowns.rg.mul(2).sub(1).mul(mix(.037, .021, smoothstep(6, 23, dist))));
  return { tone, lean: vec3(lean.x, 0, lean.y), soilGaps: ground.mul(.18).add(.008).min(.13) };
}
