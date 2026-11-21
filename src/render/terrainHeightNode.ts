import type { DataTexture, Node } from 'three/webgpu';
import { floor, ivec2, normalize, texture, vec3 } from 'three/tsl';
import { WORLD_MIN } from '../world/constants';
import { HEIGHT_DIM } from '../world/terrainTextures';

/** The same split along the diagonal as heightField.interpolateCell, plus exact triangle normal. */
export function terrainHeightNode(height: DataTexture) {
  const ground = texture(height);
  const at = (x: Node<'float'>, z: Node<'float'>) =>
    ground.load(ivec2(x.clamp(0, HEIGHT_DIM - 1).toInt(), z.clamp(0, HEIGHT_DIM - 1).toInt())).r;
  const sample = (xz: Node<'vec2'>) => {
    const lattice = xz.sub(WORLD_MIN).mul(.5);
    const cell = floor(lattice);
    const f = lattice.sub(cell);
    const a = at(cell.x, cell.y), b = at(cell.x.add(1), cell.y);
    const c = at(cell.x, cell.y.add(1)), d = at(cell.x.add(1), cell.y.add(1));
    const isLower = f.x.add(f.y).lessThanEqual(1);
    const lower = a.add(b.sub(a).mul(f.x)).add(c.sub(a).mul(f.y));
    const upper = d.add(c.sub(d).mul(f.x.oneMinus())).add(b.sub(d).mul(f.y.oneMinus()));
    const sx = isLower.select(b.sub(a), d.sub(c));
    const sz = isLower.select(c.sub(a), d.sub(b));
    return { y: isLower.select(lower, upper), normal: normalize(vec3(sx.mul(-.5), 1, sz.mul(-.5))) };
  };
  const heightOnly = (xz: Node<'vec2'>) => sample(xz).y;
  heightOnly.withNormal = sample;
  return heightOnly;
}
