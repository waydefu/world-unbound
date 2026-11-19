import {
  ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, RedFormat,
  UnsignedByteType,
} from 'three/webgpu';
import { HEIGHT_DIM, materialDim, terrainTextureBytes, type TerrainTextureData } from '../world/terrainTextures';

/** GPU copies of the terrain for the CDLOD renderer (ADR-0003). */
export interface TerrainTextures {
  /** HEIGHT_DIM² R32F, texel = lattice point, nearest, read with `textureLoad` only. */
  readonly height: DataTexture;
  /** RGBA8 sand/rock/earth/AO, linear with mipmaps, sampled in the fragment stage. */
  readonly material: DataTexture;
  /** Texels per side of the material texture. */
  /** RGBA8 world-space geometric normal (n * 0.5 + 0.5), same lattice as `material`, linear with mipmaps. */
  readonly normal: DataTexture;
  /** RGBA8 meadow, heath, tree, bare (vegetationMask.ts), same lattice as `material`, linear with mipmaps. */
  readonly vegetation: DataTexture;
  /** R8 wetness proxy on the same lattice, linear with mipmaps. */
  readonly wetness: DataTexture;
  readonly materialDim: number;
  /** Lattice cells between material texels: 1 (2 m) or 2 (4 m, low tier). */
  readonly materialStep: 1 | 2;
  readonly heightBytes: number;
  /** Includes the mip chain. */
  readonly materialBytes: number;
  /** Includes the mip chain. */
  readonly normalBytes: number;
  /** Bytes each upload moves (for the upload-rate counter): the base levels. */
  readonly uploadBytes: number;
  /** Bytes the normal texture upload moves (its base level), counted on top of `uploadBytes`. */
  readonly normalUploadBytes: number;
  /** Vegetation + wetness with their mip chains, and the bytes their base levels move on upload. */
  readonly vegetationBytes: number;
  readonly vegetationUploadBytes: number;
}

const ANISOTROPY = 8;

/**
 * Wraps the worker's arrays in textures. The arrays stay referenced by the textures (three.js keeps the data
 * so a device loss can re-upload), which is why callers also account `heightBytes + materialBytes + normalBytes` as retained.
 * @amortized once at load
 */
export function createTerrainTextures(data: TerrainTextureData): TerrainTextures {
  const height = new DataTexture(data.height, HEIGHT_DIM, HEIGHT_DIM, RedFormat, FloatType);
  height.name = 'terrain-height';
  height.magFilter = NearestFilter;
  height.minFilter = NearestFilter;
  height.wrapS = ClampToEdgeWrapping;
  height.wrapT = ClampToEdgeWrapping;
  height.generateMipmaps = false;
  height.needsUpdate = true;

  const dim = materialDim(data.materialStep);
  const material = new DataTexture(data.material, dim, dim, RGBAFormat, UnsignedByteType);
  material.name = 'terrain-material';
  material.magFilter = LinearFilter;
  material.minFilter = LinearMipmapLinearFilter;
  material.wrapS = ClampToEdgeWrapping;
  material.wrapT = ClampToEdgeWrapping;
  material.generateMipmaps = true;
  material.needsUpdate = true;

  const normal = new DataTexture(data.normal, dim, dim, RGBAFormat, UnsignedByteType);
  normal.name = 'terrain-normal';
  normal.magFilter = LinearFilter;
  normal.minFilter = LinearMipmapLinearFilter;
  normal.wrapS = ClampToEdgeWrapping;
  normal.wrapT = ClampToEdgeWrapping;
  normal.generateMipmaps = true;
  normal.needsUpdate = true;
  // Terrain is seen at grazing angles: anisotropic filtering keeps far slopes from blurring to flat.
  material.anisotropy = ANISOTROPY;
  normal.anisotropy = ANISOTROPY;

  // Vegetation masks (G2.1); hand-made data without them gets neutral 1 x 1 textures (all meadow, nothing bare).
  const masks = data.masks;
  const vegDim = masks ? dim : 1;
  const vegetation = new DataTexture(masks ? masks.vegetation : new Uint8Array([255, 0, 0, 0]), vegDim, vegDim, RGBAFormat, UnsignedByteType);
  const wetness = new DataTexture(masks ? masks.wetness : new Uint8Array([0]), vegDim, vegDim, RedFormat, UnsignedByteType);
  vegetation.name = 'terrain-vegetation';
  wetness.name = 'terrain-wetness';
  for (const t of [vegetation, wetness]) {
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
  }

  const bytes = terrainTextureBytes(data.materialStep);
  const texels = vegDim * vegDim;
  return {
    height,
    material,
    normal,
    vegetation,
    wetness,
    vegetationBytes: masks ? Math.round((texels * 5 * 4) / 3) : 5,
    vegetationUploadBytes: texels * 5,
    materialDim: dim,
    materialStep: data.materialStep,
    heightBytes: bytes.height,
    materialBytes: bytes.material,
    normalBytes: bytes.normal,
    uploadBytes: bytes.height + dim * dim * 4,
    normalUploadBytes: dim * dim * 4,
  };
}
