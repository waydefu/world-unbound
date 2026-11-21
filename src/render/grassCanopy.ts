import type { DataTexture, Node } from 'three/webgpu';
import { dFdx, dFdy, dot, float, length, mix, positionWorld, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { SWARD_COVER_METRES } from '../world/grassCover';
import { grassCrownField } from './grassPalette';
import { canopyWind, type GrassWindUniforms } from './grassWind';

export interface GrassCanopyWind {
  readonly map: DataTexture;
  readonly motion: GrassWindUniforms;
  readonly depth?: readonly DataTexture[];
  readonly relief?: boolean;
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
  // Offset the shared atlas phase in world space to keep its square repeat from appearing at height.
  const phase = vec2(sin(xz.y.mul(0.88).add(xz.x.mul(0.23))), sin(xz.x.mul(0.79).sub(xz.y.mul(0.33)))).mul(0.58);
  const uv = xz.sub(drift).div(SWARD_COVER_METRES).add(phase);
  // Project two heights through the same leaf tile. The upper fibre layers over the lower one at grazing angles.
  const offset = sight.xz.div(angle).div(SWARD_COVER_METRES);
  const dx = dFdx(uv);
  const dy = dFdy(uv);
  const sightXZ = sight.xz;
  const brushed = dot(dir, sightXZ).mul(bend);
  const crowns = grassCrownField(noise, xz, macro);
  const lowFibre = crowns.a.sub(0.5).mul(0.65).add(crowns.b.sub(0.5).mul(0.35));
  // Keep a little relief after the millimetre-wide leaves have averaged out in the mip chain.
  const transfer = smoothstep(6, 23, dist);
  const crownShade = lowFibre.mul(mix(0.14, 0.30, transfer)).add(macro.mul(0.060));
  const relief = crowns.rg.mul(2).sub(1).mul(mix(0.050, 0.12, transfer));
  if (lowCost) {
    const lowerUv = uv.sub(offset.mul(0.018)).mul(0.54);
    const leaf = texture(tile, lowerUv).grad(dx.mul(0.54), dy.mul(0.54));
    const fibre = leaf.ba.mul(2).sub(1);
    const fibreShade = dot(fibre, sight.xz).mul(0.12).add(leaf.r.sub(0.73).mul(0.72));
    const betweenLeaves = smoothstep(0.36, 0.75, leaf.g).sub(0.65).mul(0.25);
    const tone = float(1).add(fibreShade).add(crownShade).add(betweenLeaves).add(brushed.mul(0.09)).add(gust.sub(0.28).mul(0.08)).clamp(0.81, 1.17);
    const lean = dir.mul(bend).mul(0.045).add(fibre.mul(mix(0.12, 0.065, transfer))).sub(relief);
    const soilGaps = float(1).sub(smoothstep(0.24, 0.56, leaf.g)).mul(0.095).add(0.014).mul(angle);
    return { tone, lean: vec3(lean.x, 0, lean.y), soilGaps };
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
  const betweenLeaves = smoothstep(0.37, 0.76, leaf.g).sub(0.65).mul(0.31);
  const tone = float(1).add(fibreShade).add(crownShade).add(betweenLeaves)
    .add(brushed.mul(0.12)).add(gust.sub(0.28).mul(0.12)).clamp(0.79, 1.19);
  const lean = dir.mul(bend).mul(0.065).add(fibre.mul(mix(0.16, 0.09, transfer))).sub(relief);
  const soilGaps = float(1).sub(smoothstep(0.24, 0.56, leaf.g)).mul(0.095).add(0.014).mul(angle);
  return { tone, lean: vec3(lean.x, 0, lean.y), soilGaps };
}
