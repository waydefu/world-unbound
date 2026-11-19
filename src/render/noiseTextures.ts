import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RedFormat, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three/webgpu';
import { GRASS_COVER_DIM, buildGrassCover } from '../world/grassCover';
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
export function createGrassCoverTexture(): NoiseTexture & { readonly uploadBytes: number } {
  const data = buildGrassCover();
  const texture = new DataTexture(data, GRASS_COVER_DIM, GRASS_COVER_DIM, RedFormat, UnsignedByteType);
  texture.name = 'grass-canopy';
  repeatMipmapped(texture);
  return { texture, gpuBytes: Math.round(data.byteLength * 4 / 3), uploadBytes: data.byteLength };
}
