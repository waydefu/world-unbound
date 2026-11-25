import { BufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

export type TurfRibbonTrial = 'trim' | 'depth' | 'quality' | 'solid';

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

/**
 * Opaque solid-geometry mid-range tuft (3 tapered blades, 3 rows each = 15 triangles, zero alpha-blend / zero discard).
 * Encodes (side -1..1, height 0..1, bladeIndex 0..2) in position; lets hardware Early-Z reject occluded tufts.
 */
export function createTurfSolidGeometry(): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = [0, 0.45, 0.82] as const;
  for (let b = 0; b < 3; b++) {
    const base = b * 7;
    for (let r = 0; r < rows.length; r++) {
      const t = rows[r];
      const halfW = (1 - t * 0.65) * 0.5;
      positions.push(-halfW, t, b, halfW, t, b);
      uvs.push(0, t, 1, t);
    }
    positions.push(0, 1, b);
    uvs.push(0.5, 1);
    indices.push(
      base, base + 1, base + 2, base + 2, base + 1, base + 3,
      base + 2, base + 3, base + 4, base + 4, base + 3, base + 5,
      base + 4, base + 5, base + 6,
    );
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}
