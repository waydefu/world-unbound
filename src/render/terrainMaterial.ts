import { type DataTexture, FrontSide, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import {
  attribute, clamp, float, max, mix, normalize, normalWorldGeometry, positionView, positionWorld,
  smoothstep, transformNormalToView, uniform, vec3,
} from 'three/tsl';
import { triplanarChannel, triplanarSlope } from './noiseSampling';

/**
 * Procedural PBR terrain material (G1.3). The chunk colour attribute carries
 * material weights (sand, rock, earth) and baked AO, not an albedo. Noise is
 * evaluated at the absolute world position (camera-relative position plus the
 * eye offset) so patterns stay fixed in the world as the root moves.
 */
export interface TerrainMaterial {
  readonly material: MeshStandardNodeMaterial;
  /** @hot writes an existing uniform only */
  setEyeOffset(x: number, y: number, z: number): void;
  setWetness(wetness: number): void;
}

const SEABED = vec3(0.105, 0.118, 0.098);
const SAND = vec3(0.52, 0.45, 0.31);
const GRASS_DRY = vec3(0.21, 0.24, 0.085);
const GRASS_LUSH = vec3(0.075, 0.16, 0.045);
const ROCK = vec3(0.2, 0.19, 0.175);
const EARTH = vec3(0.19, 0.15, 0.105);
/** Metres per noise tile: macro patches, grain and micro-relief. */
const MACRO_METRES = 37;
const GRAIN_METRES = 5.3;
const RELIEF_METRES = 1.25;

export function createTerrainMaterial(noise: DataTexture, lite = false): TerrainMaterial {
  const eyeOffset = uniform(new Vector3());
  const wetness = uniform(0);

  const w = attribute('color', 'vec4');
  const grass = clamp(float(1).sub(w.x).sub(w.y).sub(w.z), 0, 1);
  const pW = positionWorld.add(eyeOffset);
  const y = pW.y;
  const dist = positionView.length();
  const detail = smoothstep(120, 30, dist);

  const nGeo = normalWorldGeometry;
  // Patch noise (B channel, 0..1) mapped to -1..1; world-fixed, triplanar on steep ground.
  const macro = triplanarChannel(noise, pW, nGeo, MACRO_METRES, 'b').mul(2).sub(1);

  const grassCol = mix(GRASS_DRY, GRASS_LUSH, smoothstep(-0.6, 0.6, macro).mul(0.6).add(0.2));
  let base = grassCol.mul(grass).add(SAND.mul(w.x)).add(ROCK.mul(w.y)).add(EARTH.mul(w.z));
  base = mix(base, SEABED, float(1).sub(smoothstep(-2.2, -0.2, y)));
  if (!lite) {
    const grain = triplanarChannel(noise, pW, nGeo, GRAIN_METRES, 'a').mul(2).sub(1);
    base = base.mul(float(1).add(grain.mul(0.14).mul(mix(0.4, 1, detail))));
  }

  const rough = grass.mul(0.88).add(w.x.mul(0.92)).add(w.y.mul(0.72)).add(w.z.mul(0.9));
  const shore = float(1).sub(smoothstep(0.2, 1.4, y));
  const wet = max(shore, wetness.mul(float(1).sub(w.y.mul(0.5))));
  const albedo = base.mul(mix(1, 0.55, wet));
  const roughness = mix(rough, 0.3, wet);


  const material = new MeshStandardNodeMaterial({ metalness: 0, side: FrontSide });
  material.vertexColors = false;
  material.name = 'terrain';
  material.colorNode = albedo;
  material.roughnessNode = roughness;
  if (!lite) {
    // Micro-relief: one slope fetch (the texture stores the gradient), no finite differences.
    const g = triplanarSlope(noise, pW, nGeo, RELIEF_METRES);
    const strength = grass.mul(0.3).add(w.x.mul(0.15)).add(w.y.mul(0.6)).add(w.z.mul(0.25))
      .mul(detail).mul(mix(1, 0.4, wet));
    const nW = normalize(nGeo.sub(g.mul(strength)));
    material.normalNode = transformNormalToView(nW);
  }
  material.aoNode = w.w;

  return {
    material,
    /** @hot */
    setEyeOffset(x: number, y2: number, z: number): void {
      eyeOffset.value.set(x, y2, z);
    },
    setWetness(value: number): void {
      wetness.value = value;
    },
  };
}
