import { buildHeightPyramid } from './cdlodPyramid';
import { CELL_SIZE, HEIGHT_QUANTUM, WORLD_MIN } from './constants';
import { dequantize, sampleQuantized } from './heightField';
import { AO_APRON, vertexAo } from './terrainAo';
import { PAD_DIM, boxFiltered, buildPaddedLattice } from './terrainLattice';
import { TERRAIN_SAMPLES } from './terrainData';
import { classifyTerrain } from './terrainMaterialWeights';
import { buildTerrainMasks, type TerrainMasks } from './terrainMasks';

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
  /** materialDim² RGBA8 world-space normals (xyz as n * 0.5 + 0.5, alpha 255), same lattice as `material`. */
  normal: Uint8Array;
  materialStep: MaterialStep;
  /** Min/max height pyramid for node selection (see cdlodPyramid.ts), derived from `height`. */
  pyramid: Float32Array;
  /** Milliseconds the build took, measured by whoever ran it. */
  ms: number;
  /** Wind channel and (later) vegetation masks; absent in hand-made test data. */
  masks?: TerrainMasks;
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

const scratch = new Float32Array(3);

/**
 * Half-width in lattice cells of the box that smooths the heights the rock/sand classification sees in the
 * CDLOD material texture: 2 gives a 5 x 5 box, 10 m across.
 *
 * Why: the chunk path classifies the 2 m normal only at its (sparse) vertices and interpolates the weights
 * across 4 to 32 m triangles, and beyond the streamed ring it shows no rock at all, so on mountain faces it
 * reads as grass with rock patches. Classifying every 2 m texel of a rough face with the raw 2 m normal pushes
 * most of it past the rock threshold. Classifying a slope averaged over about ten metres keeps the rock on
 * real cliffs and lets grass keep the faces that are only rough. `classifyTerrain` and its thresholds are
 * untouched; only the normal fed to it changes (radius 0 reproduces the chunk vertex colours exactly).
 */
export const CLASSIFY_SMOOTH_RADIUS = 2;

/**
 * Fills the material texture: for every texel the weights `classifyTerrain` gives from the central-difference
 * normal of the heights box-filtered over `smoothRadius` cells (0: the raw 2 m normal, which makes the texels equal
 * the chunk path vertex colours), plus `vertexAo` over the 2 m lattice. With `step` 2 the texels sit on every
 * second lattice point (4 m). `lattice` is the padded lattice when the caller already has it.
 * @amortized once at load
 */
export function buildMaterialTexture(
  step: MaterialStep, out?: Uint8Array, smoothRadius = 0, lattice?: Int16Array,
): Uint8Array {
  const dim = materialDim(step);
  const result = out ?? new Uint8Array(dim * dim * 4);
  const padded = lattice ?? buildPaddedLattice();
  const smooth = smoothRadius > 0 ? boxFiltered(padded, smoothRadius) : null;
  const slope = smooth ?? padded;
  const ny2 = 2 * CELL_SIZE;
  for (let j = 0; j < dim; j++) {
    const cj = j * step;
    for (let i = 0; i < dim; i++) {
      const ci = i * step;
      const at = (cj + AO_APRON) * PAD_DIM + ci + AO_APRON;
      const dx = (slope[at + 1] - slope[at - 1]) * HEIGHT_QUANTUM;
      const dz = (slope[at + PAD_DIM] - slope[at - PAD_DIM]) * HEIGHT_QUANTUM;
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
 * Fills the geometric normal texture (same lattice and texel layout as the material texture): the world-space
 * unit normal of the surface from central differences of the raw heights, `step` cells either side, encoded
 * n * 0.5 + 0.5 in RGB (alpha 255). The fragment shader reads it filtered with mipmaps, so lighting keeps
 * the 2 m relief at every distance instead of the node's vertex spacing.
 * @amortized once at load
 */
export function buildNormalTexture(step: MaterialStep, out?: Uint8Array, lattice?: Int16Array): Uint8Array {
  const dim = materialDim(step);
  const result = out ?? new Uint8Array(dim * dim * 4);
  const padded = lattice ?? buildPaddedLattice();
  const ny = 2 * CELL_SIZE * step;
  for (let j = 0; j < dim; j++) {
    const cj = j * step;
    for (let i = 0; i < dim; i++) {
      const at = (cj + AO_APRON) * PAD_DIM + i * step + AO_APRON;
      const dx = (padded[at + step] - padded[at - step]) * HEIGHT_QUANTUM;
      const dz = (padded[at + step * PAD_DIM] - padded[at - step * PAD_DIM]) * HEIGHT_QUANTUM;
      const inv = 0.5 / Math.sqrt(dx * dx + ny * ny + dz * dz);
      const o = (j * dim + i) * 4;
      result[o] = Math.round((0.5 - dx * inv) * 255);
      result[o + 1] = Math.round((0.5 + ny * inv) * 255);
      result[o + 2] = Math.round((0.5 - dz * inv) * 255);
      result[o + 3] = 255;
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
  const lattice = buildPaddedLattice();
  const material = buildMaterialTexture(step, undefined, CLASSIFY_SMOOTH_RADIUS, lattice);
  // The vegetation rule replaces the slope-only rock of the material bake (it rewrites sand, rock, stone in place).
  const masks = buildTerrainMasks(step, material, lattice);
  return {
    height,
    material,
    normal: buildNormalTexture(step, undefined, lattice),
    materialStep: step,
    pyramid: buildHeightPyramid(height, HEIGHT_DIM),
    ms: 0,
    masks,
  };
}

/** Bytes of the GPU copies, with the mip chains (a third more) of the material and normal textures. */
export function terrainTextureBytes(step: MaterialStep): { height: number; material: number; normal: number } {
  const dim = materialDim(step);
  const mipped = Math.round((dim * dim * 4 * 4) / 3);
  return { height: HEIGHT_DIM * HEIGHT_DIM * 4, material: mipped, normal: mipped };
}
