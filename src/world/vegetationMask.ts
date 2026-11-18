import { CELL_SIZE, HEIGHT_OFFSET, HEIGHT_QUANTUM, TOWN_RADIUS, TOWN_X, TOWN_Z, WORLD_MIN } from './constants';
import { smoothstep } from './hash';
import { findManMadeStone } from './manMadeStone';
import { boxFiltered } from './terrainLattice';

/**
 * Vegetation mask (spec G2.1 phase B): per material-texture texel, from the 2 m lattice, the final rock / sand /
 * stone weights of the CDLOD material texture and the RGBA8 vegetation texture. Pure; runs in the terrain worker.
 *
 * Vegetation texture: R meadow/grass density, G heath and moss (above the treeline and on thin soil),
 * B tree and shrub density (a colour tint for now; trees are instances later), A bare (rock, stone, sand and
 * seabed: nothing grows). The separate wetness texture (R8) holds the wetness proxy.
 * Material texture: R sand, G rock (this rule replaces the slope-only rock of `classifyTerrain` for CDLOD),
 * B man-made stone (the channel the chunk path keeps at 0 for "earth"; the terrain shader draws it as grey
 * stone), A baked AO (untouched).
 *
 * Flora numbers cite docs/research/env/6-hellesylt-flora.md.
 */
/**
 * Slope (degrees, 10 m smoothed) above which rock shows. The flora note found rockfall release at 40-45 degrees
 * in NVE 2014 (and 60-70 in NVE 2021) but no vegetation threshold. // unverified
 */
export const ROCK_SLOPE_DEG = 42;
/** Rock fades in from ROCK_SLOPE_DEG - 2 to ROCK_SLOPE_DEG + 8, so slopes up to about 40 degrees stay vegetated. */
const ROCK_RAMP_BELOW = 2;
const ROCK_RAMP_ABOVE = 8;
/** Steep concave gully walls go bare from this slope (degrees). // unverified */
const GULLY_SLOPE_DEG = 34;
/**
 * Treeline: between the coastal forest line of 500-600 m (snl.no/tregrense) and the inner Geirangerfjord
 * 900-1100 m (datasheet in the flora note). No Hellesylt figure was found. // unverified for Hellesylt
 */
export const TREELINE_M = 750;
/** Above this, ground turns bare: heath gives way to rock and scree. 300 m of heath above the treeline. // unverified */
export const HEATH_LIMIT_M = TREELINE_M + 300;
/** Birch forest does not grow on slopes flatter than this (farmland, pasture) or steeper than the upper ramp (degrees). // unverified */
const FOREST_SLOPE_FROM_DEG = 8;
const FOREST_SLOPE_FULL_DEG = 16;
const FOREST_SLOPE_TO_DEG = 38;
/** Meadow density on the village lawn (short grass, no tracks yet). */
export const TOWN_LAWN_DENSITY = 0.55;
/** Sea water: lattice heights below this many metres. */
const SEA_LEVEL_M = 0;
/** The 10 m smoothing of the CDLOD material bake: half-width in lattice cells (5 x 5 box). */
const SLOPE_RADIUS = 2;
/** Concavity: mean height of a 35 m box minus the 10 m smoothed height, in metres. */
const CONCAVITY_RADIUS = 8;
/** Share of a 13 cell box that is sea: the proximity-to-water term of the wetness proxy. */
const WATER_RADIUS = 6;

const RAD_TO_DEG = 180 / Math.PI;
/** tan(8 degrees): below this gradient the slope in degrees is the gradient in radians. */
const FLAT_GRAD = 0.1405;
const Q_SEA = Math.round((SEA_LEVEL_M - HEIGHT_OFFSET) / HEIGHT_QUANTUM);

export interface VegetationOptions {
  /** World x of lattice point 0 (WORLD_MIN for the real terrain). */
  originX?: number;
  originZ?: number;
}

export interface VegetationMasks {
  /** dim² RGBA8: meadow, heath/moss, tree, bare. */
  vegetation: Uint8Array;
  /** dim² R8: wetness proxy 0..1. */
  wetness: Uint8Array;
  /** Texels per side. */
  dim: number;
}

/** Texels per side for a lattice of `latticeDim` points sampled every `step`. */
export function maskDim(latticeDim: number, step: number): number {
  return Math.floor((latticeDim - 1) / step) + 1;
}

/**
 * Fills the vegetation and wetness textures and rewrites the sand, rock and stone weights (material R, G, B) in
 * place. `material` must hold the classic weights on entry (sand from `classifyTerrain` in R); AO (A) is kept.
 * @amortized once at load, in the worker
 */
