import { WORLD_MAX, WORLD_MIN } from './constants';

/**
 * Camera-centred grass cells (spec G2.1 phase C.1). Pure and allocation-free after construction.
 *
 * The world is tiled with square cells of CELL_M metres on a grid snapped to the cell size, so a cell keeps its
 * identity (and so its blades, which the vertex shader derives from a hash of the cell index) however the camera
 * moves. Each frame the cells around the eye are classified by distance and culled against the camera frustum:
 *   dense:  blades with two segments and short companion leaves, cells whose centre is nearer than `nearM / 2`;
 *   thin:   fewer one-segment blades, the cells from there out to `nearM`;
 *   cards:  tufts of three blades, cells from `cardInnerM` to `midM`.
 * A cell can be in the thin and the card list at once (blades fade out as cards fade in). Cells whose
 * vegetation density is zero everywhere (water, rock, scree) are dropped, which keeps the sea and the cliffs free of
 * instances. Heights for the frustum test come from the CPU copy of the terrain; nothing is read back from the GPU.
 */
export const CELL_M = 8;
export const SPECIMEN_CELL_M = 2;
export const FLOWER_CELL_M = 4;
/** Cells per side of the world and the most cells each list can hold (the box around the eye at the largest tier). */
export const WORLD_CELLS = (WORLD_MAX - WORLD_MIN) / CELL_M;
export const MAX_DENSE_CELLS = 160;
export const MAX_THIN_CELLS = 384;
export const MAX_CARD_CELLS = 2048;
/** Vegetation density (0..255) below which a sample counts as empty. */
const EMPTY = 12;

export interface GrassRings {
  /** Blades reach this far; 0 disables blades (cards only). */
  nearM: number;
  /** Cards reach this far. */
  midM: number;
  /** Cards start here (inside it the blades carry the ground); 0 when there are no blades. */
  cardInnerM: number;
  /** Prefetch/retain cells in this margin around the camera frustum. */
  frustumPaddingM?: number;
  cellM?: typeof CELL_M | typeof SPECIMEN_CELL_M;
  /** Cutout turf reaches into the detailed mesh region and overlaps the baked surface. */
  tuftM?: number;
}

/** The CPU arrays the cell test reads: the height lattice (2 m) and the vegetation texture (R = meadow). */
export interface GrassGround {
  height: Float32Array;
  heightDim: number;
  vegetation: Uint8Array;
  vegetationDim: number;
  /** Lattice cells (2 m) per vegetation texel. */
  vegetationStep: number;
}

export class GrassCells {
  /** Cell origins `(x, z, 0, 0)` per cell, the first `denseCount` / `thinCount` / `cardCount` valid. */
  readonly dense = new Float32Array(MAX_DENSE_CELLS * 4);
  readonly thin = new Float32Array(MAX_THIN_CELLS * 4);
  readonly cards = new Float32Array(MAX_CARD_CELLS * 4);
  denseCount = 0;
  thinCount = 0;
  cardCount = 0;
  /** Set by `select`: a list differs from the previous call's (the instance buffers need an upload). */
  changed = false;
  /** True if a list overflowed its capacity (cells were dropped). */
  overflow = false;
  private readonly lastPlanes = new Float32Array(24);
  private lastX = NaN;
  private lastY = NaN;
  private lastZ = NaN;
  private lastHadPlanes = false;

  constructor(private readonly ground: GrassGround, private readonly rings: GrassRings) {}

  /** Height of the lattice point nearest (x, z), clamped to the lattice. @hot */
  private heightAt(x: number, z: number): number {
    const dim = this.ground.heightDim;
    let i = Math.round((x - WORLD_MIN) * 0.5);
    let j = Math.round((z - WORLD_MIN) * 0.5);
    i = i < 0 ? 0 : i >= dim ? dim - 1 : i;
    j = j < 0 ? 0 : j >= dim ? dim - 1 : j;
    return this.ground.height[j * dim + i];
  }

  /** Meadow or heath density (0..255, the larger of R and G) at the vegetation texel nearest (x, z): heath carries cards. @hot */
  private meadowAt(x: number, z: number): number {
    const { vegetationDim: dim, vegetationStep: step } = this.ground;
    let i = Math.round((x - WORLD_MIN) / (2 * step));
    let j = Math.round((z - WORLD_MIN) / (2 * step));
    i = i < 0 ? 0 : i >= dim ? dim - 1 : i;
    j = j < 0 ? 0 : j >= dim ? dim - 1 : j;
    const o = (j * dim + i) * 4;
    const meadow = this.ground.vegetation[o];
    const heath = this.ground.vegetation[o + 1];
    return meadow > heath ? meadow : heath;
  }

