import {
  ClampToEdgeWrapping, DataTexture, FrontSide, LinearFilter, MeshBasicNodeMaterial, RedFormat, HalfFloatType, Vector2, Vector3, Vector4,
  type Node, type UniformNode,
} from 'three/webgpu';
import {
  Discard, Fn, clamp, cos, float, length, max, min, mix, normalize, positionLocal, positionWorld, pow, reflect,
  smoothstep, sin, step, texture, uniform, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import type { SkyDome } from './sky';

const WAVE_COUNT = 4;
const SUN_SOLID_ANGLE = 6.8e-5;
const DEEP_FLOOR = -40;
/** The sea-floor texture stores h - FLOOR_OFFSET so half floats keep <= 0.25 m steps up to 1050 m. */
export const FLOOR_OFFSET = 500;
/** World-space size of one noise tile for the two detail-slope layers and the foam breakup (metres). */
const DETAIL_A_METRES = 23;
const DETAIL_B_METRES = 6.5;
const FOAM_METRES = 3;
const DEEP = vec3(0.004, 0.016, 0.022);
const SHALLOW = vec3(0.02, 0.09, 0.085);
const SHALLOW_SAND = vec3(0.1, 0.12, 0.09);
const SSS = vec3(0.02, 0.18, 0.15);
const FOAM_ALBEDO = 0.8;
const GLINT_MAX = 60000;

export interface OceanUniforms {
  /** Eye position (x, y, z) in world metres. */
  eye: UniformNode<'vec3'>;
  /** Eye xz snapped to the finest grid spacing (the mesh offset undoes the remainder). */
  eyeSnap: UniformNode<'vec2'>;
  time: UniformNode<'float'>;
  /** Per wave: (dirX, dirZ, k, omega) and (amplitude, steepness, 0, 0). */
  waveA: Array<UniformNode<'vec4'>>;
  waveB: Array<UniformNode<'vec4'>>;
  /** Weather: (wave slope, sum of amplitudes, crest-foam factor, 0). */
  weather: UniformNode<'vec4'>;
  /** Zenith (hemisphere) radiance for body and foam lighting, pre-exposed (set from the CPU sky summary). */
  zenith: UniformNode<'vec3'>;
}

export function createOceanUniforms(): OceanUniforms {
  const waveA: Array<UniformNode<'vec4'>> = [];
  const waveB: Array<UniformNode<'vec4'>> = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    waveA.push(uniform(new Vector4()));
    waveB.push(uniform(new Vector4()));
  }
  return {
    eye: uniform(new Vector3()), eyeSnap: uniform(new Vector2()), time: uniform(0),
    waveA, waveB, weather: uniform(new Vector4(0.035, 0.1, 0, 0)), zenith: uniform(new Vector3(0.1, 0.15, 0.3)),
  };
}

