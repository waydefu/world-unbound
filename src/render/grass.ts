import { Group, type Camera, type DataTexture, Matrix4, Mesh, Vector3, Vector4, type InstancedBufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MemoryPartition, type MemoryRegistry } from '../perf/memoryRegistry';
import { frustumPlanes } from '../world/cdlod';
import { CELL_M, GrassCells } from '../world/grassCells';
import type { TerrainTextureData } from '../world/terrainTextures';
import { type GrassGeometry, createBladeGeometry, createCardGeometry } from './grassGeometry';
import { createGrassMaterial, type GrassKind } from './grassMaterial';
import { CARD_FADE_JITTER_SHARE, CLUMPS_PER_CELL, GUST_WAVELENGTH_M, THIN_BLADE_STRIDE, type GrassInputs, type GrassLayout, type GrassUniforms } from './grassField';
import { createGrassCardTexture } from './noiseTextures';
import type { TerrainTextures } from './terrainTextures';

/** Per-tier grass reach and density (spec G2.1 phase C.1, C.2, C.8). */
export interface GrassSettings {
  /** Blades reach this far (m); 0 = no blades, cards only (low tier). */
  readonly nearM: number;
  /** Cards reach this far (m). */
  readonly midM: number;
  /** Blades per m2 where the meadow density is 1. */
  readonly bladesPerM2: number;
  /** Cards per m2 where the meadow density is 1. */
  readonly cardsPerM2: number;
}

const CELL_AREA = CELL_M * CELL_M;
const DENSE_COMPANIONS = 2;
/** 16-bit indices: 11 vertices per dense placement (5 primary plus two three-vertex companions). */
const MAX_BLADES_PER_CELL = 5000;
/** Gust phase advances this many cycles per m/s of wind speed per second (gust fronts move with the wind). */
const GUST_CYCLES_PER_MS = 1.1 / GUST_WAVELENGTH_M;
/** Longest frame step (s) that advances the travelling gusts; a longer stall (tab switch) does not make them jump. */
const MAX_GUST_STEP_S = 1;
/** Cards overlap the dense-to-thin blade transition. */
const CARD_INNER_SHARE = 0.20;

/** Statistics of the last selection, for telemetry. */
export interface GrassStats {
  cells: number;
  blades: number;
  cards: number;
  triangles: number;
  /** Cell selection and instance-buffer work of the last update, ms (smoothed). */
  ms: number;
}

interface Draw {
  readonly mesh: Mesh;
  readonly parts: GrassGeometry;
}

/**
 * Grass (spec G2.1 phase C): up to three instanced draws (dense blades, thin blades, cards) whose instances are
 * the 8 m cells the CPU selects around the camera (world/grassCells.ts). Blades are generated in the vertex
 * shader from (cell, index); see grassField.ts. Blades do not cast shadows; they receive them where `shadows`.
 */
export class GrassLayer {
  readonly root = new Group();
  readonly stats: GrassStats = { cells: 0, blades: 0, cards: 0, triangles: 0, ms: 0 };
  /** Bytes of the static geometry and instance lists (GPU copy; the CPU arrays are retained too). */
  readonly bytes: number;
  readonly bladesPerDenseCell: number;
  readonly bladesPerThinCell: number;
  readonly cardsPerCell: number;
  private readonly cells: GrassCells;
  private readonly draws: Array<Draw | null>;
  private readonly uniforms: GrassUniforms;
  private readonly viewProjection = new Matrix4();
  private readonly planes = new Float32Array(24);
  private lastS = 0;
  readonly cardUploadBytes: number;
  private readonly cardGpuBytes: number;

  constructor(options: {
    textures: TerrainTextures; data: TerrainTextureData; noise: DataTexture; wind: DataTexture;
    settings: GrassSettings; shadows: boolean; lite: boolean; sward?: boolean;
  }) {
    const { textures, data, noise, wind, settings, shadows, lite } = options;
    const sward = options.sward === true && !lite;
    const card = sward ? createGrassCardTexture() : null;
    this.cardUploadBytes = card?.uploadBytes ?? 0;
    this.cardGpuBytes = card?.gpuBytes ?? 0;
    const masks = data.masks;
    if (!masks) throw new Error('grass needs the vegetation masks of the terrain bake');
    const blades = settings.nearM > 0;
    this.cells = new GrassCells(
      {
        height: data.height, heightDim: textures.height.image.width, vegetation: masks.vegetation,
        vegetationDim: textures.materialDim, vegetationStep: textures.materialStep,
      },
      { nearM: settings.nearM, midM: settings.midM, cardInnerM: blades ? settings.nearM * (CARD_INNER_SHARE - CARD_FADE_JITTER_SHARE / 2) : 0 },
    );
    this.bladesPerDenseCell = Math.min(MAX_BLADES_PER_CELL, Math.round(CELL_AREA * settings.bladesPerM2));
    this.bladesPerThinCell = Math.ceil(this.bladesPerDenseCell / THIN_BLADE_STRIDE);
    this.cardsPerCell = Math.min(7000, Math.round(CELL_AREA * settings.cardsPerM2));
    this.uniforms = {
      eye: uniform(new Vector3()), wind: uniform(new Vector4(0, 1, 3, 0)), time: uniform(0), gustPhase: uniform(0),
      season: uniform(new Vector3(1, 0, 0)), wetness: uniform(0), sunDir: uniform(new Vector3(0, 1, 0)), sunColour: uniform(new Vector3()),
      rings: uniform(new Vector4(settings.nearM, settings.midM, blades ? settings.nearM * CARD_INNER_SHARE : -1000, 0)),
    };
    const inputs: GrassInputs = {
      height: textures.height, normal: textures.normal, vegetation: textures.vegetation, wetness: textures.wetness,
      noise, wind, sward, cardMask: card?.texture ?? null, vegetationDim: textures.materialDim, vegetationStep: textures.materialStep,
    };
    // Clump layout: dense blades per clump, a thin blade is every second dense blade, cards per clump (grassField.ts).
    const perClump = this.bladesPerDenseCell / CLUMPS_PER_CELL;
    const denseLayout: GrassLayout = { stride: 1, perClump };
    const thinLayout: GrassLayout = { stride: THIN_BLADE_STRIDE, perClump };
    const cardLayout: GrassLayout = { stride: 1, perClump: this.cardsPerCell / CLUMPS_PER_CELL };
    this.draws = [
      blades ? this.draw('dense', createBladeGeometry(this.bladesPerDenseCell, 2, this.cells.dense, DENSE_COMPANIONS), inputs, denseLayout, shadows, lite) : null,
      blades ? this.draw('thin', createBladeGeometry(this.bladesPerThinCell, 1, this.cells.thin), inputs, thinLayout, shadows, lite) : null,
      this.draw('card', createCardGeometry(this.cardsPerCell, this.cells.cards), inputs, cardLayout, shadows, lite),
    ];
    this.root.name = 'grass';
    let bytes = 0;
    for (const d of this.draws) if (d) bytes += d.parts.bytes;
    this.bytes = bytes;
  }

