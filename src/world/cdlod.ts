import { WORLD_MIN } from './constants';
import { EDGE_COARSER, EDGE_FINER, EDGE_SAME, lodRange } from './cdlodMath';
import { LEAF_SIZE, LEVELS, LEVEL_OFFSET, NODES_PER_SIDE, ROOT_LEVEL } from './cdlodPyramid';

export { EDGE_COARSER, EDGE_FINER, EDGE_SAME, edgeState, frustumPlanes, lodRange, morphEnd, morphStart } from './cdlodMath';

/**
 * CDLOD node selection (Strugar 2010, adapted; ADR-0003, spec G2.0 phase B). Pure and allocation-free after
 * construction: everything the frame loop touches lives in preallocated typed arrays.
 *
 * Selection: a quadtree over the 4096 m square. A node is subdivided while the camera is within the range of
 * the next finer level of the node's 3D box (min/max height from the pyramid); otherwise it is drawn. The
 * ranges double per level. A balancing pass then splits any node that touches a neighbour more than one level
 * finer, so neighbours always differ by at most one level (the shader stitches those borders).
 * Culling only removes output: the selection itself never depends on the camera frustum.
 */
export const MAX_NODES = 1024;
/** Most shadow cascades a tier uses (per-cascade caster lists). */
export const MAX_CASCADES = 4;

const STACK_SIZE = 64;
const GRID_CELLS = NODES_PER_SIDE * NODES_PER_SIDE;

export class CdlodSelector {
  /** Drawn nodes: `(originX, originZ, size, level)` per node, `count` valid. */
  readonly nodes = new Float32Array(MAX_NODES * 4);
  /** Packed edge relations per drawn node: `north + 3 east + 9 south + 27 west` (see EDGE_*). */
  readonly edges = new Float32Array(MAX_NODES);
  /** Shadow casters: same layout, selected by distance only (no camera frustum). */
  readonly casters = new Float32Array(MAX_NODES * 4);
  readonly casterEdges = new Float32Array(MAX_NODES);
  /** Casters inside each shadow cascade's light frustum (see `cullCascade`): same layout, one list per cascade. */
  readonly cascadeNodes: Float32Array[] = [];
  readonly cascadeEdges: Float32Array[] = [];
  readonly cascadeCount = new Int32Array(MAX_CASCADES);
  /** Set by `cullCascade`: that cascade's list differs from the previous call's. */
  readonly cascadeChanged = new Uint8Array(MAX_CASCADES);
  count = 0;
  casterCount = 0;
  /** Selected nodes dropped by the frustum test. */
  culled = 0;
  /** Drawn nodes per level. */
  readonly perLevel = new Int32Array(LEVELS);
  /** Set by `select`: the drawn / caster list differs from the previous call's. */
  nodesChanged = false;
  castersChanged = false;
  /** True if a list had to be truncated at MAX_NODES. */
  overflow = false;
  private readonly range2 = new Float64Array(LEVELS);
  private readonly shadowFar2: number;
  /** Level of the selected node covering each 64 m cell (row-major, z rows). */
  private readonly grid = new Int8Array(GRID_CELLS);
  private readonly stack = new Int32Array(STACK_SIZE);
  private readonly lastEye = new Float64Array(3).fill(NaN);
  private readonly lastPlanes = new Float32Array(24);
  private lastHadPlanes = false;

  constructor(private readonly pyramid: Float32Array, lod0Distance: number, shadowFar: number) {
    for (let level = 0; level < LEVELS; level++) this.range2[level] = lodRange(lod0Distance, level) ** 2;
    this.shadowFar2 = shadowFar * shadowFar;
    for (let c = 0; c < MAX_CASCADES; c++) {
      this.cascadeNodes.push(new Float32Array(MAX_NODES * 4));
      this.cascadeEdges.push(new Float32Array(MAX_NODES));
    }
  }

  /** Nodes selected before culling. */
  get selected(): number {
    return this.count + this.culled;
  }

  /**
   * Selects the nodes for an eye at world (ex, ey, ez). `planes` (camera-relative frustum planes, see
   * `frustumPlanes`) culls the drawn list; null keeps every selected node. Skips all work when the eye and
   * planes equal the previous call's.
   * @hot
   */
  select(ex: number, ey: number, ez: number, planes: Float32Array | null): void {
    if (this.unchanged(ex, ey, ez, planes)) {
      this.nodesChanged = false;
      this.castersChanged = false;
      return;
    }
    this.classify(ex, ey, ez);
    this.balance();
    this.emit(ex, ey, ez, planes);
  }

