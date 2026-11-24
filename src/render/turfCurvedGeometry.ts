import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

/** GPU-deformed grass strips: u=-1/+1, v=0..1, z=blade ID. */
export const CURVED_GRASS_LEAVES = 4;
export const CURVED_GRASS_ROWS = 5;
export const CURVED_GRASS_TRIANGLES = CURVED_GRASS_LEAVES * (CURVED_GRASS_ROWS - 1) * 2;

/**
 * Per-vertex leaf shape is produced by the shader. No alpha textures,
 * pre-baked per-instance leaves, or CPU rebuilding of the blade surface.
 */
export function createTurfCurvedGeometry(): InstancedBufferGeometry {
  const positions = new Float32Array(CURVED_GRASS_LEAVES * CURVED_GRASS_ROWS * 2 * 3);
  const uvs = new Float32Array(CURVED_GRASS_LEAVES * CURVED_GRASS_ROWS * 2 * 2);
  const indices = new Uint16Array(CURVED_GRASS_TRIANGLES * 3);
  let vertex = 0;
  let face = 0;
  for (let blade = 0; blade < CURVED_GRASS_LEAVES; blade++) {
    const first = vertex;
    for (let row = 0; row < CURVED_GRASS_ROWS; row++) {
      const v = row / (CURVED_GRASS_ROWS - 1);
      for (let side = 0; side < 2; side++) {
        const u = side === 0 ? -1 : 1;
        positions.set([u, v, blade], vertex * 3);
        uvs.set([side, v], vertex * 2);
        vertex++;
      }
      if (row > 0) {
        const prev = first + (row - 1) * 2;
        const curr = first + row * 2;
        indices.set([prev, prev + 1, curr, curr, prev + 1, curr + 1], face);
        face += 6;
      }
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