  private draw(kind: GrassKind, parts: GrassGeometry, inputs: GrassInputs, layout: GrassLayout, shadows: boolean, lite: boolean): Draw {
    const mesh = new Mesh(parts.geometry, createGrassMaterial(kind, inputs, this.uniforms, layout, lite));
    mesh.name = `grass-${kind}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = shadows;
    // Visible with one (zeroed) cell until the first update: the warm-up compiles the pipelines of visible meshes
    // only, and the first update publishes the real selection (an empty list hides the mesh).
    parts.geometry.instanceCount = 1;
    this.root.add(mesh);
    return { mesh, parts };
  }

  /** Accounts the static buffers (GPU copy and retained CPU arrays); the textures are accounted by the app. */
  account(memory: MemoryRegistry): void {
    memory.add(MemoryPartition.Gpu, this.bytes + this.cardGpuBytes);
    memory.add(MemoryPartition.CpuRetained, this.bytes + this.cardUploadBytes);
  }

  /** Season weights (fresh, summer, straw). */
  setSeason(fresh: number, summer: number, straw: number): void {
    this.uniforms.season.value.set(fresh, summer, straw);
  }

  /** Ground wetness of the weather, 0..1. */
  setWetness(wetness: number): void {
    this.uniforms.wetness.value = wetness;
  }

  /** Sun direction (unit, towards the sun) and its pre-exposed illuminance colour. @hot */
  setSun(dx: number, dy: number, dz: number, r: number, g: number, b: number): void {
    this.uniforms.sunDir.value.set(dx, dy, dz);
    this.uniforms.sunColour.value.set(r, g, b);
  }

  /** Global wind: unit direction (x east, z south), mean speed (m/s) and gust factor 0..1. @hot */
  setWind(dirX: number, dirZ: number, speedMs: number, gust01: number): void {
    this.uniforms.wind.value.set(dirX, dirZ, speedMs, gust01);
  }

  /**
   * Selects the cells for the eye and the camera's frustum and publishes the lists that changed. The camera's
   * matrices must be current. `dtSeconds` advances the travelling gust phase.
   * @hot
   */
  update(ex: number, ey: number, ez: number, camera: Camera, nowSeconds: number, dtSeconds: number): void {
    const started = performance.now();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustumPlanes(this.viewProjection.elements, this.planes);
    const { cells, uniforms, stats } = this;
    cells.select(ex, ey, ez, this.planes);
    if (cells.changed) {
      publish(this.draws[0], cells.denseCount);
      publish(this.draws[1], cells.thinCount);
      publish(this.draws[2], cells.cardCount);
      stats.cells = cells.denseCount + cells.thinCount + cells.cardCount;
      stats.blades = cells.denseCount * this.bladesPerDenseCell * (1 + DENSE_COMPANIONS) + cells.thinCount * this.bladesPerThinCell;
      stats.cards = cells.cardCount * this.cardsPerCell;
      stats.triangles = cells.denseCount * (this.draws[0]?.parts.trianglesPerInstance ?? 0)
        + cells.thinCount * (this.draws[1]?.parts.trianglesPerInstance ?? 0)
        + cells.cardCount * (this.draws[2]?.parts.trianglesPerInstance ?? 0);
    }
    uniforms.eye.value.set(ex, ey, ez);
    uniforms.time.value = nowSeconds;
    if (dtSeconds > 0 && dtSeconds < MAX_GUST_STEP_S) this.lastS += dtSeconds * GUST_CYCLES_PER_MS * Math.max(uniforms.wind.value.z, 1.5);
    uniforms.gustPhase.value = this.lastS;
    stats.ms += (performance.now() - started - stats.ms) * 0.05;
  }
}

/** Draws the first `count` instances and schedules the cell buffer for upload. @hot */
function publish(draw: Draw | null, count: number): void {
  if (draw === null) return;
  draw.parts.geometry.instanceCount = count;
  draw.mesh.visible = count > 0;
  (draw.parts.cells as InstancedBufferAttribute).needsUpdate = true;
}
