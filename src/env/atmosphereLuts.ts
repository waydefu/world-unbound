/**
 * Physically based atmosphere (Hillaire 2020, "A Scalable and Production Ready
 * Sky and Atmosphere Rendering Technique"; Bruneton 2017 texture mappings).
 * Distances in km, coefficients per km, radiance relative to a solar
 * illuminance of 1. Computed on the CPU so it is identical on WebGPU and
 * WebGL2, testable in Node, and costs the GPU only texture lookups.
 */
export const R_GROUND = 6360;
export const R_TOP = 6460;
const RAYLEIGH = [5.802e-3, 13.558e-3, 33.1e-3];
const RAYLEIGH_H = 8;
const MIE_SCATTER = 3.996e-3;
const MIE_EXTINCTION = 4.44e-3;
const MIE_H = 1.2;
const OZONE = [0.65e-3, 1.881e-3, 0.085e-3];
const GROUND_ALBEDO = 0.3;
export const MIE_G = 0.8;

export const T_W = 128;
export const T_H = 32;
export const MS_SIZE = 32;

/** Scattering (rgb rayleigh, mie) and extinction (rgb) at altitude h, written into `out` (7 floats). */
export function medium(h: number, out: Float64Array): void {
  const dr = Math.exp(-h / RAYLEIGH_H);
  const dm = Math.exp(-h / MIE_H);
  const dozone = Math.max(0, 1 - Math.abs(h - 25) / 15);
  out[0] = RAYLEIGH[0] * dr;
  out[1] = RAYLEIGH[1] * dr;
  out[2] = RAYLEIGH[2] * dr;
  out[3] = MIE_SCATTER * dm;
  for (let c = 0; c < 3; c++) out[4 + c] = RAYLEIGH[c] * dr + MIE_EXTINCTION * dm + OZONE[c] * dozone;
}

/** Distance from radius r along cos-zenith mu to the sphere of radius `radius` (exit point). */
export function distanceToSphere(r: number, mu: number, radius: number): number {
  const disc = r * r * (mu * mu - 1) + radius * radius;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, disc)));
}

/** Distance to the first (near) intersection with the ground; only valid when hitsGround(r, mu). */
export function distanceToGround(r: number, mu: number): number {
  return Math.max(0, -r * mu - Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + R_GROUND * R_GROUND)));
}

export function hitsGround(r: number, mu: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + R_GROUND * R_GROUND >= 0;
}

const H_SPAN = Math.sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND);

/** Bruneton's (r, mu) -> (u, v) mapping for the transmittance table. */
function transmittanceUv(r: number, mu: number): [number, number] {
  const rho = Math.sqrt(Math.max(0, r * r - R_GROUND * R_GROUND));
  const d = distanceToSphere(r, mu, R_TOP);
  const dMin = R_TOP - r;
  const dMax = rho + H_SPAN;
  return [(d - dMin) / (dMax - dMin), rho / H_SPAN];
}

function transmittanceRMu(u: number, v: number): [number, number] {
  const rho = H_SPAN * v;
  const r = Math.sqrt(rho * rho + R_GROUND * R_GROUND);
  const dMin = R_TOP - r;
  const dMax = rho + H_SPAN;
  const d = dMin + u * (dMax - dMin);
  const mu = d === 0 ? 1 : (H_SPAN * H_SPAN - rho * rho - d * d) / (2 * r * d);
  return [r, Math.max(-1, Math.min(1, mu))];
}

const scratch = new Float64Array(7);

/** Transmittance table (T_W x T_H, rgb) from each (r, mu) to the top of the atmosphere. */
export function buildTransmittance(): Float32Array {
  const table = new Float32Array(T_W * T_H * 3);
  const steps = 40;
  for (let y = 0; y < T_H; y++) {
    for (let x = 0; x < T_W; x++) {
      const [r, mu] = transmittanceRMu(x / (T_W - 1), y / (T_H - 1));
      const length = distanceToSphere(r, mu, R_TOP);
      const dt = length / steps;
      let o0 = 0;
      let o1 = 0;
      let o2 = 0;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) * dt;
        const ri = Math.sqrt(t * t + 2 * r * mu * t + r * r);
        medium(ri - R_GROUND, scratch);
        o0 += scratch[4] * dt;
        o1 += scratch[5] * dt;
        o2 += scratch[6] * dt;
      }
      const k = (y * T_W + x) * 3;
      table[k] = Math.exp(-o0);
      table[k + 1] = Math.exp(-o1);
      table[k + 2] = Math.exp(-o2);
    }
  }
  return table;
}

/** Bilinear lookup of a 3-channel table at (u, v) in [0, 1]. */
export function sampleTable(table: Float32Array, w: number, h: number, u: number, v: number, out: Float64Array, o = 0): void {
  const fx = Math.max(0, Math.min(1, u)) * (w - 1);
  const fy = Math.max(0, Math.min(1, v)) * (h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = table[(y0 * w + x0) * 3 + c];
    const b = table[(y0 * w + x1) * 3 + c];
    const d = table[(y1 * w + x0) * 3 + c];
    const e = table[(y1 * w + x1) * 3 + c];
    out[o + c] = (a + (b - a) * ax) * (1 - ay) + (d + (e - d) * ax) * ay;
  }
}

