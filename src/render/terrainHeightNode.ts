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
    const lower = f.x.add(f.y).lessThanEqual(1);
    const cornerOffset = lower.select(0, 1);
    // Both triangles share B and C. Select the third texel's address before loading it.
    const corner = at(cell.x.add(cornerOffset), cell.y.add(cornerOffset)).toVar();
    const b = at(cell.x.add(1), cell.y).toVar(), c = at(cell.x, cell.y.add(1)).toVar();
    const sx = lower.select(b.sub(corner), corner.sub(c)).toVar();
    const sz = lower.select(c.sub(corner), corner.sub(b)).toVar();
    const y = corner.add(sx.mul(f.x.sub(cornerOffset))).add(sz.mul(f.y.sub(cornerOffset)));
    return { y, normal: normalize(vec3(sx.mul(-.5), 1, sz.mul(-.5))) };
  };
  const heightOnly = (xz: Node<'vec2'>) => sample(xz).y;
  heightOnly.withNormal = sample;
  return heightOnly;
}
