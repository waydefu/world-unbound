import type { DataTexture, Node } from 'three/webgpu';
import { If, abs, float, floor, mix, step, texture, vec2 } from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';

/** The sea-floor texture stores h - FLOOR_OFFSET so half floats keep <= 0.25 m steps up to 1050 m. */
export const FLOOR_OFFSET = 500;
const DEEP_FLOOR = -40;
/** Bicubic reconstruction only where |water depth| is below this (metres); farther the bilinear tap is exact enough. */
const SMOOTH_BAND = 10;

type V2 = Node<'vec2'>;

/**
 * Cubic B-spline reconstruction of the height map from four bilinear taps (Sigg & Hadwiger). Bilinear
 * isolines of a gridded height field are diamonds and stair-steps; the B-spline is C2, so the
 * waterline and shore foam follow a smooth curve.
 */
function bicubicHeight(floor_: DataTexture, uv: V2, dim: number): Node<'float'> {
  const tc = uv.mul(dim).sub(0.5);
  const i = floor(tc);
  const f = tc.sub(i);
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const omf = float(1).sub(f);
  const w0 = omf.mul(omf).mul(omf).div(6);
  const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
  const w3 = f3.div(6);
  const w2 = float(1).sub(w0).sub(w1).sub(w3);
  const g0 = w0.add(w1);
  const g1 = w2.add(w3);
  const h0 = i.sub(0.5).add(w1.div(g0)).div(dim);
  const h1 = i.add(1.5).add(w3.div(g1)).div(dim);
  const tap = (x: Node<'float'>, y: Node<'float'>) => texture(floor_, vec2(x, y)).level(float(0)).r;
  const top = g0.x.mul(tap(h0.x, h0.y)).add(g1.x.mul(tap(h1.x, h0.y)));
  const bottom = g0.x.mul(tap(h0.x, h1.y)).add(g1.x.mul(tap(h1.x, h1.y)));
  return g0.y.mul(top).add(g1.y.mul(bottom));
}

/**
 * Water depth in metres at absolute world xz (negative on land); deep outside the world.
 * `smooth` adds the bicubic reconstruction within SMOOTH_BAND of the shore, gated by the first bilinear tap.
 */
export function seaDepth(floor_: DataTexture, p: V2, smooth: boolean): Node<'float'> {
  const uv = p.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN);
  const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
  const dim = floor_.image.width;
  const h = texture(floor_, uv).level(float(0)).r.toVar();
  if (smooth) {
    If(abs(h.add(FLOOR_OFFSET)).lessThan(SMOOTH_BAND), () => {
      h.assign(bicubicHeight(floor_, uv, dim));
    });
  }
  return mix(float(-DEEP_FLOOR), h.add(FLOOR_OFFSET).negate(), inside);
}