/** Transmittance from radius r towards cos-zenith mu, zero if the ray hits the planet. */
export function transmittance(table: Float32Array, r: number, mu: number, out: Float64Array, o = 0): void {
  if (hitsGround(r, mu)) {
    out[o] = out[o + 1] = out[o + 2] = 0;
    return;
  }
  const [u, v] = transmittanceUv(r, mu);
  sampleTable(table, T_W, T_H, u, v, out, o);
}

const tmp = new Float64Array(3);

/**
 * Multiple-scattering table (MS_SIZE x MS_SIZE, rgb): Psi_ms(altitude, sun
 * cos-zenith), the isotropic higher-order in-scattering per unit scattering
 * coefficient (Hillaire 2020, section 5.5).
 */
export function buildMultipleScattering(trans: Float32Array): Float32Array {
  const table = new Float32Array(MS_SIZE * MS_SIZE * 3);
  const dirsSqrt = 8;
  const steps = 20;
  const phase = 1 / (4 * Math.PI);
  for (let y = 0; y < MS_SIZE; y++) {
    const r = R_GROUND + Math.max(0.01, (y / (MS_SIZE - 1)) * (R_TOP - R_GROUND));
    for (let x = 0; x < MS_SIZE; x++) {
      const muS = -1 + (2 * x) / (MS_SIZE - 1);
      const sun = [Math.sqrt(Math.max(0, 1 - muS * muS)), muS, 0];
      const lum = [0, 0, 0];
      const fms = [0, 0, 0];
      const n = dirsSqrt * dirsSqrt;
      for (let a = 0; a < dirsSqrt; a++) {
        for (let b = 0; b < dirsSqrt; b++) {
          const cosTheta = 1 - (2 * (a + 0.5)) / dirsSqrt;
          const phi = (2 * Math.PI * (b + 0.5)) / dirsSqrt;
          const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
          const dir = [sinTheta * Math.cos(phi), cosTheta, sinTheta * Math.sin(phi)];
          const ground = hitsGround(r, dir[1]);
          const tMax = ground ? distanceToGround(r, dir[1]) : distanceToSphere(r, dir[1], R_TOP);
          const dt = tMax / steps;
          const thr = [1, 1, 1];
          for (let i = 0; i < steps; i++) {
            const t = (i + 0.5) * dt;
            const p = [dir[0] * t, r + dir[1] * t, dir[2] * t];
            const ri = Math.hypot(p[0], p[1], p[2]);
            medium(ri - R_GROUND, scratch);
            const mu = (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) / ri;
            transmittance(trans, ri, mu, tmp);
            for (let c = 0; c < 3; c++) {
              const scat = scratch[c] + scratch[3];
              const ext = scratch[4 + c];
              const stepT = Math.exp(-ext * dt);
              const s = tmp[c] * scat * phase;
              lum[c] += thr[c] * ((s - s * stepT) / ext);
              fms[c] += thr[c] * ((scat - scat * stepT) / ext);
              thr[c] *= stepT;
            }
          }
          if (ground) {
            const gp = [dir[0] * tMax, r + dir[1] * tMax, dir[2] * tMax];
            const gr = Math.hypot(gp[0], gp[1], gp[2]);
            const nDotL = Math.max(0, (gp[0] * sun[0] + gp[1] * sun[1] + gp[2] * sun[2]) / gr);
            transmittance(trans, gr, nDotL, tmp);
            for (let c = 0; c < 3; c++) lum[c] += thr[c] * tmp[c] * nDotL * (GROUND_ALBEDO / Math.PI);
          }
        }
      }
      const k = (y * MS_SIZE + x) * 3;
      for (let c = 0; c < 3; c++) {
        const l2 = lum[c] / n;
        const f = fms[c] / n;
        table[k + c] = l2 / (1 - Math.min(0.999, f));
      }
    }
  }
  return table;
}

/** Psi_ms lookup for radius r and sun cos-zenith muS. */
export function multipleScattering(table: Float32Array, r: number, muS: number, out: Float64Array, o = 0): void {
  sampleTable(table, MS_SIZE, MS_SIZE, (muS + 1) / 2, (r - R_GROUND) / (R_TOP - R_GROUND), out, o);
}

export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Cornette-Shanks phase function for Mie scattering. */
export function miePhase(cosTheta: number, g = MIE_G): number {
  const g2 = g * g;
  const k = (3 / (8 * Math.PI)) * ((1 - g2) / (2 + g2));
  return (k * (1 + cosTheta * cosTheta)) / (1 + g2 - 2 * g * cosTheta) ** 1.5;
}
