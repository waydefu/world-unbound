import type { DataTexture, Node } from 'three/webgpu';
import { dFdx, dFdy, dot, float, length, mix, positionWorld, smoothstep, texture, vec3 } from 'three/tsl';
import { SWARD_COVER_METRES } from '../world/grassCover';
import { grassCrownField } from './grassPalette';
import { canopyWind, type GrassWindUniforms } from './grassWind';

export interface GrassCanopyWind {
  readonly map: DataTexture;
  readonly motion: GrassWindUniforms;
}

/** Give the continuous turf surface directional fibre, shallow relief and the same gusts as the blades. */
export function grassCanopy(
  tile: DataTexture, noise: DataTexture, surfaceWind: GrassCanopyWind, xz: Node<'vec2'>,
  dist: Node<'float'>, groundNormal: Node<'vec3'>, macro: Node<'float'>, lowCost = false,
) {
  const { gust, velocity } = canopyWind(xz, dist, surfaceWind.map, surfaceWind.motion);
  const speed = length(velocity);
  const dir = velocity.div(speed.max(0.1));
  const bend = speed.div(7).mul(0.46).add(gust.mul(0.75)).min(1);
  const sight = positionWorld.normalize();
  const angle = dot(sight, groundNormal).abs().max(0.24);
  const drift = dir.mul(bend).mul(0.016);
  const uv = xz.sub(drift).div(SWARD_COVER_METRES);
  // Project two heights through the same leaf tile. The upper fibre layers over the lower one at grazing angles.
  const offset = sight.xz.div(angle).div(SWARD_COVER_METRES);
  const dx = dFdx(uv);
  const dy = dFdy(uv);
  const sightXZ = sight.xz;
  const brushed = dot(dir, sightXZ).mul(bend);
  if (lowCost) {
    const lowerUv = uv.sub(offset.mul(0.018)).mul(0.54);
    const leaf = texture(tile, lowerUv).grad(dx.mul(0.54), dy.mul(0.54));
    const fibre = leaf.ba.mul(2).sub(1);
    const fibreShade = dot(fibre, sight.xz).mul(0.12).add(leaf.r.sub(0.73).mul(0.72));
    const tone = float(1).add(fibreShade).add(macro.mul(0.065)).add(brushed.mul(0.09)).add(gust.sub(0.28).mul(0.08)).clamp(0.84, 1.14);
    const lean = dir.mul(bend).mul(0.045).add(fibre.mul(0.035));
    return { tone, lean: vec3(lean.x, 0, lean.y) };
  }
  // The lower layer represents groups of blades. Its wider footprint keeps the same fibre pattern legible
  // where individual leaves in the upper layer already filter together.
  const lowerUv = uv.sub(offset.mul(0.018)).mul(0.54);
  const lower = texture(tile, lowerUv).grad(dx.mul(0.54), dy.mul(0.54));
  const upper = texture(tile, uv.sub(offset.mul(0.061))).grad(dx, dy);
  const upperVisibility = smoothstep(0.42, 0.72, upper.g).mul(mix(1, 0.35, smoothstep(9, 24, dist)));
  const leaf = mix(lower, upper, upperVisibility);
  const fibre = leaf.ba.mul(2).sub(1);
  const fibreShade = dot(fibre, sightXZ).mul(0.16).add(leaf.r.sub(0.73).mul(0.60));
  const crowns = grassCrownField(noise, xz, macro);
  const lowFibre = crowns.a.sub(0.5).mul(0.65).add(crowns.b.sub(0.5).mul(0.35));
  // Keep the patch relief visible as the individual blades become subpixel or the tuft meshes fade.
  const transfer = smoothstep(6, 23, dist);
  const crownShade = lowFibre.mul(mix(0.15, 0.38, transfer)).add(macro.mul(0.060));
  const betweenLeaves = smoothstep(0.37, 0.76, leaf.g).sub(0.65).mul(0.095);
  const tone = float(1).add(fibreShade).add(crownShade).add(betweenLeaves)
    .add(brushed.mul(0.12)).add(gust.sub(0.28).mul(0.12)).clamp(0.79, 1.19);
  const relief = crowns.rg.mul(2).sub(1).mul(mix(0.055, 0.17, transfer));
  const lean = dir.mul(bend).mul(0.065).add(fibre.mul(0.050)).sub(relief);
  return { tone, lean: vec3(lean.x, 0, lean.y) };
}
