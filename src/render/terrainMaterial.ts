import { type DataTexture, FrontSide, MeshStandardNodeMaterial, type Node, Vector3 } from 'three/webgpu';
import {
  attribute, clamp, float, max, mix, normalize, normalWorldGeometry, positionView, positionWorld,
  smoothstep, texture, transformNormalToView, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { WORLD_MIN } from '../world/constants';
import { groundCover } from './grassPalette';
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
  /** Season weights (fresh, summer, straw) for the grass colour; see vegetationSeason in env/climate.ts. */
  setSeason(fresh: number, summer: number, straw: number): void;
}

/**
 * Where the CDLOD terrain gets its inputs (ADR-0003): material weights and AO, and the geometric normal, from
 * textures sampled at the world xz in the fragment stage, instead of the chunk path's vertex colours and normals.
 */
export interface TerrainSurface {
  /** RGBA8 sand, rock, earth, AO: one texel per `step` lattice cells (2 m each) from WORLD_MIN. */
  readonly material: DataTexture;
  readonly materialDim: number;
  readonly materialStep: number;
  /** RGBA8 world-space normal (n * 0.5 + 0.5) on the same lattice as `material`, linear and mipmapped. */
  readonly normal: DataTexture;
  /** RGBA8 meadow, heath, tree, bare on the same lattice, and the R8 wetness proxy. */
  readonly vegetation: DataTexture;
  readonly wetness: DataTexture;
}

const SEABED = vec3(0.105, 0.118, 0.098);
const SAND = vec3(0.52, 0.45, 0.31);
const ROCK = vec3(0.2, 0.19, 0.175);
/**
 * The third material weight. The chunk path leaves it at 0 ("earth", reserved); in the CDLOD bake it flags
 * man-made stone (breakwaters, piers, quay walls): weathered grey concrete and granite, lighter than the rock.
 */
const STONE = vec3(0.3, 0.295, 0.28);
/** Metres per noise tile: macro patches, grain and micro-relief. */
const MACRO_METRES = 37;
const GRAIN_METRES = 5.3;
const RELIEF_METRES = 1.25;

export function createTerrainMaterial(noise: DataTexture, lite = false, surface: TerrainSurface | null = null): TerrainMaterial {
  const eyeOffset = uniform(new Vector3());
  const wetness = uniform(0);
  const season = uniform(new Vector3(1, 0, 0));

  const pW = positionWorld.add(eyeOffset);
  // Texel centres sit on lattice points: uv = (index + 0.5) / dim, index = (x - WORLD_MIN) / (2 m x step).
  const surfaceUv = surface
    ? vec2(pW.x, pW.z).sub(WORLD_MIN).div(2 * surface.materialStep).add(0.5).div(surface.materialDim)
    : null;
  const w: Node<'vec4'> = surface && surfaceUv ? texture(surface.material, surfaceUv) : attribute('color', 'vec4');
  const grass = clamp(float(1).sub(w.x).sub(w.y).sub(w.z), 0, 1);
  const y = pW.y;
  const dist = positionView.length();
  const detail = smoothstep(120, 30, dist);

  // Mipped unit normals average to a shorter vector: renormalise after filtering.
  const nGeo = surface && surfaceUv ? normalize(texture(surface.normal, surfaceUv).xyz.mul(2).sub(1)) : normalWorldGeometry;
  // Patch noise (B channel, 0..1) mapped to -1..1; world-fixed, triplanar on steep ground.
  const macro = triplanarChannel(noise, pW, nGeo, MACRO_METRES, 'b').mul(2).sub(1);

  // Vegetation (CDLOD only): heath above the treeline, forest tint, wetter and lusher hollows, seasonal colour.
  const veg: Node<'vec4'> = surface && surfaceUv ? texture(surface.vegetation, surfaceUv) : vec4(1, 0, 0, 0);
  const wet01: Node<'float'> = surface && surfaceUv ? texture(surface.wetness, surfaceUv).r : float(0);
  const grassCol = groundCover(macro, wet01, veg, season);
  let base = grassCol.mul(grass).add(SAND.mul(w.x)).add(ROCK.mul(w.y)).add(STONE.mul(w.z));
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
  } else if (surface) {
    material.normalNode = transformNormalToView(nGeo);
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
    setSeason(fresh: number, summer: number, straw: number): void {
      season.value.set(fresh, summer, straw);
    },
  };
}