/** Sea-floor height texture: half floats are filterable on every WebGL2/WebGPU device, unlike r32float. */
export function createSeaFloorTexture(data: Uint16Array, size: number): DataTexture {
  const tex = new DataTexture(data, size, size, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Builds the ocean material. All lighting happens in the shader and returns
 * pre-exposed radiance; the sky is sampled through SkyDome.radiance so the
 * reflection is exactly the dome the player sees.
 */
export function createOceanMaterial(
  sky: SkyDome, floor: DataTexture, noise: DataTexture, u: OceanUniforms, lite = false,
): MeshBasicNodeMaterial {
  const { eye, eyeSnap, time, waveA, waveB, weather, zenith } = u;
  const vNormal = varyingProperty('vec3', 'oceanNormal');
  const vWaveY = varyingProperty('float', 'oceanWaveY');

  /** Water depth in metres at absolute world xz (negative on land); deep outside the world. */
  const seaDepth = (p: Node<'vec2'>): Node<'float'> => {
    const uv = p.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN);
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    return mix(float(-DEEP_FLOOR), texture(floor, uv).level(float(0)).r.add(FLOOR_OFFSET).negate(), inside);
  };

  const vertex = Fn(() => {
    const p = positionLocal.xz.add(eyeSnap).toVar();
    const depth = seaDepth(p);
    const fade = smoothstep(0.3, 4, depth).mul(smoothstep(2500, 900, length(positionLocal.xz))).toVar();
    const dx = float(0).toVar();
    const dy = float(0).toVar();
    const dz = float(0).toVar();
    const nx = float(0).toVar();
    const ny = float(1).toVar();
    const nz = float(0).toVar();
    for (let i = 0; i < WAVE_COUNT; i++) {
      const a = waveA[i];
      const b = waveB[i];
      const theta = a.z.mul(a.x.mul(p.x).add(a.y.mul(p.y))).sub(a.w.mul(time));
      const s = sin(theta);
      const c = cos(theta);
      const amp = b.x.mul(fade);
      const qa = b.y.mul(amp);
      dx.addAssign(qa.mul(a.x).mul(c));
      dz.addAssign(qa.mul(a.y).mul(c));
      dy.addAssign(amp.mul(s));
      const wa = a.z.mul(amp);
      nx.subAssign(a.x.mul(wa).mul(c));
      nz.subAssign(a.y.mul(wa).mul(c));
      ny.subAssign(b.y.mul(wa).mul(s));
    }
    vNormal.assign(normalize(vec3(nx, ny, nz)));
    vWaveY.assign(dy);
    return positionLocal.add(vec3(dx, dy, dz));
  });

  const fragment = Fn(() => {
    const p = positionWorld.xz.add(vec2(eye.x, eye.z)).toVar();
    const dist = length(positionWorld);
    const t = time;
    const slope = weather.x;
    // Noise samples first, before any discard, so the mip selection derivatives stay in uniform control flow.
    // Slopes (rg) decode to -1..1 with rms ~0.3; both layers drift (the first with the wind, +z).
    const slopeA = texture(noise, p.add(vec2(0, 0.35).mul(t)).div(DETAIL_A_METRES)).rg.mul(2).sub(1).toVar();
    const slopeB = lite
      ? vec2(0, 0)
      : texture(noise, p.add(vec2(0.45, 0.4).mul(t)).div(DETAIL_B_METRES)).rg.mul(2).sub(1).toVar();
    // Foam breakup (alpha channel) at 1/3 m; lite uses the Gerstner phase instead.
    const grain = (lite ? float(0) : texture(noise, p.add(vec2(0.1, 0.25).mul(t)).div(FOAM_METRES)).a).toVar();

    const sea = seaDepth(p).toVar();
    // Land per the height map: terrain covers it where it is streamed in; where it is not, show the horizon haze instead of sea.
    Discard(sea.lessThan(-0.5));

    // Detail normal: sum of the decoded slopes, scaled by weather and faded out with distance.
    const amp = slope.mul(1.5).add(0.05).mul(smoothstep(400, 60, dist));
    const detail = slopeA.add(slopeB.mul(0.6)).mul(amp);
    const Ng = normalize(vNormal);
    const N = normalize(Ng.sub(vec3(detail.x, 0, detail.y))).toVar();

    const V = normalize(positionWorld.negate()).toVar();
    const r0 = reflect(V.negate(), N);
    const R = vec3(r0.x, max(r0.y, 0.01), r0.z).toVar();
    const NdotV = max(N.dot(V), 0);
    const F = float(0.98).mul(pow(float(1).sub(NdotV), 5)).add(0.02);
    const reflection = sky.radiance(R);
    const sunDir = sky.sunDirection;
    const sunLight = sky.sunRadiance.mul(sky.exposureNode);
    // Sun illuminance (pre-exposed, = pi at the zenith in clear sky) on a surface facing the sun.
    const sunE = sunLight.mul(SUN_SOLID_ANGLE);

    // Glint: normalised Gaussian lobe on the half vector (energy ~constant as it widens with distance).
    const H = normalize(V.add(sunDir));
    const m2 = smoothstep(50, 800, dist).mul(0.002).add(0.0004).add(slope.mul(slope).mul(0.3));
    const lobe = float(1).sub(N.dot(H)).negate().div(m2).exp().div(m2.mul(Math.PI));
    const glint = sunE.mul(F).mul(lobe).mul(0.25).div(max(NdotV, 0.15)).min(GLINT_MAX);

    const depth = max(sea, 0);
    // Water body lit by sky irradiance (zenith radiance x pi x 0.5) plus the sun's illuminance on a horizontal surface.
    const sunIlluminance = sunE.mul(max(sunDir.y, 0));
    const bodyLight = zenith.mul(Math.PI * 0.5).add(sunIlluminance);
    // Deep -> turquoise shallows over ~8 m, sand-tinted right at the shore (no hard turquoise edge).
    const shallow = mix(SHALLOW, SHALLOW_SAND, smoothstep(1.5, 0, depth));
    const body = mix(DEEP, shallow, depth.negate().div(3).exp()).mul(bodyLight).toVar();
    // Backlit crests: sun shining through the wave when looking towards it.
    const crest = clamp(vWaveY.div(weather.y), 0, 1);
    const sunH = normalize(vec3(sunDir.x, 0, sunDir.z).add(vec3(1e-5, 0, 0)));
    const backlit = pow(max(V.dot(sunH.negate()), 0), 4).mul(crest.mul(crest)).mul(smoothstep(0, 0.08, sunDir.y));
    body.addAssign(SSS.mul(sunE).mul(backlit).div(Math.PI));

    // Lite: breakup from the Gerstner phase (wave height) and no crest foam.
    const breakup = lite ? vWaveY.div(weather.y).mul(0.5).add(0.5) : smoothstep(0.3, 0.7, grain);
    const shore = smoothstep(0.6, 0, depth).mul(breakup).mul(0.6);
    const foam = lite ? min(shore, 1) : min(shore.add(smoothstep(0.8, 1, crest).mul(0.4).mul(weather.z)), 1);
    const sunIrradianceTerm = sunE.mul(max(sunDir.y, 0).div(Math.PI));
    const foamColour = zenith.add(sunIrradianceTerm).mul(FOAM_ALBEDO);

    const lit = mix(body, reflection, F).add(glint);
    return mix(lit, foamColour, foam).max(0).min(60000);
  });

  const material = new MeshBasicNodeMaterial({ transparent: false, fog: true, side: FrontSide });
  material.name = 'ocean';
  material.positionNode = vertex();
  material.colorNode = fragment();
  return material;
}
