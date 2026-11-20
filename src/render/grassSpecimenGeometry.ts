import { BufferAttribute, BufferGeometry, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGFormat } from 'three/webgpu';
import { FESCUE_COLOURS, FESCUE_LEAVES, fescueProfile } from '../world/fescue';
import { finishGrassGeometry } from './grassGeometry';

const packs = import.meta.glob<string>('../../assets/grass/*.bin', {
  eager: true, import: 'default', query: '?url&inline',
});

interface Specimen {
  position: ArrayLike<number>;
  normal: ArrayLike<number>;
  colour: ArrayLike<number>;
  index: ArrayLike<number>;
}

/** Re-tessellate the approved curves. Both LODs retain all seven outlines, centres and root offsets. */
function fescue(): Specimen {
  const position: number[] = [];
  const colour: number[] = [];
  const index: number[] = [];
  const rows = [0, 0.19, 0.4, 0.61, 0.81];
  const section = 3;
  for (const [leafIndex, leaf] of FESCUE_LEAVES.entries()) {
    const [degrees, , , , , fold] = leaf;
    const angle = degrees * Math.PI / 180;
    const fx = Math.cos(angle);
    const fz = -Math.sin(angle);
    const x0 = fx * 0.00055;
    const z0 = fz * 0.00055;
    const y0 = (leafIndex % 3) * 0.00085;
    const start = position.length / 3;
    const leafColour = FESCUE_COLOURS[leafIndex % FESCUE_COLOURS.length];
    for (const [row, t] of rows.entries()) {
      const [reach, y, half] = fescueProfile(leaf, t);
      const roll = (12 + 32 * t) * Math.PI / 180;
      const across = Math.cos(roll) * half;
      const dy = Math.sin(roll) * half;
      const x = x0 + fx * reach;
      const z = z0 + fz * reach;
      position.push(x - fz * across, y0 + y - dy, z + fx * across);
      position.push(x, y0 + y + half * fold, z);
      position.push(x + fz * across, y0 + y + dy, z - fx * across);
      for (let column = 0; column < section; column++) colour.push(...leafColour);
      if (row === 0) continue;
      const bottom = start + (row - 1) * section;
      for (let column = 0; column < section - 1; column++) {
        const a = bottom + column;
        const b = a + section;
        index.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    const tip = position.length / 3;
    const [reach, y] = fescueProfile(leaf, 1);
    position.push(x0 + fx * reach, y0 + y, z0 + fz * reach);
    colour.push(...leafColour);
    for (let column = 0; column < section - 1; column++) {
      const a = tip - section + column;
      index.push(a, tip, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { position, normal: geometry.attributes.normal.array, colour, index };
}

/** Positions, vertex normals and linear material colours are copied from the approved A and C GLBs. */
function floweringSpecimens(): Specimen[] {
  const specimenPack = packs['../../assets/grass/specimens-ac.bin'];
  const bytes = decodePack(specimenPack);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const specimens: Specimen[] = [];
  while (offset < bytes.length) {
    const vertexCount = view.getUint32(offset, true);
    const indexCount = view.getUint32(offset + 4, true);
    offset += 8;
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const colour = new Float32Array(vertexCount * 3);
    const fields = [position, normal, colour];
    for (let i = 0; i < position.length; i += 3) {
      for (const field of fields) {
        for (let axis = 0; axis < 3; axis++, offset += 4) field[i + axis] = view.getFloat32(offset, true);
      }
    }
    const index = new Uint16Array(indexCount);
    for (let i = 0; i < indexCount; i++, offset += 2) index[i] = view.getUint16(offset, true);
    specimens.push({ position, normal, colour, index });
  }
  return specimens;
}

function decodePack(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, value => value.charCodeAt(0));
}

export const TUFT_GRID = 11;
const TUFT_WIDTH = 0.27;
const TUFT_HEIGHT = 0.12;

export function createFescueTuftTexture(): DataTexture {
  const bytes = decodePack(packs['../../assets/grass/fescue-tuft.bin']);
  const tile = new DataTexture(bytes, 512, 256, RGFormat);
  tile.name = 'approved-fescue-tuft';
  tile.minFilter = LinearMipmapLinearFilter;
  tile.magFilter = LinearFilter;
  tile.generateMipmaps = true;
  tile.anisotropy = 4;
  tile.needsUpdate = true;
  return tile;
}

/** Two crossed quads per patch. The texture holds the actual silhouettes of the seedling blades. */
export function createFescueTuftGeometry(cells: Float32Array) {
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const plants: number[] = [];
  for (let plant = 0; plant < TUFT_GRID ** 2; plant++) {
    for (let plane = 0; plane < 2; plane++) {
      const start = positions.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const lateral = (u - 0.5) * TUFT_WIDTH;
        positions.push(plane === 0 ? lateral - 0.021 : 0.030, v * TUFT_HEIGHT, plane === 1 ? lateral + 0.021 : -0.028);
        uv.push(u, v);
        plants.push(plant);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const result = finishGrassGeometry(new Float32Array(positions), new Uint16Array(indices), cells);
  result.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  result.geometry.setAttribute('plantIndex', new BufferAttribute(new Float32Array(plants), 1));
  return { ...result, bytes: result.bytes + (uv.length + plants.length) * 4 };
}

/** One cell's templates, instanced over world roots by the existing grass streamer. */
export function createSpecimenGeometry(kind: 'dense' | 'card', shoots: number, cells: Float32Array) {
  const templates = kind === 'card' ? floweringSpecimens() : [fescue()];
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const plants: number[] = [];
  for (let plant = 0; plant < shoots; plant++) {
    const specimen = templates[plant % templates.length];
    const base = positions.length / 3;
    positions.push(...Array.from(specimen.position));
    normals.push(...Array.from(specimen.normal));
    colours.push(...Array.from(specimen.colour));
    for (let i = 0; i < specimen.index.length; i++) indices.push(base + specimen.index[i]);
    for (let i = 0; i < specimen.position.length / 3; i++) plants.push(plant);
  }
  if (plants.length > 65536) throw new RangeError('Grass specimen cell exceeds 16-bit indices');
  const result = finishGrassGeometry(new Float32Array(positions), new Uint16Array(indices), cells);
  result.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  result.geometry.setAttribute('specimenColour', new BufferAttribute(new Float32Array(colours), 3));
  result.geometry.setAttribute('plantIndex', new BufferAttribute(new Float32Array(plants), 1));
  return { ...result, bytes: result.bytes + (normals.length + colours.length + plants.length) * 4 };
}
