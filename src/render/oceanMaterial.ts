import {
  ClampToEdgeWrapping, DataTexture, FrontSide, LinearFilter, MeshBasicNodeMaterial, RedFormat, HalfFloatType, Vector2, Vector3, Vector4,
  type Node, type UniformNode,
} from 'three/webgpu';
import {
  Discard, Fn, cos, float, length, max, min, mix, mx_noise_float, normalize, positionLocal, positionWorld, pow, reflect,
  smoothstep, sin, step, texture, uniform, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { WORLD_MAX, WORLD_MIN } from '../world/constants';
import type { SkyDome } from './sky';

const WAVE_COUNT = 4;
const SUN_SOLID_ANGLE = 6.8e-5;
const DEEP_FLOOR = -40;
/** Detail-normal finite-difference step in metres (as in terrainMaterial). */
const E = 0.08;
const DEEP = vec3(0.004, 0.016, 0.022);
const SHALLOW = vec3(0.02, 0.09, 0.085);
const FOAM_ALBEDO = 0.8;
const GLINT_EXPONENT = 3000;

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
    waveA, waveB, weather: uniform(new Vector4(0.035, 0.1, 0, 0)),
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
export function createOceanMaterial(sky: SkyDome, floor: DataTexture, u: OceanUniforms): MeshBasicNodeMaterial {
  const { eye, eyeSnap, time, waveA, waveB, weather } = u;
  const vNormal = varyingProperty('vec3', 'oceanNormal');
  const vWaveY = varyingProperty('float', 'oceanWaveY');

  /** Water depth in metres at absolute world xz (negative on land); deep outside the world. */
  const seaDepth = (p: Node<'vec2'>): Node<'float'> => {
    const uv = p.sub(WORLD_MIN).div(WORLD_MAX - WORLD_MIN);
    const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
    return mix(float(-DEEP_FLOOR), texture(floor, uv).level(float(0)).r.negate(), inside);
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
    // Land per the height map: terrain covers it where it is streamed in; where it is not, show the horizon haze instead of sea.
    Discard(seaDepth(p).lessThan(-0.5));
    const dist = length(positionWorld);
    const t = time;
    const slope = weather.x;
    const band = (q: Node<'vec2'>, freq: number, drift: Vector2) =>
      mx_noise_float(vec3(q.mul(freq).add(vec2(drift.x, drift.y).mul(t)), t.mul(freq < 0.5 ? 0.1 : 0.13)));
    const at = (q: Node<'vec2'>) => band(q, 0.23, new Vector2(0.05, 0.03));
    const bt = (q: Node<'vec2'>) => band(q, 0.9, new Vector2(-0.04, -0.07));
    const n1 = at(p).toVar();
    const n2 = bt(p).toVar();
    const gx = at(p.add(vec2(E, 0))).sub(n1).add(bt(p.add(vec2(E, 0))).sub(n2)).div(E);
    const gz = at(p.add(vec2(0, E))).sub(n1).add(bt(p.add(vec2(0, E))).sub(n2)).div(E);
    const strength = min(slope.div(0.035).mul(0.35), 1).mul(smoothstep(400, 60, dist));
    const N = normalize(normalize(vNormal).sub(vec3(gx, 0, gz).mul(strength).mul(0.25))).toVar();

    const V = normalize(positionWorld.negate()).toVar();
    const r0 = reflect(V.negate(), N);
    const R = vec3(r0.x, max(r0.y, 0.01), r0.z).toVar();
    const F = float(0.98).mul(pow(float(1).sub(max(N.dot(V), 0)), 5)).add(0.02);
    const reflection = sky.radiance(R);
    const zenith = sky.radiance(vec3(0, 1, 0)).toVar();
    const sunDir = sky.sunDirection;
    const sunLight = sky.sunRadiance.mul(sky.exposureNode);
    const glint = sunLight.mul(pow(max(R.dot(sunDir), 0), GLINT_EXPONENT)).mul(4).mul(F);

    const depth = max(seaDepth(p), 0);
    // Water body lit by sky irradiance (zenith radiance x pi x 0.5) plus the sun's illuminance on a horizontal surface.
    const sunIlluminance = sky.sunRadiance.mul(SUN_SOLID_ANGLE).mul(max(sky.sunDirection.y, 0)).mul(sky.exposureNode);
    const bodyLight = zenith.mul(Math.PI * 0.5).add(sunIlluminance);
    const body = mix(DEEP, SHALLOW, depth.negate().div(6).exp()).mul(bodyLight);

    // The foam breakup noise has a ~4 m period: past ~400 m it would alias into speckle, so fade it to its mean.
    const shore = smoothstep(1.2, 0, depth).mul(mix(0.75, n1.mul(0.5).add(0.5), smoothstep(400, 60, dist)));
    const crest = smoothstep(0.8, 1, vWaveY.div(weather.y)).mul(0.4).mul(weather.z);
    const foam = min(shore.add(crest), 1);
    const sunIrradianceTerm = sky.sunRadiance.mul(SUN_SOLID_ANGLE / Math.PI).mul(max(sunDir.y, 0)).mul(sky.exposureNode);
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