export function buildVegetation(
  padded: Int16Array, padDim: number, apron: number, step: number, material: Uint8Array, options: VegetationOptions = {},
): VegetationMasks {
  const latticeDim = padDim - 2 * apron;
  const dim = maskDim(latticeDim, step);
  const originX = options.originX ?? WORLD_MIN;
  const originZ = options.originZ ?? WORLD_MIN;
  const stone = new Uint8Array(latticeDim * latticeDim);
  findManMadeStone(padded, padDim, apron, latticeDim, stone);
  const smooth = boxFiltered(padded, SLOPE_RADIUS, padDim);
  const wide = boxFiltered(padded, CONCAVITY_RADIUS, padDim);
  const sea = new Int16Array(padded.length);
  for (let k = 0; k < padded.length; k++) sea[k] = padded[k] < Q_SEA ? 1 : 0;
  const nearSea = boxFiltered(sea, WATER_RADIUS, padDim);

  const vegetation = new Uint8Array(dim * dim * 4);
  const wetness = new Uint8Array(dim * dim);
  const gradScale = HEIGHT_QUANTUM / (2 * CELL_SIZE);
  for (let j = 0; j < dim; j++) {
    const cj = j * step;
    const z = originZ + cj * CELL_SIZE;
    for (let i = 0; i < dim; i++) {
      const ci = i * step;
      const x = originX + ci * CELL_SIZE;
      const at = (cj + apron) * padDim + ci + apron;
      const o = (j * dim + i) * 4;
      const h = padded[at] * HEIGHT_QUANTUM + HEIGHT_OFFSET;
      if (h < -0.3) {
        // Seabed: nothing grows. The material texel keeps its classic weights so the bilinear fringe at the
        // waterline stays sand-coloured (the shader draws the sea floor colour below -0.2 m anyway).
        vegetation[o + 3] = 255;
        continue;
      }
      // Slope of the 10 m smoothed surface, as the material bake classifies it.
      const gx = (smooth[at + 1] - smooth[at - 1]) * gradScale;
      const gz = (smooth[at + padDim] - smooth[at - padDim]) * gradScale;
      const grad = Math.sqrt(gx * gx + gz * gz);
      // atan(g) = g to within 0.3 degrees below 8 degrees, which no rule below that distinguishes.
      const slopeDeg = grad < FLAT_GRAD ? grad * RAD_TO_DEG : Math.atan(grad) * RAD_TO_DEG;
      const concave = (wide[at] - smooth[at]) * HEIGHT_QUANTUM;
      const hollow = concave > 0.3 ? smoothstep(0.3, 2.5, concave) : 0;
      let wet = slopeDeg < 40 ? hollow * (1 - smoothstep(26, 40, slopeDeg)) : 0;
      if (h < 12 && nearSea[at] > 0) wet += nearSea[at] * 0.8 * (1 - smoothstep(4, 12, h));
      if (wet > 1) wet = 1;

      let rock = h > HEATH_LIMIT_M ? smoothstep(HEATH_LIMIT_M, HEATH_LIMIT_M + 200, h) : 0;
      if (slopeDeg > ROCK_SLOPE_DEG - ROCK_RAMP_BELOW) rock = Math.max(rock, smoothstep(ROCK_SLOPE_DEG - ROCK_RAMP_BELOW, ROCK_SLOPE_DEG + ROCK_RAMP_ABOVE, slopeDeg));
      if (hollow > 0 && slopeDeg > GULLY_SLOPE_DEG) rock = Math.max(rock, 0.9 * hollow * smoothstep(GULLY_SLOPE_DEG, ROCK_SLOPE_DEG, slopeDeg));
      const isStone = stone[cj * latticeDim + ci] === 1;
      const sand = isStone ? 0 : (material[o] / 255) * (1 - rock);
      const rockW = isStone ? 0 : rock * (1 - sand);
      const stoneW = isStone ? 1 : 0;
      const bare = Math.min(1, sand + rockW + stoneW);

      let heath = h > TREELINE_M - 50 ? smoothstep(TREELINE_M - 50, TREELINE_M + 100, h) : 0;
      if (h > 300 && slopeDeg > 30) {
        // 1 where the ground faces south (sun-baked, thin soil), 0 facing north.
        const southness = grad > 1e-6 ? (-gz / grad) * 0.5 + 0.5 : 0.5;
        heath = Math.max(heath, 0.6 * southness * smoothstep(300, 500, h) * smoothstep(30, 38, slopeDeg));
      }
      const moss = h > 400 ? wet * 0.7 * smoothstep(400, 650, h) : 0;
      let town = 0;
      const tx = x - TOWN_X;
      const tz = z - TOWN_Z;
      if (tx > -TOWN_RADIUS && tx < TOWN_RADIUS && tz > -TOWN_RADIUS && tz < TOWN_RADIUS) {
        town = 1 - smoothstep(TOWN_RADIUS - 15, TOWN_RADIUS, Math.sqrt(tx * tx + tz * tz));
      }
      const green = 1 - bare;
      // Birch forest: moderate slopes below the treeline, not on farmland (flat) or the village.
      let forest = 0;
      if (slopeDeg > FOREST_SLOPE_FROM_DEG && slopeDeg < FOREST_SLOPE_TO_DEG && h > 4 && h < TREELINE_M) {
        forest = green * (1 - heath) * (1 - town)
          * smoothstep(FOREST_SLOPE_FROM_DEG, FOREST_SLOPE_FULL_DEG, slopeDeg)
          * (1 - smoothstep(FOREST_SLOPE_TO_DEG - 6, FOREST_SLOPE_TO_DEG, slopeDeg))
          * (1 - smoothstep(TREELINE_M - 100, TREELINE_M, h)) * smoothstep(4, 12, h);
      }

      vegetation[o] = ((255 * green * (1 - heath) * (1 + (TOWN_LAWN_DENSITY - 1) * town)) + 0.5) | 0;
      vegetation[o + 1] = ((255 * green * Math.min(1, heath + moss * (1 - heath))) + 0.5) | 0;
      vegetation[o + 2] = ((255 * forest) + 0.5) | 0;
      vegetation[o + 3] = ((255 * bare) + 0.5) | 0;
      wetness[j * dim + i] = ((255 * wet) + 0.5) | 0;
      material[o] = ((255 * sand) + 0.5) | 0;
      material[o + 1] = ((255 * rockW) + 0.5) | 0;
      material[o + 2] = ((255 * stoneW) + 0.5) | 0;
    }
  }
  return { vegetation, wetness, dim };
}