  /**
   * Selects the cells for an eye at (ex, ey, ez). `planes` are the camera-relative frustum planes
   * (`frustumPlanes`); null keeps every cell in range. Skips all work when the eye position and planes equal the previous call's.
   * @hot
   */
  select(ex: number, ey: number, ez: number, planes: Float32Array | null): void {
    const planesUnchanged = this.samePlanes(planes);
    if (ex === this.lastX && ey === this.lastY && ez === this.lastZ && planesUnchanged) {
      this.changed = false;
      return;
    }
    this.lastX = ex;
    this.lastY = ey;
    this.lastZ = ez;
    const { nearM, midM, cardInnerM, cellM = CELL_M, tuftM = 0 } = this.rings;
    const flowerM = cellM === SPECIMEN_CELL_M ? FLOWER_CELL_M : cellM;
    const flowerStride = flowerM / cellM;
    const flowerOffset = (flowerM - cellM) * 0.5;
    const halfDiagonal = cellM * Math.SQRT1_2;
    const worldCells = (WORLD_MAX - WORLD_MIN) / cellM;
    // Exclusive by cell-centre distance: a cell is drawn with one blade class only.
    const denseMax = nearM * 0.5;
    const thinMax = (tuftM || nearM) + halfDiagonal;
    const cardMin = cardInnerM - flowerM * Math.SQRT1_2;
    const cardMax = midM + flowerM * Math.SQRT1_2;
    const reach = Math.max(nearM, midM, tuftM) + flowerM;
    const i0 = Math.max(0, Math.floor((ex - reach - WORLD_MIN) / cellM));
    const i1 = Math.min(worldCells - 1, Math.floor((ex + reach - WORLD_MIN) / cellM));
    const j0 = Math.max(0, Math.floor((ez - reach - WORLD_MIN) / cellM));
    const j1 = Math.min(worldCells - 1, Math.floor((ez + reach - WORLD_MIN) / cellM));
    let nd = 0;
    let nt = 0;
    let nc = 0;
    let overflow = false;
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      const z0 = WORLD_MIN + j * cellM;
      const dz = z0 + cellM * 0.5 - ez;
      for (let i = i0; i <= i1; i++) {
        const x0 = WORLD_MIN + i * cellM;
        const dx = x0 + cellM * 0.5 - ex;
        const d = Math.sqrt(dx * dx + dz * dz);
        const dense = nearM > 0 && d < denseMax;
        const thin = nearM > 0 && (tuftM > 0 || d >= denseMax) && d < thinMax;
        // Flowering plants still share a coarser grid. Small fescue cells spend the budget close to the eye.
        const cardDistance = flowerStride === 1 ? d : Math.hypot(dx + flowerOffset, dz + flowerOffset);
        const card = i % flowerStride === 0 && j % flowerStride === 0 && cardDistance > cardMin && cardDistance < cardMax;
        if (!dense && !thin && !card) continue;
        const bladeCell = (dense || thin) && this.occupied(x0, z0, ex, ey, ez, cellM, planes);
        if (dense && bladeCell) {
          if (nd < MAX_DENSE_CELLS) changed = put(this.dense, nd++, x0, z0) || changed;
          else overflow = true;
        }
        if (thin && bladeCell) {
          if (nt < MAX_THIN_CELLS) changed = put(this.thin, nt++, x0, z0) || changed;
          else overflow = true;
        }
        if (card && (flowerStride === 1 && bladeCell || this.occupied(x0, z0, ex, ey, ez, flowerM, planes))) {
          if (nc < MAX_CARD_CELLS) changed = put(this.cards, nc++, x0, z0) || changed;
          else overflow = true;
        }
      }
    }
    this.changed = changed || nd !== this.denseCount || nt !== this.thinCount || nc !== this.cardCount;
    this.denseCount = nd;
    this.thinCount = nt;
    this.cardCount = nc;
    this.overflow = overflow;
  }

  /** Cell has meadow somewhere and its box is inside the frustum. @hot */
  private occupied(x0: number, z0: number, ex: number, ey: number, ez: number, cellM: number, planes: Float32Array | null): boolean {
    const x1 = x0 + cellM;
    const z1 = z0 + cellM;
    const xm = x0 + cellM * 0.5;
    const zm = z0 + cellM * 0.5;
    if (this.meadowAt(xm, zm) < EMPTY && this.meadowAt(x0, z0) < EMPTY && this.meadowAt(x1, z0) < EMPTY
      && this.meadowAt(x0, z1) < EMPTY && this.meadowAt(x1, z1) < EMPTY) return false;
    if (planes === null) return true;
    const hc = this.heightAt(xm, zm);
    const h1 = this.heightAt(x0, z0);
    const h2 = this.heightAt(x1, z0);
    const h3 = this.heightAt(x0, z1);
    const h4 = this.heightAt(x1, z1);
    const lo = Math.min(hc, h1, h2, h3, h4);
    const hi = Math.max(hc, h1, h2, h3, h4);
    // Blades are under a metre tall; the margin also covers the relief between the five samples.
    const ry0 = lo - 1.5 - 0.25 * (hi - lo) - ey;
    const ry1 = hi + 1.5 + 0.25 * (hi - lo) - ey;
    const rx = x0 - ex;
    const rz = z0 - ez;
    const padding = this.rings.frustumPaddingM ?? 0;
    for (let p = 0; p < 24; p += 4) {
      const nx = planes[p];
      const ny = planes[p + 1];
      const nz = planes[p + 2];
      const px = nx >= 0 ? rx + cellM : rx;
      const py = ny >= 0 ? ry1 : ry0;
      const pz = nz >= 0 ? rz + cellM : rz;
      if (nx * px + ny * py + nz * pz + planes[p + 3] < -padding) return false;
    }
    return true;
  }

  /** @hot */
  private samePlanes(planes: Float32Array | null): boolean {
    if (planes === null) return !this.lastHadPlanes;
    if (!this.lastHadPlanes) {
      this.lastPlanes.set(planes);
      this.lastHadPlanes = true;
      return false;
    }
    let same = true;
    for (let k = 0; k < 24; k++) {
      if (this.lastPlanes[k] !== planes[k]) {
        this.lastPlanes[k] = planes[k];
        same = false;
      }
    }
    return same;
  }
}

/** Writes cell `n` and reports whether it differs from what was there. @hot */
function put(cells: Float32Array, n: number, x: number, z: number): boolean {
  const o = n * 4;
  const differs = cells[o] !== x || cells[o + 1] !== z;
  cells[o] = x;
  cells[o + 1] = z;
  return differs;
}
