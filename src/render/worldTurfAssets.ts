import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { SOD_CROWNS_PER_M2, SOD_LEAVES_PER_CROWN, SOD_LEAVES_PER_M2 } from '../world/sodRoots';

export const LEAF_VERTICES = 19;
export const CROWN_VERTICES = LEAF_VERTICES * SOD_LEAVES_PER_CROWN;
export const MASTER_WIDTH = 2048;
export const MASTER_HEIGHT = Math.ceil(SOD_CROWNS_PER_M2 * CROWN_VERTICES / MASTER_WIDTH);
export const CANOPY_DIM = 256;
export const CANOPY_AREA_RANGE = 10;
const MASTER_PAGES_END = 20 + MASTER_WIDTH * MASTER_HEIGHT * 12;
const urls = import.meta.glob<string>('../../assets/grass/{sod-world-master,sod-world-canopy}.bin', {
  query: '?url&no-inline', import: 'default', eager: true,
});

async function fetchAsset(name: string): Promise<Response> {
  const url = urls[`../../assets/grass/${name}.bin`];
  if (!url) throw new Error(`Missing turf asset ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Turf ${name}: HTTP ${response.status}`);
  return response;
}

function pages(buffer: ArrayBuffer, begin: number, width: number, height: number, mip: boolean) {
  const stride = width * height * 4;
  return Array.from({ length: 3 }, (_, index) => {
    const texture = new DataTexture(new Uint8Array(buffer, begin + index * stride, stride), width, height, RGBAFormat, UnsignedByteType);
    texture.magFilter = mip ? LinearFilter : NearestFilter;
    texture.minFilter = mip ? LinearMipmapLinearFilter : NearestFilter;
    if (mip) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = 4;
    }
    texture.generateMipmaps = mip;
    texture.needsUpdate = true;
    return texture;
  });
}

export function decodeTurfMaster(buffer: ArrayBuffer): DataTexture[] {
  const header = new DataView(buffer);
  if (buffer.byteLength !== MASTER_PAGES_END + SOD_CROWNS_PER_M2 * 4 || header.getUint32(0, true) !== 0x324d5457
    || header.getUint32(4, true) !== SOD_LEAVES_PER_M2 || header.getUint32(8, true) !== MASTER_WIDTH
    || header.getUint32(12, true) !== MASTER_HEIGHT || header.getUint32(16, true) !== 3) throw new Error('Invalid world turf master');
  return pages(buffer, 20, MASTER_WIDTH, MASTER_HEIGHT, false);
}

export function turfMasterOrigins(buffer: ArrayBuffer): Float32Array {
  const source = new DataView(buffer, MASTER_PAGES_END);
  return Float32Array.from({ length: SOD_CROWNS_PER_M2 * 2 }, (_, index) => source.getUint16(index * 2, true) / 65535 - .5);
}

export function decodeTurfCanopy(buffer: ArrayBuffer): DataTexture[] {
  const header = new DataView(buffer);
  if (buffer.byteLength !== 16 + CANOPY_DIM ** 2 * 12 || header.getUint32(0, true) !== 0x31565457
    || header.getUint32(4, true) !== SOD_LEAVES_PER_M2 || header.getUint16(8, true) !== CANOPY_DIM
    || header.getUint16(10, true) !== 3 || header.getFloat32(12, true) !== CANOPY_AREA_RANGE) throw new Error('Invalid world turf canopy');
  return pages(buffer, 16, CANOPY_DIM, CANOPY_DIM, true);
}

export async function loadTurfMaster() {
  const response = await fetchAsset('sod-world-master');
  if (!response.body) throw new Error('Missing turf master body');
  const bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return { textures: decodeTurfMaster(bytes), origins: turfMasterOrigins(bytes), bytes: bytes.byteLength };
}

export async function loadTurfCanopy() {
  const bytes = await (await fetchAsset('sod-world-canopy')).arrayBuffer();
  return { textures: decodeTurfCanopy(bytes), bytes: bytes.byteLength };
}
