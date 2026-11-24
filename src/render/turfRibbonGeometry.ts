import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

export type TurfRibbonTrial = 'trim' | 'depth' | 'blades';

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

/** Three tapered, opaque leaf silhouettes per proxy root. Local units match ribbon geometry. */
export const TURF_PROXY_TRIANGLES = 9;

export function createTurfProxyGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 3; blade++) {
    const i = positions.length / 3;
    const h = [1, .83, .68][blade];
    positions.push(-.045, 0, blade, .045, 0, blade,
      -.065, h * .48, blade, .065, h * .48, blade, 0, h, blade);
    uvs.push(0, 0, 1, 0, 0, .48, 1, .48, .5, 1);
    indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3, i + 2, i + 3, i + 4);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}
