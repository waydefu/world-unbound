import { type DataTexture, type Node, type UniformNode, Vector4 } from 'three/webgpu';
import { dot, float, mix, sin, smoothstep, texture, uniform, vec2 } from 'three/tsl';
import { WIND_SPAN_M } from './windTexture';

export const GUST_WAVELENGTH_M = 30;
const TWO_PI = 2 * Math.PI;

export interface GrassWindUniforms {
  /** (dirX, dirZ, speed m/s, gust01) and the integrated travel in cycles. */
  wind: UniformNode<'vec4', Vector4>;
  gustPhase: UniformNode<'float', number>;
}

export function createGrassWind(): GrassWindUniforms {
  return { wind: uniform(new Vector4(0, 1, 3, 0)), gustPhase: uniform(0) };
}

/** Shared wind fronts for blade vertices and the visible canopy. */
export function grassGust(xz: Node<'vec2'>, offset: Node<'float'>, motion: GrassWindUniforms) {
  const along = dot(xz, motion.wind.xy);
  const offsetPhase = offset.sub(motion.gustPhase);
  const wave = sin(offsetPhase.add(along.div(GUST_WAVELENGTH_M)).mul(TWO_PI)).mul(0.5).add(0.5);
  const ripple = sin(offset.mul(2).add(along.div(11)).sub(motion.gustPhase.mul(2.4)).mul(TWO_PI)).mul(0.5).add(0.5);
  return wave.mul(wave).mul(0.75).add(ripple.mul(0.25));
}

/** The camera-centred texture is valid within 248 m of the eye. Blend into regional wind before that edge. */
export function canopyWind(xz: Node<'vec2'>, distance: Node<'float'>, map: DataTexture, motion: GrassWindUniforms) {
  const local = texture(map, xz.div(WIND_SPAN_M)).level(float(0));
  const regionalWeight = smoothstep(190, 224, distance);
  const regionalOffset = sin(dot(xz, vec2(0.011, 0.008))).mul(0.25).add(0.5);
  const velocity = mix(local.xy, motion.wind.xy.mul(motion.wind.z), regionalWeight);
  const phase = mix(local.z, regionalOffset, regionalWeight);
  const gust = grassGust(xz, phase, motion);
  return { velocity, gust: gust.mul(mix(float(0.55), 1, motion.wind.w)) };
}
