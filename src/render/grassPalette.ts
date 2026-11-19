import type { Node } from 'three/webgpu';
import { float, mix, smoothstep, vec3 } from 'three/tsl';

/**
 * Ground-cover colours shared by the terrain shader and the grass blades, so a blade has exactly the colour of
 * the terrain at its root and no seam shows where the blades fade out. Albedo, linear 0..1.
 */
export const GRASS_DRY = vec3(0.21, 0.24, 0.085);
export const GRASS_LUSH = vec3(0.075, 0.16, 0.045);
/** Calluna and bilberry heath, moss in wet hollows above the treeline. */
export const HEATH = vec3(0.17, 0.145, 0.085);
/** Birch forest floor and canopy seen from afar: darker, bluer green (multiplier on the grass colour). */
export const FOREST_MUL = vec3(0.62, 0.8, 0.62);
/** Dead grass in autumn and winter. */
export const STRAW = vec3(0.36, 0.29, 0.14);
/** Yellow-green of high summer (multiplier on the grass colour). */
export const SUMMER_MUL = vec3(1.2, 1.02, 0.78);

/** Grass colour from the macro noise (-1..1) and the wetness proxy (0..1): lusher in hollows and where it is wet. */
export function grassBase(macro: Node<'float'>, wetness: Node<'float'>): Node<'vec3'> {
  const lush = smoothstep(-0.6, 0.6, macro).mul(0.6).add(0.2).add(wetness.mul(0.35)).min(1);
  return mix(GRASS_DRY, GRASS_LUSH, lush);
}

/** Season weights (fresh, summer, straw; they sum to one) applied to a grass colour. */
export function seasonal(colour: Node<'vec3'>, weights: Node<'vec3'>): Node<'vec3'> {
  const summer = colour.mul(SUMMER_MUL);
  const straw = mix(colour, STRAW, 0.8);
  return colour.mul(weights.x).add(summer.mul(weights.y)).add(straw.mul(weights.z));
}

/**
 * Colour of the vegetated ground at a point: grass (season, wetness), heath where `veg.g` takes over from
 * `veg.r`, forest tint by `veg.b`. `veg` is the vegetation texture sample (meadow, heath, tree, bare).
 */
export function groundCover(
  macro: Node<'float'>, wetness: Node<'float'>, veg: Node<'vec4'>, season: Node<'vec3'>,
): Node<'vec3'> {
  const grass = seasonal(grassBase(macro, wetness), season);
  const heathShare = veg.g.div(veg.r.add(veg.g).max(1e-3));
  const ground = mix(grass, HEATH, heathShare);
  return mix(ground, ground.mul(FOREST_MUL), veg.b);
}

/** Darkening of the ground between blades where the meadow is dense (fraction of the albedo). */
export const CANOPY_SHADE = 0.22;

/**
 * Albedo multiplier of the ground (and of the blade roots, which must equal it) inside the grass range: the shade
 * between the blades, full at the eye and gone at the range edge, so no ring shows. `meadow` is the vegetation R
 * channel, `dist` the distance from the eye, `range` the mid ring (0 = no grass layer: no shade).
 */
export function canopyShade(meadow: Node<'float'>, dist: Node<'float'>, range: Node<'float'>): Node<'float'> {
  const canopy = meadow.mul(float(1).sub(smoothstep(range.mul(0.4), range.max(1), dist))).mul(range.greaterThan(0).select(1, 0));
  return float(1).sub(canopy.mul(CANOPY_SHADE));
}
