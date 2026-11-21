import type { DataTexture, Node } from 'three/webgpu';
import { floor, ivec2, texture } from 'three/tsl';
import { WORLD_MIN } from '../world/constants';
import { HEIGHT_DIM } from '../world/terrainTextures';

/** The same split along the diagonal as heightField.interpolateCell. */
export function terrainHeightNode(height: DataTexture) {
  const ground = texture(height);
  const at = (x: Node<'float'>, z: Node<'float'>) =>
    ground.load(ivec2(x.clamp(0, HEIGHT_DIM - 1).toInt(), z.clamp(0, HEIGHT_DIM - 1).toInt())).r;
  return (xz: Node<'vec2'>) => {
    const lattice = xz.sub(WORLD_MIN).mul(.5);
    const cell = floor(lattice);
    const f = lattice.sub(cell);
    const a = at(cell.x, cell.y), b = at(cell.x.add(1), cell.y);
    const c = at(cell.x, cell.y.add(1)), d = at(cell.x.add(1), cell.y.add(1));
    const lower = a.add(b.sub(a).mul(f.x)).add(c.sub(a).mul(f.y));
    const upper = d.add(c.sub(d).mul(f.x.oneMinus())).add(b.sub(d).mul(f.y.oneMinus()));
    return f.x.add(f.y).lessThanEqual(1).select(lower, upper);
  };
}
