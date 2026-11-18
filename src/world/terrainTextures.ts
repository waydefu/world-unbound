import { buildHeightPyramid } from './cdlodPyramid';
import { CELL_SIZE, HEIGHT_QUANTUM, WORLD_MIN } from './constants';
import { dequantize, sampleQuantized } from './heightField';
import { AO_APRON, vertexAo } from './terrainAo';
import { TERRAIN_SAMPLES, terrainGrid } from './terrainData';
import { classifyTerrain } from './terrainMaterialWeights';

/**
 * GPU copies of the terrain (ADR-0003). The CPU lattice stays the authority; these are derived arrays,
 * built once after the tiles are installed and uploaded as textures by src/render/terrainTextures.ts.
 *
 * Both textures cover the lattice points of the 2 m grid, WORLD_MIN to WORLD_MAX inclusive: 2049 points
 * per side. Texel (i, j) is lattice point (i - 1024, j - 1024), i.e. world position WORLD_MIN + 2 i,
 * WORLD_MIN + 2 j. The last row and column (world +2048) lie outside the baked square and hold the same
 * open-water value `sampleQuantized` returns there (-55 m), exactly as the chunk path sees them.
 */
export const HEIGHT_DIM = TERRAIN_SAMPLES + 1;
/** Lattice index of texel 0 (world WORLD_MIN). */
const ORIGIN = -TERRAIN_SAMPLES / 2;

/** Material texture stride in lattice cells: 1 = 2 m texels, 2 = 4 m texels (low tier). */
export type MaterialStep = 1 | 2;

/** Texels per side of the material texture at `step`. */
export function materialDim(step: MaterialStep): number {
  return TERRAIN_SAMPLES / step + 1;
}

/** Derived terrain arrays handed from the worker to the renderer. */
export interface TerrainTextureData {
  /** HEIGHT_DIM² metres (R32F). */
  height: Float32Array;
  /** materialDim² RGBA8: sand, rock, earth weights and baked AO, as in the chunk vertex colours. */
  material: Uint8Array;
  materialStep: MaterialStep;
  /** Min/max height pyramid for node selection (see cdlodPyramid.ts), derived from `height`. */
  pyramid: Float32Array;
  /** Milliseconds the build took, measured by whoever ran it. */
  ms: number;
}

/**
 * Fills `out` (HEIGHT_DIM²) with the height in metres of every lattice point.
 * @amortized once at load
 */
export function buildHeightTexture(out: Float32Array = new Float32Array(HEIGHT_DIM * HEIGHT_DIM)): Float32Array {
  for (let j = 0; j < HEIGHT_DIM; j++) {
    const row = j * HEIGHT_DIM;
    for (let i = 0; i < HEIGHT_DIM; i++) out[row + i] = dequantize(sampleQuantized(i + ORIGIN, j + ORIGIN));
  }
  return out;
}

const PAD_DIM = HEIGHT_DIM + 2 * AO_APRON;

/**
 * Quantised lattice with an AO_APRON border, so AO and normals can read neighbours without bounds checks.
 * Inside the baked square the rows are copied; outside it holds the open-water value `sampleQuantized` returns.
 */
function buildPaddedLattice(): Int16Array {
  const outside = sampleQuantized(-100000, -100000);
  const grid = terrainGrid;
  if (grid === null) throw new Error('terrain data is not installed (installTerrain was not called)');
  const padded = new Int16Array(PAD_DIM * PAD_DIM).fill(outside);
  for (let row = 0; row < TERRAIN_SAMPLES; row++) {
    padded.set(grid.subarray(row * TERRAIN_SAMPLES, (row + 1) * TERRAIN_SAMPLES), (row + AO_APRON) * PAD_DIM + AO_APRON);
  }
  return padded;
}

const scratch = new Float32Array(3);

/**
 * Fills the material texture: for every texel the values the chunk path writes into its vertex colours
 * (`classifyTerrain` on the 2 m central-difference normal, `vertexAo` over the 2 m lattice), so both render
 * paths show the same ground. With `step` 2 the texels sit on every second lattice point (4 m).
 * @amortized once at load
 */
export function buildMaterialTexture(step: MaterialStep, out?: Uint8Array): Uint8Array {
  const dim = materialDim(step);
  const result = out ?? new Uint8Array(dim * dim * 4);
  const padded = buildPaddedLattice();
  const ny2 = 2 * CELL_SIZE;
  for (let j = 0; j < dim; j++) {
    const cj = j * step;
    for (let i = 0; i < dim; i++) {
      const ci = i * step;
      const at = (cj + AO_APRON) * PAD_DIM + ci + AO_APRON;
      const dx = (padded[at + 1] - padded[at - 1]) * HEIGHT_QUANTUM;
      const dz = (padded[at + PAD_DIM] - padded[at - PAD_DIM]) * HEIGHT_QUANTUM;
      const normalY = ny2 / Math.sqrt(dx * dx + ny2 * ny2 + dz * dz);
      const x = WORLD_MIN + ci * CELL_SIZE;
      const z = WORLD_MIN + cj * CELL_SIZE;
      classifyTerrain(x, z, dequantize(padded[at]), normalY, scratch);
      const o = (j * dim + i) * 4;
      result[o] = Math.round(scratch[0] * 255);
      result[o + 1] = Math.round(scratch[1] * 255);
      result[o + 2] = Math.round(scratch[2] * 255);
      result[o + 3] = Math.round(vertexAo(padded, PAD_DIM, AO_APRON, ci, cj) * 255);
    }
  }
  return result;
}

/**
 * Builds both textures from the installed terrain. `ms` is left at 0 for the caller to fill in.
 * @amortized once at load
 */
export function buildTerrainTextures(step: MaterialStep): TerrainTextureData {
  const height = buildHeightTexture();
  return { height, material: buildMaterialTexture(step), materialStep: step, pyramid: buildHeightPyramid(height, HEIGHT_DIM), ms: 0 };
}

/** Bytes of the GPU copies, with the material mip chain (a third more). */
export function terrainTextureBytes(step: MaterialStep): { height: number; material: number } {
  const dim = materialDim(step);
  return { height: HEIGHT_DIM * HEIGHT_DIM * 4, material: Math.round((dim * dim * 4 * 4) / 3) };
}
