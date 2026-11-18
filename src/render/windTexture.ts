import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, RepeatWrapping } from 'three/webgpu';
import type { ClimateState } from '../env/climate';
import { createLocalWind, localWind, windDirX, windDirZ } from '../env/wind';
import { noise2 } from '../env/seededNoise';
import { sampleWindChannel } from '../world/windChannel';

/**
 * Camera-centred wind field (spec G2.1 phase A.3): 64 x 64 RGBA16F, 8 m cells (a 512 m square), toroidal.
 * Texel (i, j) holds the world cell whose index is congruent to (i, j) mod 64 inside the window around the
 * camera, so a texel is only rewritten with the same cell's new value and the field never scrolls in memory;
 * shaders read it at fract(worldXZ / 512) with repeat wrapping and bilinear filtering.
 *
 *   R, G: wind velocity x, z (m/s, +x east, +z south), channelled and sheltered (env/wind.ts);
 *   B:    gust phase offset in [0, 1): slow spatial noise, so gust fronts are not straight lines;
 *   A:    shelter factor 0..1 (1 = exposed).
 *
 * Half float is always filterable in WebGL2 and WebGPU, so there is no RGBA8 variant. The CPU refresh runs at
 * UPDATE_HZ from the climate state; the shader adds the continuous travelling gust from frame time.
 */
export const WIND_TEXELS = 64;
export const WIND_CELL_M = 8;
export const WIND_SPAN_M = WIND_TEXELS * WIND_CELL_M;
export const WIND_UPDATE_HZ = 10;
/** Bytes of one upload (and of the texture): 64 x 64 x 4 half floats. */
export const WIND_BYTES = WIND_TEXELS * WIND_TEXELS * 4 * 2;
/** Metres per random value of the gust phase noise. */
const PHASE_NOISE_M = 90;
const PHASE_SEED = 0x6a57;

export class WindTexture {
  readonly texture: DataTexture;
  private readonly data = new Uint16Array(WIND_TEXELS * WIND_TEXELS * 4);
  private readonly local = createLocalWind();
  private readonly channelSample = new Float32Array(4);
  private lastUpdateMs = Number.NEGATIVE_INFINITY;
  /** Refreshes done so far (for the upload-rate telemetry). */
  updates = 0;

  /** `channel` is the baked map (windChannel.ts), or null to use the global wind unchanged. */
  constructor(private readonly channel: Float32Array | null) {
    this.texture = new DataTexture(this.data, WIND_TEXELS, WIND_TEXELS, RGBAFormat, HalfFloatType);
    this.texture.name = 'wind';
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.wrapS = RepeatWrapping;
    this.texture.wrapT = RepeatWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.channelSample[0] = 1;
  }

  /**
   * Rewrites the field for the camera at (camX, camZ) and flags the upload, at most WIND_UPDATE_HZ times a second.
   * Returns true when it did.
   * @amortized 4096 texels, each a bilinear map lookup, a few multiplies and four half-float conversions
   */
  update(nowMs: number, camX: number, camZ: number, climate: ClimateState): boolean {
    if (nowMs - this.lastUpdateMs < 1000 / WIND_UPDATE_HZ) return false;
    this.lastUpdateMs = nowMs;
    const dirX = windDirX(climate.windDirRad);
    const dirZ = windDirZ(climate.windDirRad);
    const originI = Math.floor(camX / WIND_CELL_M) - WIND_TEXELS / 2;
    const originJ = Math.floor(camZ / WIND_CELL_M) - WIND_TEXELS / 2;
    const { data, local, channelSample, channel } = this;
    for (let j = 0; j < WIND_TEXELS; j++) {
      // The world cell of this row inside the window [origin, origin + 64).
      const cz = originJ + ((((j - originJ) % WIND_TEXELS) + WIND_TEXELS) % WIND_TEXELS);
      const z = (cz + 0.5) * WIND_CELL_M;
      for (let i = 0; i < WIND_TEXELS; i++) {
        const cx = originI + ((((i - originI) % WIND_TEXELS) + WIND_TEXELS) % WIND_TEXELS);
        const x = (cx + 0.5) * WIND_CELL_M;
        if (channel) {
          sampleWindChannel(channel, x, z, channelSample);
          localWind(climate.windSpeedMs, dirX, dirZ, channelSample[0], channelSample[1], channelSample[2], channelSample[3], local);
        } else {
          localWind(climate.windSpeedMs, dirX, dirZ, 1, 0, 0, 1, local);
        }
        const o = (j * WIND_TEXELS + i) * 4;
        data[o] = DataUtils.toHalfFloat(local.x);
        data[o + 1] = DataUtils.toHalfFloat(local.z);
        data[o + 2] = DataUtils.toHalfFloat(noise2(x / PHASE_NOISE_M, z / PHASE_NOISE_M, PHASE_SEED));
        data[o + 3] = DataUtils.toHalfFloat(local.shelter);
      }
    }
    this.texture.needsUpdate = true;
    this.updates++;
    return true;
  }
}
