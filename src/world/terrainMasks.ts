import { AO_APRON } from './terrainAo';
import { PAD_DIM } from './terrainLattice';
import { buildVegetation, maskDim } from './vegetationMask';
import { bakeWindChannel } from './windChannel';

/** Derived masks baked next to the GPU textures and handed from the worker to the renderer (spec G2.1). */
export interface TerrainMasks {
  /** Fjord channelling map: WIND_CHANNEL_DIM² x WIND_CHANNEL_STRIDE floats (windChannel.ts). */
  windChannel: Float32Array;
  /** Vegetation RGBA8 (meadow, heath, tree, bare) on the material texture lattice (vegetationMask.ts). */
  vegetation: Uint8Array;
  /** Wetness proxy R8 on the same lattice. */
  wetness: Uint8Array;
  /** Milliseconds the masks took, measured by whoever built them. */
  ms: number;
}

/**
 * Builds the masks for the installed terrain and rewrites the sand, rock and stone weights of `material` (the
 * CDLOD bake uses the vegetation rule instead of the slope-only classification; the chunk path keeps its own).
 * @amortized once at load
 */
export function buildTerrainMasks(step: 1 | 2, material: Uint8Array, lattice: Int16Array): TerrainMasks {
  const started = performance.now();
  const windChannel = bakeWindChannel();
  const { vegetation, wetness } = buildVegetation(lattice, PAD_DIM, AO_APRON, step, material);
  return { windChannel, vegetation, wetness, ms: performance.now() - started };
}

/** Texels per side of the vegetation and wetness textures: the material lattice. */
export function vegetationDim(step: 1 | 2): number {
  return maskDim(PAD_DIM - 2 * AO_APRON, step);
}

