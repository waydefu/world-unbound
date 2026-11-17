import {
  distanceToGround, distanceToSphere, hitsGround, medium, miePhase, multipleScattering, R_GROUND, R_TOP,
  rayleighPhase, transmittance,
} from './atmosphereLuts';

/**
 * Sky-view table (Hillaire 2020 §5.3): sky radiance seen from the camera for
 * every direction, parameterised by azimuth relative to the sun (0..pi; the
 * sky is mirror-symmetric about the sun's vertical plane) and elevation with
 * a squared mapping that concentrates texels at the horizon. Built over
 * several frames into a work buffer and published whole, so the sky never
 * shows half-updated rows.
 */
export const SV_W = 96;
export const SV_H = 64;
const STEPS = 24;

export interface SkySummary {
  /** Radiance at the horizon averaged over azimuth (rgb). */
  horizon: Float64Array;
  /** Irradiance from the sky on an upward-facing surface (rgb). */
  skyIrradianceUp: Float64Array;
  /** Transmittance from the camera towards the sun (rgb). */
  sunTransmittance: Float64Array;
}

/** Elevation (radians) for table row coordinate v in [0, 1]. */
export function rowElevation(v: number): number {
  const l = 2 * v - 1;
  return Math.sign(l) * l * l * (Math.PI / 2);
}

export class SkyViewBuilder {
  /** Published table, RGBA float, SV_W x SV_H. */
  readonly data = new Float32Array(SV_W * SV_H * 4);
  readonly summary: SkySummary = {
    horizon: new Float64Array(3), skyIrradianceUp: new Float64Array(3), sunTransmittance: new Float64Array(3),
  };
  /** Increments each time a complete table is published. */
  version = 0;
  private readonly work = new Float32Array(SV_W * SV_H * 4);
  private row = SV_H;
  private sunAltitude = 0;
  private radius = R_GROUND + 0.01;
  private readonly medium = new Float64Array(7);
  private readonly t = new Float64Array(3);
  private readonly ms = new Float64Array(3);

  constructor(private readonly trans: Float32Array, private readonly multi: Float32Array) {}

  get building(): boolean {
    return this.row < SV_H;
  }

  /** Starts a rebuild for the given sun altitude (radians) and camera height (metres). */
  start(sunAltitude: number, cameraHeightM: number): void {
    this.sunAltitude = sunAltitude;
    this.radius = R_GROUND + Math.max(0.005, cameraHeightM / 1000);
    this.row = 0;
  }

  /**
   * Computes up to `rows` table rows; publishes when the last row is done.
   * @amortized bounded by the row budget; called once per frame while building
   */
  step(rows: number): boolean {
    const end = Math.min(SV_H, this.row + rows);
    for (; this.row < end; this.row++) this.computeRow(this.row);
    if (this.row < SV_H) return false;
    this.data.set(this.work);
    this.summarise();
    this.version++;
    return true;
  }

  /** Builds the whole table at once (start-up, tests). */
  buildNow(sunAltitude: number, cameraHeightM: number): void {
    this.start(sunAltitude, cameraHeightM);
    this.step(SV_H);
  }

  private computeRow(y: number): void {
    const lat = rowElevation(y / (SV_H - 1));
    const sx = Math.cos(this.sunAltitude);
    const sy = Math.sin(this.sunAltitude);
    const r = this.radius;
    const m = this.medium;
    for (let x = 0; x < SV_W; x++) {
      const az = (x / (SV_W - 1)) * Math.PI;
      const dx = Math.cos(lat) * Math.cos(az);
      const dy = Math.sin(lat);
      const dz = Math.cos(lat) * Math.sin(az);
      const cosTheta = dx * sx + dy * sy;
      const pr = rayleighPhase(cosTheta);
      const pm = miePhase(cosTheta);
      const tMax = hitsGround(r, dy) ? distanceToGround(r, dy) : distanceToSphere(r, dy, R_TOP);
      const dt = tMax / STEPS;
      let l0 = 0;
      let l1 = 0;
      let l2 = 0;
      let th0 = 1;
      let th1 = 1;
      let th2 = 1;
      for (let i = 0; i < STEPS; i++) {
        const t = (i + 0.5) * dt;
        const px = dx * t;
        const py = r + dy * t;
        const pz = dz * t;
        const ri = Math.sqrt(px * px + py * py + pz * pz);
        medium(ri - R_GROUND, m);
        const muS = (px * sx + py * sy) / ri;
        transmittance(this.trans, ri, muS, this.t);
        multipleScattering(this.multi, ri, muS, this.ms);
        for (let c = 0; c < 3; c++) {
          const ext = m[4 + c];
          const stepT = Math.exp(-ext * dt);
          const s = this.t[c] * (m[c] * pr + m[3] * pm) + this.ms[c] * (m[c] + m[3]);
          const inc = (s - s * stepT) / ext;
          if (c === 0) { l0 += th0 * inc; th0 *= stepT; }
          else if (c === 1) { l1 += th1 * inc; th1 *= stepT; }
          else { l2 += th2 * inc; th2 *= stepT; }
        }
      }
      const k = (y * SV_W + x) * 4;
      this.work[k] = l0;
      this.work[k + 1] = l1;
      this.work[k + 2] = l2;
      this.work[k + 3] = 1;
    }
  }

  private summarise(): void {
    const { horizon, skyIrradianceUp, sunTransmittance } = this.summary;
    horizon.fill(0);
    skyIrradianceUp.fill(0);
    const mid = Math.round((SV_H - 1) / 2);
    for (let x = 0; x < SV_W; x++) {
      for (let c = 0; c < 3; c++) horizon[c] += this.data[(mid * SV_W + x) * 4 + c] / SV_W;
    }
    // E_up = integral of L cos(zenith) over the upper hemisphere; azimuth covers half the circle, so x2.
    const dAz = Math.PI / (SV_W - 1);
    for (let y = mid; y < SV_H; y++) {
      const v0 = Math.max(0.5, (y - 0.5) / (SV_H - 1));
      const v1 = Math.min(1, (y + 0.5) / (SV_H - 1));
      const lat = rowElevation(y / (SV_H - 1));
      const dLat = rowElevation(v1) - rowElevation(v0);
      const weight = 2 * Math.sin(lat) * Math.cos(lat) * dLat * dAz;
      for (let x = 0; x < SV_W; x++) {
        for (let c = 0; c < 3; c++) skyIrradianceUp[c] += this.data[(y * SV_W + x) * 4 + c] * weight;
      }
    }
    transmittance(this.trans, this.radius, Math.sin(this.sunAltitude), sunTransmittance);
  }
}
