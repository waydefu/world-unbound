import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry } from 'three/webgpu';

/**
 * Static grass geometry (spec G2.1 phase C.2). One geometry holds every blade (or card) of one cell; instances
 * are cells. The vertex position attribute is not a position: x is the side (-1 left, +1 right, 0 at a tip),
 * y the height fraction along the blade 0..1, z the index of the blade (card) in the cell. The vertex shader
 * turns (cell, index) into a world position with an integer hash, so nothing is stored per blade. Cards carry a
 * second attribute, `part`, the blade of the three-blade tuft the vertex belongs to.
 */
export interface GrassGeometry {
  readonly geometry: InstancedBufferGeometry;
  /** Per-cell instance attribute (x, z, 0, 0): the array aliases the caller's cell list. */
  readonly cells: InstancedBufferAttribute;
  readonly trianglesPerInstance: number;
  readonly bytes: number;
}

function finish(geometry: InstancedBufferGeometry, position: Float32Array, index: Uint16Array, cellList: Float32Array, part?: Float32Array): GrassGeometry {
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  if (part) geometry.setAttribute('part', new BufferAttribute(part, 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  const cells = new InstancedBufferAttribute(cellList, 4);
  geometry.setAttribute('grassCell', cells);
  geometry.instanceCount = 0;
  return {
    geometry, cells, trianglesPerInstance: index.length / 3,
    bytes: position.byteLength + index.byteLength + (part?.byteLength ?? 0) + cellList.byteLength,
  };
}

/**
 * Blades have rows of two vertices at t = k / segments, followed by a single tip at t = 1.
 * One segment forms a triangle. Additional segments add a quad below the tip.
 */
export function createBladeGeometry(blades: number, segments: number, cellList: Float32Array, companions = 0): GrassGeometry {
  const primaryVertices = 2 * segments + 1;
  const perBlade = primaryVertices + companions * 3;
  const trisPerBlade = 2 * segments - 1 + companions;
  const position = new Float32Array(blades * perBlade * 3);
  const part = companions > 0 ? new Float32Array(blades * perBlade) : undefined;
  const index = new Uint16Array(blades * trisPerBlade * 3);
  let k = 0;
  for (let b = 0; b < blades; b++) {
    const v0 = b * perBlade;
    for (let r = 0; r < segments; r++) {
      const t = r / segments;
      for (let s = 0; s < 2; s++) {
        const o = (v0 + r * 2 + s) * 3;
        position[o] = s === 0 ? -1 : 1;
        position[o + 1] = t;
        position[o + 2] = b;
      }
    }
    const tip = v0 + 2 * segments;
    position[tip * 3 + 1] = 1;
    position[tip * 3 + 2] = b;
    for (let r = 0; r < segments - 1; r++) {
      const a = v0 + r * 2;
      index[k++] = a; index[k++] = a + 1; index[k++] = a + 2;
      index[k++] = a + 1; index[k++] = a + 3; index[k++] = a + 2;
    }
    index[k++] = tip - 2; index[k++] = tip - 1; index[k++] = tip;
    for (let leaf = 0; leaf < companions; leaf++) {
      const v = v0 + primaryVertices + leaf * 3;
      for (let s = 0; s < 3; s++) {
        const o = (v + s) * 3;
        position[o] = s === 0 ? -1 : s === 1 ? 1 : 0;
        position[o + 1] = s === 2 ? 1 : 0;
        position[o + 2] = b;
        if (part) part[v + s] = leaf + 1;
        index[k++] = v + s;
      }
    }
  }
  return finish(new InstancedBufferGeometry(), position, index, cellList, part);
}

/** Cards: tufts of three one-triangle blades (9 vertices, 3 triangles per card), `part` 0..2 per blade. */
export function createCardGeometry(cards: number, cellList: Float32Array): GrassGeometry {
  const position = new Float32Array(cards * 9 * 3);
  const part = new Float32Array(cards * 9);
  const index = new Uint16Array(cards * 9);
  for (let c = 0; c < cards; c++) {
    for (let p = 0; p < 3; p++) {
      const v = c * 9 + p * 3;
      for (let s = 0; s < 3; s++) {
        const o = (v + s) * 3;
        position[o] = s === 0 ? -1 : s === 1 ? 1 : 0;
        position[o + 1] = s === 2 ? 1 : 0;
        position[o + 2] = c;
        part[v + s] = p;
        index[v + s] = v + s;
      }
    }
  }
  return finish(new InstancedBufferGeometry(), position, index, cellList, part);
}
