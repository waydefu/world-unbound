import { WORLD_MIN, WORLD_MAX } from './constants';

export const SOIL_CELL_M = 16;
export const SOIL_DIM = (WORLD_MAX - WORLD_MIN) / SOIL_CELL_M;
export const SOIL_CELLS = SOIL_DIM * SOIL_DIM;
export const SURFACE_WATER_SCALE_MM = 8;

type Horizon = { readonly depthMm: number; readonly residual: number; readonly field: number; readonly saturated: number; readonly conductivity: number };
type Profile = { readonly top: Horizon; readonly lower: Horizon };

/** Rosetta texture-class estimates, with project-assumed horizon depths (mm). */
export const SOIL_PROFILES: readonly (Profile | null)[] = [
  null,
  { top: { depthMm: 180, residual: .039, field: .1674, saturated: .387, conductivity: 15.95 },
    lower: { depthMm: 300, residual: .049, field: .1032, saturated: .390, conductivity: 43.83 } },
  { top: { depthMm: 80, residual: .039, field: .1674, saturated: .387, conductivity: 15.95 },
    lower: { depthMm: 120, residual: .061, field: .2346, saturated: .399, conductivity: 5.02 } },
];

export interface SoilMap {
  readonly profile: Uint8Array;
  readonly downstream: Int32Array;
  readonly dim: number;
}

export interface SoilFlux {
  rain: number;
  evaporated: number;
  drainage: number;
  exported: number;
}

/** Land routes overflow to its steepest downhill neighbour. -1 is a depression, -2 is an outlet. */
export function buildSoilMap(profile: Uint8Array, height: Float32Array, dim = SOIL_DIM): SoilMap {
  if (profile.length !== dim * dim || height.length !== dim * dim) throw new Error('Invalid soil lattice');
  const downstream = new Int32Array(profile.length).fill(-1);
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      const i = z * dim + x;
      if (!profile[i]) continue;
      let bestSlope = 0.001;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= dim || nz >= dim) continue;
          const j = nz * dim + nx;
          const slope = (height[i] - height[j]) / (dx && dz ? Math.SQRT2 : 1);
          if (slope <= bestSlope) continue;
          bestSlope = slope;
          downstream[i] = profile[j] ? j : -2;
        }
      }
    }
  }
  return { profile, downstream, dim };
}

function storage(horizon: Horizon, fraction: number): number {
  return horizon.depthMm * fraction;
}

/** Three millimetre-of-water columns per cell: topsoil, subsoil and surface film. */
export class SoilWaterGrid {
  readonly state: Float32Array;
  private readonly runoff: Float32Array;
  private readonly flux: SoilFlux = { rain: 0, evaporated: 0, drainage: 0, exported: 0 };

  constructor(readonly map: SoilMap, state?: Float32Array) {
    if (state && state.length !== map.profile.length * 3) throw new Error('Invalid soil water snapshot');
    this.state = state ?? new Float32Array(map.profile.length * 3);
    this.runoff = new Float32Array(map.profile.length);
    if (!state) this.reset(1);
  }

  /** A fraction of field capacity above residual water. */
  reset(fill: number): void {
    for (let i = 0; i < this.map.profile.length; i++) {
      const p = SOIL_PROFILES[this.map.profile[i]];
      const at = i * 3;
      this.state[at] = p ? storage(p.top, p.top.residual + (p.top.field - p.top.residual) * fill) : 0;
      this.state[at + 1] = p ? storage(p.lower, p.lower.residual + (p.lower.field - p.lower.residual) * fill) : 0;
      this.state[at + 2] = 0;
    }
  }

  /** Bucket hydrology. Flux values are summed mm over equal-area cells, for conservation checks. */
  step(seconds: number, rainMmH: number, evaporationMmH: number): SoilFlux {
    const { state, runoff, flux, map } = this;
    const hours = Math.max(0, seconds) / 3600;
    const rain = Math.max(0, rainMmH) * hours;
    const evaporation = Math.max(0, evaporationMmH) * hours;
    runoff.fill(0);
    flux.rain = 0;
    flux.evaporated = 0;
    flux.drainage = 0;
    flux.exported = 0;
    for (let i = 0; i < map.profile.length; i++) {
      const p = SOIL_PROFILES[map.profile[i]];
      if (!p) continue;
      const offset = i * 3;
      let top = state[offset];
      let lower = state[offset + 1];
      let film = state[offset + 2] + rain;
      flux.rain += rain;

      const topMax = storage(p.top, p.top.saturated);
      const lowerMax = storage(p.lower, p.lower.saturated);
      const infiltrated = Math.min(film, Math.max(0, topMax - top), p.top.conductivity * hours);
      film -= infiltrated;
      top += infiltrated;
      const transfer = Math.min(Math.max(0, top - storage(p.top, p.top.field)), Math.max(0, lowerMax - lower),
        Math.min(p.top.conductivity, p.lower.conductivity) * hours);
      top -= transfer;
      lower += transfer;
      const drained = Math.min(Math.max(0, lower - storage(p.lower, p.lower.field)), p.lower.conductivity * hours);
      lower -= drained;
      flux.drainage += drained;

      const filmLoss = Math.min(film, evaporation);
      film -= filmLoss;
      const topLoss = Math.min(Math.max(0, top - storage(p.top, p.top.residual)), evaporation - filmLoss);
      top -= topLoss;
      flux.evaporated += filmLoss + topLoss;

      const dest = map.downstream[i];
      if (dest !== -1) {
        const moved = Math.max(0, film - 0.35) * Math.min(1, seconds / 12);
        film -= moved;
        if (dest === -2) flux.exported += moved;
        else runoff[dest] += moved;
      }
      state[offset] = top;
      state[offset + 1] = lower;
      state[offset + 2] = film;
    }
    for (let i = 0; i < map.profile.length; i++) state[i * 3 + 2] += runoff[i];
    return flux;
  }

  /** RGBA8 rendering view: top and lower effective saturation, water film (0–8 mm), land weight. */
  pack(out: Uint8Array): void {
    for (let i = 0; i < this.map.profile.length; i++) {
      const p = SOIL_PROFILES[this.map.profile[i]];
      const o = i * 4;
      if (!p) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      const w = i * 3;
      out[o] = saturate(this.state[w], p.top);
      out[o + 1] = saturate(this.state[w + 1], p.lower);
      out[o + 2] = Math.round(Math.min(1, this.state[w + 2] / SURFACE_WATER_SCALE_MM) * 255);
      out[o + 3] = 255;
    }
  }

  /** World-space physical values for future contacts. The caller owns any persistence. */
  sample(x: number, z: number) {
    const ix = Math.floor((x - WORLD_MIN) / SOIL_CELL_M);
    const iz = Math.floor((z - WORLD_MIN) / SOIL_CELL_M);
    if (ix < 0 || iz < 0 || ix >= this.map.dim || iz >= this.map.dim) return null;
    const i = iz * this.map.dim + ix;
    const profile = this.map.profile[i];
    const p = SOIL_PROFILES[profile];
    if (!p) return null;
    const o = i * 3;
    return { profile, topDepthM: p.top.depthMm / 1000, rootableDepthM: (p.top.depthMm + p.lower.depthMm) / 1000,
      topWaterFraction: this.state[o] / p.top.depthMm, subsoilWaterFraction: this.state[o + 1] / p.lower.depthMm,
      filmMm: this.state[o + 2] };
  }
}

function saturate(mm: number, h: Horizon): number {
  const effective = (mm / h.depthMm - h.residual) / (h.saturated - h.residual);
  return Math.round(Math.max(0, Math.min(1, effective)) * 255);
}
