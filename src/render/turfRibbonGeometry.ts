import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

export type TurfRibbonTrial = 'trim' | 'depth' | 'quality';

export const RIBBON_ATLAS_WIDTH = 512;
export const RIBBON_ATLAS_HEIGHT = 256;
export const RIBBON_ATLAS_BYTES = RIBBON_ATLAS_WIDTH * RIBBON_ATLAS_HEIGHT * 2;
const FILTER_PADDING_ROWS = 16;

/** Keep the source alpha rows and a margin for filtering at the upper edge. */
export function turfRibbonAtlasTop(bytes: Uint8Array): number {
  for (let y = RIBBON_ATLAS_HEIGHT - 1; y >= 0; y--) {
    const start = y * RIBBON_ATLAS_WIDTH * 2;
    const end = start + RIBBON_ATLAS_WIDTH * 2;
    for (let i = start; i < end; i += 2) {
      if (bytes[i] !== 0) return Math.min(1, (y + 1 + FILTER_PADDING_ROWS) / RIBBON_ATLAS_HEIGHT);
    }
  }
  return 1;
}

/** Keep the root, width and existing atlas UV coordinates when trimming the upper edge. */
export function createTurfRibbonGeometry(top: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -.5, 0, 0, .5, 0, 0, -.5, top, 0, .5, top, 0,
    -.5, 0, 1, .5, 0, 1, -.5, top, 1, .5, top, 1,
  ]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0, top, 1, top,
    1, 0, 0, 0, 1, top, 0, top,
  ]), 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  return geometry;
}

/** Quality-only third silhouette: same authored profile, another world-stable azimuth. */
export function createTurfQualityGeometry(top: number): InstancedBufferGeometry {
  const geometry = createTurfRibbonGeometry(top);
  const oldPositions = geometry.getAttribute('position').array as Float32Array;
  const oldUvs = geometry.getAttribute('uv').array as Float32Array;
  const positions = new Float32Array(12 * 3);
  const uvs = new Float32Array(12 * 2);
  positions.set(oldPositions);
  uvs.set(oldUvs);
  for (let vertex = 0; vertex < 4; vertex++) {
    const source = vertex * 3;
    const target = (vertex + 8) * 3;
    positions[target] = oldPositions[source];
    positions[target + 1] = oldPositions[source + 1];
    positions[target + 2] = 2;
    uvs.set(oldUvs.subarray(vertex * 2, vertex * 2 + 2), (vertex + 8) * 2);
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7, 8, 9, 10, 10, 9, 11]);
  return geometry;
}