  /**
   * Fills cascade `c`'s list with the casters that intersect its light frustum. `planes` are the light camera's
   * frustum planes in camera-relative space (as `frustumPlanes` gives them, optionally pushed outwards by a margin);
   * null keeps every caster. Call after `select`, once per frame per cascade.
   * @hot
   */
  cullCascade(c: number, ex: number, ey: number, ez: number, planes: Float32Array | null): void {
    const nodes = this.cascadeNodes[c];
    const edges = this.cascadeEdges[c];
    const { casters, casterEdges } = this;
    let n = 0;
    let changed = false;
    for (let i = 0; i < this.casterCount; i++) {
      const x = casters[i * 4];
      const z = casters[i * 4 + 1];
      const size = casters[i * 4 + 2];
      const level = casters[i * 4 + 3];
      if (planes !== null && !this.inFrustum(planes, x - ex, z - ez, size, level, (x - WORLD_MIN) / size, (z - WORLD_MIN) / size, ey)) continue;
      if (put(nodes, edges, n, x, z, size, level, casterEdges[i])) changed = true;
      n++;
    }
    this.cascadeChanged[c] = changed || n !== this.cascadeCount[c] ? 1 : 0;
    this.cascadeCount[c] = n;
  }

  /** @hot */
  private unchanged(ex: number, ey: number, ez: number, planes: Float32Array | null): boolean {
    const { lastEye, lastPlanes } = this;
    let same = lastEye[0] === ex && lastEye[1] === ey && lastEye[2] === ez && this.lastHadPlanes === (planes !== null);
    if (same && planes !== null) {
      for (let i = 0; i < 24; i++) if (lastPlanes[i] !== planes[i]) same = false;
    }
    if (same) return true;
    lastEye[0] = ex;
    lastEye[1] = ey;
    lastEye[2] = ez;
    this.lastHadPlanes = planes !== null;
    if (planes !== null) lastPlanes.set(planes);
    return false;
  }

