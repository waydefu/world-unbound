import {
  BackSide, ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, Mesh, MeshBasicNodeMaterial,
  RGBAFormat, SphereGeometry, Vector3,
} from 'three/webgpu';
import {
  Fn, PI, abs, acos, asin, clamp, dot, floor, fract, max, mix, normalize, positionLocal, sign, sin, smoothstep,
  sqrt, texture, uniform, vec2, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { SV_H, SV_W } from '../env/skyView';

/** Sun and moon angular radii (radians) and the sun's radiance per unit illuminance. */
const SUN_COS_OUTER = Math.cos(0.0062);
const SUN_COS_INNER = Math.cos(0.0045);
const SUN_RADIANCE_PER_ILLUMINANCE = 1 / 6.8e-5;
/** Clamp before exposure; the shader also clamps after it to stay inside half-float targets. */
const MAX_DISC_RADIANCE = 2000;

/**
 * Sky dome around the camera (which sits at the origin): samples the
 * CPU-built sky-view table with the same squared elevation mapping, and adds
 * the sun disc, the moon disc and a procedural star field at night.
 */
export class SkyDome {
  readonly mesh: Mesh;
  private readonly table: DataTexture;
  private readonly halfData = new Uint16Array(SV_W * SV_H * 4);
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly moonDir = uniform(new Vector3(0, -1, 0));
  private readonly sunDisc = uniform(new Vector3());
  private readonly moonDisc = uniform(new Vector3());
  /** Scene radiance of the table's 1.0 (the table is normalised to its maximum before half-float upload). */
  private readonly radianceScale = uniform(Math.PI);
  private readonly overcast = uniform(0);
  /** CIE standard overcast sky zenith radiance (scene units). */
  private readonly overcastZenith = uniform(new Vector3());
  private readonly stars = uniform(0);
  private readonly exposure = uniform(1);
  /** Sun disc radiance before the disc clamp and before exposure: pi * T * visibility / 6.8e-5. */
  private readonly sunRadianceUniform = uniform(new Vector3());

  constructor() {
    this.table = new DataTexture(this.halfData, SV_W, SV_H, RGBAFormat, HalfFloatType);
    this.table.magFilter = LinearFilter;
    this.table.minFilter = LinearFilter;
    this.table.wrapS = ClampToEdgeWrapping;
    this.table.wrapT = ClampToEdgeWrapping;
    this.table.generateMipmaps = false;

    const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
    material.colorNode = this.shader();
    material.name = 'sky';
    this.mesh = new Mesh(new SphereGeometry(6000, 48, 24), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Sun direction uniform (world space, unit). Read-only use: the ocean glint reads it. */
  get sunDirection() {
    return this.sunDir;
  }

  /** Sun disc radiance (rgb, unclamped, before exposure). Read-only use. */
  get sunRadiance() {
    return this.sunRadianceUniform;
  }

  /** Bytes uploaded to the GPU by each `setTable` (half-float RGBA). */
  get tableBytes(): number {
    return this.halfData.byteLength;
  }

  /** Pre-exposure multiplier uniform, so other materials can fold it into their own emission. */
  get exposureNode() {
    return this.exposure;
  }

  /**
   * Table lookup shared by the dome and by reflections: sky radiance for the
   * unit direction `d` (before exposure, no discs or stars), with the CIE
   * overcast deck mixed in. Must be called while a TSL function is being built.
   */
  private readonly skyAir = Fn(([dir]: [Node<'vec3'>]) => {
    const d = dir.toVar();
    const { table, sunDir, radianceScale, overcast, overcastZenith } = this;
    const lat = asin(clamp(d.y, -1, 1));
    const dXZ = normalize(vec2(d.x, d.z).add(vec2(1e-5, 0)));
    const sXZ = normalize(vec2(sunDir.x, sunDir.z).add(vec2(1e-5, 0)));
    const u = acos(clamp(dot(dXZ, sXZ), -1, 1)).div(PI);
    const v = sign(lat).mul(sqrt(abs(lat).div(PI.mul(0.5)))).mul(0.5).add(0.5);
    // Texel centres: row/column i sits at i / (n - 1) in the table's own parameterisation.
    const uv = vec2(u.mul((SV_W - 1) / SV_W).add(0.5 / SV_W), v.mul((SV_H - 1) / SV_H).add(0.5 / SV_H));
    const sky = texture(table, uv).rgb.mul(radianceScale);
    // CIE overcast: L = Lz (1 + 2 sin(elevation)) / 3, flat below the horizon.
    const cloud = overcastZenith.mul(d.y.max(0).mul(2).add(1).div(3));
    return mix(sky, cloud, overcast);
  });

  /**
   * Pre-exposed sky radiance (vec3) for a world-space direction, exactly what
   * the dome shows minus sun, moon and stars. Reflections never look below the
   * horizon, so y is clamped to >= 0.01.
   */
  radiance(dir: Node<'vec3'>): Node<'vec3'> {
    const d = normalize(vec3(dir.x, max(dir.y, 0.01), dir.z));
    return this.skyAir(d).mul(this.exposure);
  }

  private shader() {
    const { sunDir, moonDir, sunDisc, moonDisc, stars, exposure } = this;
    return Fn(() => {
      const d = normalize(positionLocal).toVar();
      // Below the horizon the dome only shows what lies beyond the ocean's far edge: use the horizon
      // radiance there (what distant water reflects) instead of the table's dark ground half.
      const air = this.skyAir(normalize(vec3(d.x, max(d.y, 0), d.z).add(vec3(0, 1e-4, 0))));
      const sunMask = smoothstep(SUN_COS_OUTER, SUN_COS_INNER, dot(d, sunDir));
      const moonMask = smoothstep(Math.cos(0.009), Math.cos(0.0075), dot(d, moonDir));
      // Sparse hashed stars on a direction grid, fading towards the horizon.
      const cell = floor(d.mul(420));
      const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
      const star = smoothstep(0.9965, 1, h).mul(smoothstep(0.02, 0.2, d.y)).mul(stars);
      return air.add(sunDisc.mul(sunMask)).add(moonDisc.mul(moonMask)).add(vec3(star)).mul(exposure).min(60000);
    })();
  }

  /**
   * Publishes a new sky-view table (RGBA float) to the GPU as half floats.
   * Twilight radiance (1e-5 and below) would fall into half-float subnormals
   * and band visibly, so the table is normalised to its maximum first.
   */
  setTable(data: Float32Array): void {
    let peak = 1e-30;
    for (let i = 0; i < data.length; i++) if ((i & 3) !== 3 && data[i] > peak) peak = data[i];
    const inv = 1 / peak;
    for (let i = 0; i < data.length; i++) {
      this.halfData[i] = DataUtils.toHalfFloat((i & 3) === 3 ? 1 : data[i] * inv);
    }
    this.radianceScale.value = Math.PI * peak;
    this.table.needsUpdate = true;
  }

  /** Pre-exposure multiplier (see Environment.setExposure). @hot */
  setExposure(value: number): void {
    this.exposure.value = value;
  }

  /**
   * Sun/moon directions and disc radiance. `sunTransmittance` is the rgb
   * transmittance towards the sun; `starRadiance` scales the star field.
   */
  setCelestial(
    sun: ArrayLike<number>, moon: ArrayLike<number>, sunTransmittance: ArrayLike<number>,
    moonRadiance: number, starRadiance: number, overcast: number, sunVisibility: number,
    overcastZenith: ArrayLike<number>,
  ): void {
    this.overcastZenith.value.set(overcastZenith[0], overcastZenith[1], overcastZenith[2]);
    this.sunDir.value.set(sun[0], sun[1], sun[2]);
    this.moonDir.value.set(moon[0], moon[1], moon[2]);
    const disc = Math.PI * SUN_RADIANCE_PER_ILLUMINANCE * sunVisibility;
    this.sunRadianceUniform.value.set(sunTransmittance[0] * disc, sunTransmittance[1] * disc, sunTransmittance[2] * disc);
    this.sunDisc.value.set(
      Math.min(MAX_DISC_RADIANCE, sunTransmittance[0] * disc),
      Math.min(MAX_DISC_RADIANCE, sunTransmittance[1] * disc),
      Math.min(MAX_DISC_RADIANCE, sunTransmittance[2] * disc),
    );
    this.moonDisc.value.set(moonRadiance * 0.9, moonRadiance * 0.95, moonRadiance);
    this.stars.value = starRadiance;
    this.overcast.value = overcast;
  }
}
