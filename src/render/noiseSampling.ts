import type { DataTexture, Node } from 'three/webgpu';
import { Fn, If, abs, dFdx, dFdy, float, mix, pow, smoothstep, texture, vec2, vec3 } from 'three/tsl';

/**
 * World-space triplanar sampling of the shared noise texture (G1.4.1 phase C2).
 * The xz (top) projection is always sampled; the two side projections are
 * sampled only where the surface is steep (normal.y < FLAT_Y), with weights
 * from abs(normal)^4. On flat ground the weights collapse smoothly to the top
 * projection (fully from FLAT_Y up), so there is no seam at the branch edge.
 * Side samples use explicit gradients taken in uniform control flow, so the
 * branch never disturbs mip selection.
 */
const FLAT_Y = 0.85;
const BLEND_FROM = 0.78;

type V3 = Node<'vec3'>;

/** Weights (x: normal along x, y: top, z: normal along z) that sum to one. */
export function triplanarWeights(n: V3): V3 {
  const w = pow(abs(n), float(4));
  const normalised = w.div(w.x.add(w.y).add(w.z));
  return mix(normalised, vec3(0, 1, 0), smoothstep(BLEND_FROM, FLAT_Y, n.y));
}

/** Sums `contribution(sample, plane, weight)` over the projections (plane: 0 = zy, 1 = xz top, 2 = xy). */
function blend<T extends Node<'float'> | Node<'vec3'>>(
  noise: DataTexture, p: V3, n: V3, metres: number,
  contribution: (sample: Node<'vec4'>, plane: 0 | 1 | 2, weight: Node<'float'>) => T,
  init: T,
): T {
  return Fn(() => {
    const w = triplanarWeights(n);
    const uvTop = vec2(p.x, p.z).div(metres);
    const uvXy = vec2(p.x, p.y).div(metres);
    const uvZy = vec2(p.z, p.y).div(metres);
    const top = texture(noise, uvTop);
    // Derivatives are taken here, outside the branch.
    const dxXy = dFdx(uvXy);
    const dyXy = dFdy(uvXy);
    const dxZy = dFdx(uvZy);
    const dyZy = dFdy(uvZy);
    const total = (init as unknown as Node<'float'>).toVar();
    total.assign(contribution(top, 1, w.y));
    If(n.y.lessThan(FLAT_Y), () => {
      const xy = texture(noise, uvXy).grad(dxXy, dyXy);
      const zy = texture(noise, uvZy).grad(dxZy, dyZy);
      total.addAssign(contribution(xy, 2, w.z));
      total.addAssign(contribution(zy, 0, w.x));
    });
    return total;
  })() as unknown as T;
}

/** Scalar channel ('r' | 'g' | 'b' | 'a') of the noise at world position `p`, 0..1. */
export function triplanarChannel(noise: DataTexture, p: V3, n: V3, metres: number, channel: 'r' | 'g' | 'b' | 'a'): Node<'float'> {
  return blend(noise, p, n, metres, (s, _plane, weight) => s[channel].mul(weight), float(0));
}

/**
 * Decoded slope (-1..1 per axis, rms ~0.3) as a world-space vector: the top projection maps (r, g) to
 * (x, z); the side projections map (r, g) to the plane axes (x, y) and (z, y).
 */
export function triplanarSlope(noise: DataTexture, p: V3, n: V3, metres: number): V3 {
  return blend(noise, p, n, metres, (s, plane, weight) => {
    const g = s.xy.mul(2).sub(1);
    const v = plane === 1 ? vec3(g.x, 0, g.y) : plane === 2 ? vec3(g.x, g.y, 0) : vec3(0, g.y, g.x);
    return v.mul(weight);
  }, vec3(0));
}
