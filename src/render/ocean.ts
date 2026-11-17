import { BufferAttribute, BufferGeometry, DataUtils, Mesh } from 'three/webgpu';
import { waveSet, waveSlope } from '../env/ocean';
import type { Weather } from '../env/weather';
import { SEAFLOOR_DIM } from '../world/seaFloor';
import { createOceanMaterial, createOceanUniforms, createSeaFloorTexture } from './oceanMaterial';
import type { SkyDome } from './sky';

/** Grid: 160 x 160 quads (80 x 80 on the lite tier), 1.5 m at the centre growing geometrically to +-3500 m. */
const HALF_CELLS = 80;
const HALF_CELLS_LITE = 40;
const FINE_SPACING = 1.5;
const EXTENT = 3500;
const DEEP_METRES = -40;

/** Offset of the t-th grid line: s(t) = 1.5 (r^t - 1) / (r - 1). */
function lineOffset(t: number, ratio: number): number {
  return (FINE_SPACING * (ratio ** t - 1)) / (ratio - 1);
}

/** Solves s(HALF_CELLS) = EXTENT for the growth ratio by bisection. */
function solveRatio(half: number): number {
  let lo = 1.0001;
  let hi = 1.5;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (lineOffset(half, mid) < EXTENT) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function buildGrid(half: number): BufferGeometry {
  const ratio = solveRatio(half);
  const side = 2 * half + 1;
  const lines = new Float32Array(side);
  for (let t = -half; t <= half; t++) {
    lines[t + half] = Math.sign(t) * lineOffset(Math.abs(t), ratio);
  }
  const positions = new Float32Array(side * side * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const o = (j * side + i) * 3;
      positions[o] = lines[i];
      positions[o + 2] = lines[j];
    }
  }
  const indices = new Uint16Array((side - 1) * (side - 1) * 6);
  let k = 0;
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const a = j * side + i;
      const b = a + side;
      // Counter-clockwise seen from above (+y), +x east and +z south.
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
      indices[k++] = a + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Gerstner ocean on a camera-centred grid (G1.4). The mesh follows the eye in
 * steps of the finest spacing so near vertices stay fixed on the waves; the
 * shader works in absolute world coordinates (snapped eye + local position).
 */
export class Ocean {
  readonly mesh: Mesh;
  /** GPU bytes held by the grid and the sea-floor texture (for the memory partition). */
  readonly gpuBytes: number;
  private readonly uniforms = createOceanUniforms();
  private readonly floorData = new Uint16Array(SEAFLOOR_DIM * SEAFLOOR_DIM).fill(DataUtils.toHalfFloat(DEEP_METRES));
  readonly floorTexture = createSeaFloorTexture(this.floorData, SEAFLOOR_DIM);

  constructor(sky: SkyDome, lite = false) {
    const geometry = buildGrid(lite ? HALF_CELLS_LITE : HALF_CELLS);
    this.mesh = new Mesh(geometry, createOceanMaterial(sky, this.floorTexture, this.uniforms, lite));
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.floorTexture.needsUpdate = true;
    this.gpuBytes = geometry.getAttribute('position').array.byteLength + (geometry.index?.array.byteLength ?? 0)
      + this.floorData.byteLength;
    this.setWeather('clear');
  }

  /**
   * Publishes the sea-floor height map (metres) as half floats. The texture
   * is allocated at full size up front (filled with deep water) so the upload
   * never has to resize a live GPU texture.
   * @amortized once per session: 262 k conversions
   */
  setSeaFloor(heights: Float32Array): void {
    const n = Math.min(heights.length, this.floorData.length);
    for (let i = 0; i < n; i++) this.floorData[i] = DataUtils.toHalfFloat(heights[i]);
    this.floorTexture.needsUpdate = true;
  }

  /** @amortized weather changes only */
  setWeather(weather: Weather): void {
    const waves = waveSet(weather);
    let sum = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const k = (2 * Math.PI) / w.wavelength;
      this.uniforms.waveA[i].value.set(w.dirX, w.dirZ, k, k * w.speed);
      this.uniforms.waveB[i].value.set(w.amplitude, w.steepness, 0, 0);
      sum += w.amplitude;
    }
    const slope = waveSlope(weather);
    // Crest foam only in rain and storm: ramps from slope 0.05 to 0.11.
    this.uniforms.weather.value.set(slope, sum, Math.min(1, Math.max(0, slope - 0.05) / 0.06), 0);
  }

  /** @hot uniform and transform writes only */
  update(eyeX: number, eyeY: number, eyeZ: number, timeSeconds: number): void {
    const modX = eyeX - Math.floor(eyeX / FINE_SPACING) * FINE_SPACING;
    const modZ = eyeZ - Math.floor(eyeZ / FINE_SPACING) * FINE_SPACING;
    this.mesh.position.set(-modX, -eyeY, -modZ);
    this.uniforms.eye.value.set(eyeX, eyeY, eyeZ);
    this.uniforms.eyeSnap.value.set(eyeX - modX, eyeZ - modZ);
    this.uniforms.time.value = timeSeconds;
  }
}
