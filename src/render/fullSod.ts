import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, smoothstep, vec3, vertexColor } from 'three/tsl';

const assets = import.meta.glob<string>('../../assets/grass/sod-full.bin', {
  query: '?url&no-inline', import: 'default', eager: true,
});
const HEADER_BYTES = 24;
const SOD1 = 0x31444f53;
const BYTES_PER_VERTEX = 12;

function unpackFloats(buffer: ArrayBuffer, offset: number, vertices: number): Float32Array {
  const compact = new Uint8Array(buffer, offset, vertices * BYTES_PER_VERTEX);
  const values = new Float32Array(vertices * 3);
  const bytes = new Uint8Array(values.buffer);
  for (let lane = 0; lane < BYTES_PER_VERTEX; lane++) {
    const begin = lane * vertices;
    for (let vertex = 0; vertex < vertices; vertex++) {
      bytes[vertex * BYTES_PER_VERTEX + lane] = compact[begin + vertex];
    }
  }
  return values;
}

/** The pack stores the Blender attributes and one verified blade index template. */
export function decodeFullSod(buffer: ArrayBuffer) {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Incomplete full sod mesh');
  const header = new DataView(buffer);
  const leaves = header.getUint32(4, true);
  const stride = header.getUint32(8, true);
  const indexStride = header.getUint32(12, true);
  const vertices = leaves * stride;
  const bytes = vertices * BYTES_PER_VERTEX;
  const start = HEADER_BYTES + indexStride * 4;
  const soilVertices = header.getUint32(16, true);
  const soilIndices = header.getUint32(20, true);
  const soilStart = start + bytes * 3;
  if (header.getUint32(0, true) !== SOD1 || leaves !== 79_524 || stride !== 19 || indexStride !== 66
    || soilVertices !== 10_601 || soilIndices !== 62_400
    || buffer.byteLength !== soilStart + soilVertices * BYTES_PER_VERTEX + soilIndices * 4) throw new Error('Invalid full sod mesh');

  const template = new Uint32Array(buffer, HEADER_BYTES, indexStride);
  if (template.some(vertex => vertex >= stride)) throw new Error('Full sod index outside leaf');
  const indices = new Uint32Array(leaves * indexStride);
  for (let leaf = 0; leaf < leaves; leaf++) {
    for (let i = 0; i < indexStride; i++) indices[leaf * indexStride + i] = leaf * stride + template[i];
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(unpackFloats(buffer, start, vertices), 3));
  geometry.setAttribute('normal', new BufferAttribute(unpackFloats(buffer, start + bytes, vertices), 3));
  geometry.setAttribute('color', new BufferAttribute(unpackFloats(buffer, start + 2 * bytes, vertices), 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const soil = new BufferGeometry();
  const soilPosition = new Float32Array(buffer, soilStart, soilVertices * 3).slice();
  const soilIndex = new Uint32Array(buffer, soilStart + soilPosition.byteLength, soilIndices).slice();
  if (soilIndex.some(vertex => vertex >= soilVertices)) throw new Error('Full sod index outside root mat');
  soil.setAttribute('position', new BufferAttribute(soilPosition, 3));
  soil.setIndex(new BufferAttribute(soilIndex, 1));
  soil.computeVertexNormals();
  return { geometry, soil, leaves, triangles: indices.length / 3,
    bytes: 3 * bytes + indices.byteLength + soilPosition.byteLength * 2 + soilIndex.byteLength };
}

/** Only fetched and uploaded for the one-square-metre high-poly comparison in the game. */
export async function loadFullSod(shadows: boolean) {
  const url = assets['../../assets/grass/sod-full.bin'];
  if (!url) throw new Error('Missing full sod mesh from the build');
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Full sod mesh: HTTP ${response.status}`);
  const packed = response.body.pipeThrough(new DecompressionStream('gzip'));
  const { geometry, soil, leaves, triangles, bytes } = decodeFullSod(await new Response(packed).arrayBuffer());

  const material = new MeshSSSNodeMaterial({ side: DoubleSide, roughness: 0.49, specularIntensity: 0.26 });
  const tint = vertexColor().rgb;
  // Daylight in the game is pre-exposed. Shade the packed leaf colour at the base to retain the depth of the master.
  const contact = mix(0.54, 1, smoothstep(0.006, 0.076, positionLocal.y));
  material.colorNode = tint.mul(contact).mul(vec3(0.26, 0.34, 0.19));
  material.aoNode = mix(0.36, 1, smoothstep(0, 0.065, positionLocal.y));
  material.thicknessColorNode = tint.mul(vec3(0.27, 0.30, 0.13));
  material.thicknessAttenuationNode = float(0.29);
  material.thicknessAmbientNode = float(0);
  const leafMesh = new Mesh(geometry, material);
  leafMesh.receiveShadow = shadows;
  leafMesh.castShadow = shadows;

  const soilMaterial = new MeshStandardNodeMaterial({ roughness: 0.91 });
  const grain = smoothstep(0.22, 0.77, mx_noise_float(positionLocal.mul(194)).mul(0.5).add(0.5));
  soilMaterial.colorNode = mix(vec3(0.024, 0.017, 0.008), vec3(0.106, 0.077, 0.038), grain);
  const rootMat = new Mesh(soil, soilMaterial);
  rootMat.receiveShadow = shadows;
  rootMat.castShadow = shadows;

  const tile = new Group();
  tile.name = 'full-fescue-master';
  tile.add(rootMat, leafMesh);
  return { tile, leaves, triangles, bytes };
}
