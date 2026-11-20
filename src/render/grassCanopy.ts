import type { DataTexture, Node } from 'three/webgpu';
import { dFdx, dFdy, dot, float, length, mix, positionWorld, smoothstep, texture, vec3 } from 'three/tsl';
import { GRASS_COVER_METRES } from '../world/grassCover';
import { canopyWind, type GrassWindUniforms } from './grassWind';

export interface GrassCanopyWind {
  readonly map: DataTexture;
  readonly motion: GrassWindUniforms;
}

/** Give the continuous turf surface directional fibre, shallow relief and the same gusts as the blades. */
export function grassCanopy(
  tile: DataTexture, surfaceWind: GrassCanopyWind, xz: Node<'vec2'>, dist: Node<'float'>, groundNormal: Node<'vec3'>,
) {
  const { gust, velocity } = canopyWind(xz, dist, surfaceWind.map, surfaceWind.motion);
  const speed = length(velocity);
  const dir = velocity.div(speed.max(0.1));
  const bend = speed.div(7).mul(0.46).add(gust.mul(0.75)).min(1);
  const sight = positionWorld.normalize();
  const angle = dot(sight, groundNormal).abs().max(0.24);
  const drift = dir.mul(bend).mul(0.016);
  const uv = xz.sub(drift).div(GRASS_COVER_METRES);
  // Project two heights through the same leaf tile. The upper fibre layers over the lower one at grazing angles.
  const offset = sight.xz.div(angle).div(GRASS_COVER_METRES);
  const dx = dFdx(uv);
  const dy = dFdy(uv);
  const lower = texture(tile, uv.sub(offset.mul(0.018))).grad(dx, dy);
  const upper = texture(tile, uv.sub(offset.mul(0.061))).grad(dx, dy);
  const leaf = mix(lower, upper, smoothstep(0.42, 0.72, upper.g));
  const fibre = leaf.ba.mul(2).sub(1);
  const sightXZ = sight.xz;
  const brushed = dot(dir, sightXZ).mul(bend);
  const fibreShade = dot(fibre, sightXZ).mul(0.14).add(leaf.r.sub(0.69).mul(0.65));
  // Mips take the fine grain out of the image at distance. The broad bending wave stays on the terrain.
  const tone = float(1).add(fibreShade).add(brushed.mul(0.13)).add(gust.sub(0.28).mul(0.12));
  const lean = dir.mul(bend).mul(0.065).add(fibre.mul(0.045));
  return { tone, lean: vec3(lean.x, 0, lean.y) };
}
