import type { DataTexture, Node, Texture } from 'three/webgpu';
import { exp, float, mix, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';

export interface SoilSurfaceTextures {
  readonly albedo: Texture;
  readonly relief: Texture;
  readonly water: DataTexture;
}

/** Ground103 photogrammetry, with diffuse darkening and a separate liquid-film response. */
export function soilSurface(source: SoilSurfaceTextures, xz: Node<'vec2'>, distance: Node<'float'>) {
  // Slow world-space changes in phase break the scan's repeats without stretching individual grains by much.
  const uv = xz.div(1.2).add(vec2(sin(xz.y.mul(0.64)), sin(xz.x.mul(0.73).add(1.6))).mul(0.41));
  const a = texture(source.albedo, uv);
  const slope = texture(source.relief, uv);
  const water = texture(source.water, xz.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN));
  // Wet reflectance responds fastest to added water near the dry end and approaches a wet asymptote.
  const damp = float(1).sub(exp(water.r.mul(-3.4))).mul(water.a);
  const film = smoothstep(0.010, 0.18, water.b).mul(water.a);
  const detail = float(1).sub(smoothstep(2, 45, distance));
  const aggregates = slope.a.sub(0.5).mul(0.09).mul(detail);
  const albedo = a.rgb.mul(mix(1, 0.52, damp).mul(aggregates.add(1)));
  const dry = a.a.mul(0.27).add(0.66);
  const roughness = mix(dry.sub(damp.mul(0.11)), 0.36, film);
  const bump = slope.rg.mul(2).sub(1).mul(detail.mul(mix(0.39, 0.13, film)));
  return { albedo, roughness, bump: vec3(bump.x, 0, bump.y), film, damp };
}
