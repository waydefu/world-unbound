import type { Node } from 'three/webgpu';
import { mix, smoothstep, vec3 } from 'three/tsl';

/** Organic topsoil, in linear colour. Damp soil loses brightness and some of its ochre tint. */
export function soilColour(mottle: Node<'float'>, wetness: Node<'float'>) {
  const grain = smoothstep(0.18, 0.82, mottle);
  const dry = mix(vec3(0.085, 0.065, 0.045), vec3(0.132, 0.106, 0.078), grain);
  const damp = mix(vec3(0.052, 0.041, 0.031), vec3(0.083, 0.069, 0.053), grain);
  return mix(dry, damp, wetness);
}
