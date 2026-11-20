import { DataTexture, LinearMipmapLinearFilter, LinearFilter, ClampToEdgeWrapping, RedFormat, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import { GRASS_CARD_DIM, GRASS_COVER_DIM, buildGrassCardMask, buildGrassCover, buildSwardCover } from '../world/grassCover';
import { NOISE_TILE_SIZE, generateNoiseTile } from '../world/noiseTile';

/** The shared tileable noise texture and its GPU footprint (with the full mip chain). */
export interface NoiseTexture {
  readonly texture: DataTexture;
  readonly gpuBytes: number;
}

function repeatMipmapped(texture: DataTexture): void {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

/**
 * Builds the shared 256 x 256 RGBA8 noise texture (see world/noiseTile.ts for the channel layout).
 * Repeat wrapping, trilinear filtering and anisotropy 4: slopes average towards zero in the mips, so
 * detail fades out with distance instead of aliasing.
 * @amortized once at startup
 */
export function createNoiseTexture(): NoiseTexture {
  const texture = new DataTexture(generateNoiseTile(), NOISE_TILE_SIZE, NOISE_TILE_SIZE, RGBAFormat, UnsignedByteType);
  repeatMipmapped(texture);
  return { texture, gpuBytes: Math.round((NOISE_TILE_SIZE * NOISE_TILE_SIZE * 4 * 4) / 3) };
}

/** Small R8 canopy map for the CDLOD meadow. @amortized once at startup */
export function createGrassCoverTexture(sward = false): NoiseTexture & { readonly uploadBytes: number } {
  const data = sward ? buildSwardCover() : buildGrassCover();
  const texture = new DataTexture(data, GRASS_COVER_DIM, GRASS_COVER_DIM, RedFormat, UnsignedByteType);
  texture.name = 'grass-canopy';
  repeatMipmapped(texture);
  return { texture, gpuBytes: Math.round(data.byteLength * 4 / 3), uploadBytes: data.byteLength };
}

/** Mipped cutout foliage for the three existing card triangles. @amortized once at startup */
export function createGrassCardTexture(): NoiseTexture & { readonly uploadBytes: number } {
  const data = buildGrassCardMask();
  const texture = new DataTexture(data, GRASS_CARD_DIM, GRASS_CARD_DIM, RedFormat, UnsignedByteType);
  texture.name = 'short-grass-card';
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, gpuBytes: Math.round(data.byteLength * 4 / 3), uploadBytes: data.byteLength };
}