  /** Squared distance from the eye to the 3D box of node (level, ix, iz). @hot */
  private nodeDist2(level: number, ix: number, iz: number, ex: number, ey: number, ez: number): number {
    const size = LEAF_SIZE << level;
    const x0 = WORLD_MIN + ix * size - ex;
    const z0 = WORLD_MIN + iz * size - ez;
    const o = (LEVEL_OFFSET[level] + iz * (NODES_PER_SIDE >> level) + ix) * 2;
    const y0 = this.pyramid[o] - ey;
    const y1 = this.pyramid[o + 1] - ey;
    const dx = x0 > 0 ? x0 : x0 + size < 0 ? -(x0 + size) : 0;
    const dy = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
    const dz = z0 > 0 ? z0 : z0 + size < 0 ? -(z0 + size) : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Sets every cell of node (level, ix, iz) to `value`. @hot */
  private fill(level: number, ix: number, iz: number, value: number): void {
    const n = 1 << level;
    const x0 = ix << level;
    for (let z = iz << level, end = z + n; z < end; z++) {
      this.grid.fill(value, z * NODES_PER_SIDE + x0, z * NODES_PER_SIDE + x0 + n);
    }
  }

  /** Top-down CDLOD selection into the cell grid. @hot */
  private classify(ex: number, ey: number, ez: number): void {
    const { stack, range2 } = this;
    let sp = 0;
    stack[sp++] = ROOT_LEVEL << 12;
    while (sp > 0) {
      const n = stack[--sp];
      const level = n >> 12;
      const iz = (n >> 6) & 63;
      const ix = n & 63;
      if (level > 0 && this.nodeDist2(level, ix, iz, ex, ey, ez) <= range2[level - 1]) {
        const child = (level - 1) << 12;
        const bx = ix * 2;
        const bz = iz * 2;
        stack[sp++] = child | (bz << 6) | bx;
        stack[sp++] = child | (bz << 6) | (bx + 1);
        stack[sp++] = child | ((bz + 1) << 6) | bx;
        stack[sp++] = child | ((bz + 1) << 6) | (bx + 1);
      } else {
        this.fill(level, ix, iz, level);
      }
    }
  }

  /** Splits nodes until no two neighbours differ by more than one level. @hot */
  private balance(): void {
    const { grid } = this;
    for (;;) {
      let changed = false;
      for (let cz = 0; cz < NODES_PER_SIDE; cz++) {
        for (let cx = 0; cx < NODES_PER_SIDE; cx++) {
          const i = cz * NODES_PER_SIDE + cx;
          const level = grid[i];
          if (level < 2) continue;
          const limit = level - 2;
          if (
            (cx > 0 && grid[i - 1] <= limit) || (cx < NODES_PER_SIDE - 1 && grid[i + 1] <= limit)
            || (cz > 0 && grid[i - NODES_PER_SIDE] <= limit) || (cz < NODES_PER_SIDE - 1 && grid[i + NODES_PER_SIDE] <= limit)
          ) {
            this.fill(level, cx >> level, cz >> level, level - 1);
            changed = true;
          }
        }
      }
      if (!changed) return;
    }
  }

  /** Relation of the neighbour cell (cx, cz) to a node of `level`: EDGE_*. Outside the world counts as same. @hot */
  private relation(cx: number, cz: number, level: number): number {
    if (cx < 0 || cz < 0 || cx >= NODES_PER_SIDE || cz >= NODES_PER_SIDE) return EDGE_SAME;
    const other = this.grid[cz * NODES_PER_SIDE + cx];
    return other > level ? EDGE_COARSER : other < level ? EDGE_FINER : EDGE_SAME;
  }

  /** Walks the balanced grid and writes the drawn and caster lists. @hot */
  private emit(ex: number, ey: number, ez: number, planes: Float32Array | null): void {
    const { stack, grid, perLevel } = this;
    let n = 0;
    let c = 0;
    let culled = 0;
    let nodesChanged = false;
    let castersChanged = false;
    let overflow = false;
    perLevel.fill(0);
    let sp = 0;
    stack[sp++] = ROOT_LEVEL << 12;
    while (sp > 0) {
      const packed = stack[--sp];
      const level = packed >> 12;
      const iz = (packed >> 6) & 63;
      const ix = packed & 63;
      const cx = ix << level;
      const cz = iz << level;
      if (grid[cz * NODES_PER_SIDE + cx] !== level) {
        const child = (level - 1) << 12;
        const bx = ix * 2;
        const bz = iz * 2;
        stack[sp++] = child | (bz << 6) | bx;
        stack[sp++] = child | (bz << 6) | (bx + 1);
        stack[sp++] = child | ((bz + 1) << 6) | bx;
        stack[sp++] = child | ((bz + 1) << 6) | (bx + 1);
        continue;
      }
      const size = LEAF_SIZE << level;
      const x0 = WORLD_MIN + ix * size;
      const z0 = WORLD_MIN + iz * size;
      const span = 1 << level;
      const code = this.relation(cx, cz - 1, level) + 3 * this.relation(cx + span, cz, level)
        + 9 * this.relation(cx, cz + span, level) + 27 * this.relation(cx - 1, cz, level);
      if (planes === null || this.inFrustum(planes, x0 - ex, z0 - ez, size, level, ix, iz, ey)) {
        if (n < MAX_NODES) {
          if (put(this.nodes, this.edges, n, x0, z0, size, level, code)) nodesChanged = true;
          perLevel[level]++;
          n++;
        } else {
          overflow = true;
        }
      } else {
        culled++;
      }
      if (this.nodeDist2(level, ix, iz, ex, ey, ez) <= this.shadowFar2) {
        if (c < MAX_NODES) {
          if (put(this.casters, this.casterEdges, c, x0, z0, size, level, code)) castersChanged = true;
          c++;
        } else {
          overflow = true;
        }
      }
    }
    this.nodesChanged = nodesChanged || n !== this.count;
    this.castersChanged = castersChanged || c !== this.casterCount;
    this.count = n;
    this.casterCount = c;
    this.culled = culled;
    this.overflow = overflow;
  }

  /** Box-versus-planes test; (rx, rz) is the node's min corner relative to the eye. @hot */
  private inFrustum(
    planes: Float32Array, rx: number, rz: number, size: number, level: number, ix: number, iz: number, ey: number,
  ): boolean {
    const o = (LEVEL_OFFSET[level] + iz * (NODES_PER_SIDE >> level) + ix) * 2;
    const ry0 = this.pyramid[o] - ey;
    const ry1 = this.pyramid[o + 1] - ey;
    for (let p = 0; p < 24; p += 4) {
      const nx = planes[p];
      const ny = planes[p + 1];
      const nz = planes[p + 2];
      const px = nx >= 0 ? rx + size : rx;
      const py = ny >= 0 ? ry1 : ry0;
      const pz = nz >= 0 ? rz + size : rz;
      if (nx * px + ny * py + nz * pz + planes[p + 3] < 0) return false;
    }
    return true;
  }
}

/** Writes node `i` and reports whether it differs from what was there. @hot */
function put(
  nodes: Float32Array, edges: Float32Array, i: number, x: number, z: number, size: number, level: number, code: number,
): boolean {
  const o = i * 4;
  const differs = nodes[o] !== x || nodes[o + 1] !== z || nodes[o + 2] !== size || nodes[o + 3] !== level || edges[i] !== code;
  nodes[o] = x;
  nodes[o + 1] = z;
  nodes[o + 2] = size;
  nodes[o + 3] = level;
  edges[i] = code;
  return differs;
}
