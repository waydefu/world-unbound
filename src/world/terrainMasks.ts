import { bakeWindChannel } from './windChannel';

/** Derived masks baked next to the GPU textures and handed from the worker to the renderer (spec G2.1). */
export interface TerrainMasks {
  /** Fjord channelling map: WIND_CHANNEL_DIM² x WIND_CHANNEL_STRIDE floats (windChannel.ts). */
  windChannel: Float32Array;
  /** Milliseconds the masks took, measured by whoever built them. */
  ms: number;
}

/**
 * Builds the masks for the installed terrain.
 * @amortized once at load
 */
export function buildTerrainMasks(): TerrainMasks {
  const started = performance.now();
  const windChannel = bakeWindChannel();
  return { windChannel, ms: performance.now() - started };
}
