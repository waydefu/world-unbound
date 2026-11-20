import { type DataTexture, FrontSide, MeshPhysicalNodeMaterial, type Node, Vector3 } from 'three/webgpu';
import {
  attribute, clamp, float, length, max, mix, normalize, normalWorldGeometry, positionView, positionWorld,
  smoothstep, texture, transformNormalToView, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { WORLD_MIN } from '../world/constants';
import { GRASS_COVER_METRES } from '../world/grassCover';
import { grassCanopy, type GrassCanopyWind } from './grassCanopy';
import { canopyShade, grassCarpetColour, grassCarpetWeight, groundCover, meadowTint } from './grassPalette';
import { triplanarChannel, triplanarSlope } from './noiseSampling';

/**
 * Procedural PBR terrain material (G1.3). The chunk colour attribute carries
 * material weights (sand, rock, earth) and baked AO, not an albedo. Noise is
 * evaluated at the absolute world position (camera-relative position plus the
 * eye offset) so patterns stay fixed in the world as the root moves.
 */
export interface TerrainMaterial {
  readonly material: MeshPhysicalNodeMaterial;
  /** @hot writes an existing uniform only */
  setEyeOffset(x: number, y: number, z: number): void;
  setWetness(wetness: number): void;
  /** Season weights (fresh, summer, straw) for the grass colour; see vegetationSeason in env/climate.ts. */
  setSeason(fresh: number, summer: number, straw: number): void;
  /**
   * Distance (m) to which grass is drawn over the ground (0 = no grass layer). Out to there the ground colour is
   * darkened where the meadow is dense: it stands for the shade between the blades, so the blades read as a sward.
   */
  setGrassRange(midM: number): void;
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
  readonly grassCover: DataTexture | null;
  readonly carpet: GrassCanopyWind | null;
}

const SEABED = vec3(0.105, 0.118, 0.098);
const SAND = vec3(0.52, 0.45, 0.31);
const ROCK = vec3(0.155, 0.165, 0.175);
const CHUNK_ROCK = vec3(0.2, 0.19, 0.175);
/**
 * The third material weight. The chunk path leaves it at 0 ("earth", reserved); in the CDLOD bake it flags
 * man-made stone (breakwaters, piers, quay walls): weathered grey concrete and granite, lighter than the rock.
 */
const STONE = vec3(0.24, 0.25, 0.265);
/** Share of the stone albedo lost on its darkest edge (steep flanks, the foot at the waterline). */
const STONE_EDGE_DARKENING = 0.27;
/** Metres per noise tile: macro patches, grain and micro-relief. */
const MACRO_METRES = 37;
const GRAIN_METRES = 5.3;
const RELIEF_METRES = 1.25;
/**
 * Specular strength of the ground (scales F0 and F90 of the dielectric; 1 = the default 4 % at normal incidence, rising
 * to 100 % at grazing). Soil, grass and rock are rough and diffuse: with the full Fresnel the low sun behind the ridges
 * bleached every sun-facing slope to grey-white at grazing view angles (cam 2). Wet ground shows as darker albedo; its
 * gloss stays low, since at grazing angles toward the sun even 0.3-0.55 roughness drew a silver streak across the field.
 */
const SPECULAR_DRY = 0.2;
const SPECULAR_WET = 0.12;
const WET_ROUGHNESS = 0.7;

export function createTerrainMaterial(noise: DataTexture, lite = false, surface: TerrainSurface | null = null): TerrainMaterial {
  const eyeOffset = uniform(new Vector3());
  const wetness = uniform(0);
  const season = uniform(new Vector3(1, 0, 0));
  const grassRange = uniform(0);

  const pW = positionWorld.add(eyeOffset);
  // Texel centres sit on lattice points: uv = (index + 0.5) / dim, index = (x - WORLD_MIN) / (2 m x step).
  const surfaceUv = surface
    ? vec2(pW.x, pW.z).sub(WORLD_MIN).div(2 * surface.materialStep).add(0.5).div(surface.materialDim)
    : null;
  const w: Node<'vec4'> = surface && surfaceUv ? texture(surface.material, surfaceUv) : attribute('color', 'vec4');
  const y = pW.y;
  const dist = positionView.length();
  const detail = smoothstep(120, 30, dist);

  // Mipped unit normals average to a shorter vector: renormalise after filtering.
  const nGeo = surface && surfaceUv ? normalize(texture(surface.normal, surfaceUv).xyz.mul(2).sub(1)) : normalWorldGeometry;
  // Patch noise (B channel, 0..1) mapped to -1..1; world-fixed, triplanar on steep ground.
  const macro = triplanarChannel(noise, pW, nGeo, MACRO_METRES, 'b').mul(2).sub(1);
  const grain = lite ? macro : triplanarChannel(noise, pW, nGeo, GRAIN_METRES, 'a').mul(2).sub(1);
  // Break up mixed rock/vegetation at the edge while preserving fully bare cliffs and fully vegetated slopes.
  const available = float(1).sub(w.x).sub(w.z).max(0);
  const rockShare = clamp(w.y.div(available.max(1e-3)), 0, 1);
  const mixedEdge = rockShare.mul(float(1).sub(rockShare));
  const rock = surface ? clamp(rockShare.add(grain.mul(mixedEdge).mul(1.8)), 0, 1).mul(available) : w.y;
  const grass = available.sub(rock).max(0);

  // Vegetation (CDLOD only): heath above the treeline, forest tint, wetter and lusher hollows, seasonal colour.
  const veg: Node<'vec4'> = surface && surfaceUv ? texture(surface.vegetation, surfaceUv) : vec4(1, 0, 0, 0);
  const wet01: Node<'float'> = surface && surfaceUv ? texture(surface.wetness, surfaceUv).r : float(0);
  // Shade between the blades inside the grass range: full at the eye, gone at the range edge (no visible ring).
  // Overlapping leaf shapes replace the smooth ground between sparse geometry. Mips average them into the
  // distant grass colour. Rotate the sample away from the terrain grid while preserving its scale.
  const tipUv = vec2(pW.x.add(pW.z), pW.z.sub(pW.x)).div(GRASS_COVER_METRES * Math.SQRT2);
  const tipNoise = surface?.grassCover && !surface.carpet ? texture(surface.grassCover, tipUv).r.sub(0.55) : float(0);
  const grassDist = length(pW.xz.sub(eyeOffset.xz));
  const tips = veg.r.mul(smoothstep(grassRange.mul(0.08), grassRange.mul(0.40).max(1), grassDist))
    .mul(grassRange.greaterThan(0).select(1, 0));
  const tipColour = meadowTint(veg.r, season.z).mul(mix(1, 1.08, tips));
  const grassDetail = float(1).add(tipNoise.mul(mix(1.55, 0.85, tips)).mul(veg.r));
  const baseGrass = groundCover(macro, wet01, veg, season).mul(canopyShade(veg.r, grassDist, grassRange))
    .mul(surface && !lite ? tipColour.mul(grassDetail) : float(1));
  const carpet = surface?.carpet && surface.grassCover
    ? grassCanopy(surface.grassCover, surface.carpet, pW.xz, grassDist, nGeo) : null;
  const carpetWeight = carpet ? grassCarpetWeight(veg.r) : float(0);
  const grassCol = carpet ? mix(baseGrass, grassCarpetColour(season).mul(carpet.tone), carpetWeight) : baseGrass;
  // Stone quays and breakwaters read as stone, not as a flat tan band: darker on the steep flank and at the foot,
  // where the wall meets the water.
  const stoneEdge = max(float(1).sub(nGeo.y).mul(4), float(1).sub(smoothstep(0.2, 1.3, y))).min(1);
  const stoneCol = STONE.mul(float(1).sub(stoneEdge.mul(STONE_EDGE_DARKENING))).mul(float(1).add(grain.mul(0.26)));
  const rockCol = surface ? ROCK.mul(float(1).add(grain.mul(0.28).add(macro.mul(0.12)))) : CHUNK_ROCK;
  let base = grassCol.mul(grass).add(SAND.mul(w.x)).add(rockCol.mul(rock)).add(stoneCol.mul(w.z));
  base = mix(base, SEABED, float(1).sub(smoothstep(-2.2, -0.2, y)));
  if (!lite) {
    const grainWeight = surface ? grass.mul(float(1).sub(carpetWeight.mul(0.85))).add(w.x) : float(1);
    base = base.mul(float(1).add(grain.mul(0.14).mul(mix(0.4, 1, detail)).mul(grainWeight)));
  }

  const rough = grass.mul(0.88).add(w.x.mul(0.92)).add(rock.mul(surface ? 0.8 : 0.72)).add(w.z.mul(0.9));
  const shore = float(1).sub(smoothstep(0.2, 1.4, y));
  const wet = max(shore.mul(float(1).sub(w.z.mul(0.45))), wetness.mul(float(1).sub(rock.mul(0.5))));
  const albedo = base.mul(mix(1, 0.55, wet));
  // Wet ground gets a gentler sheen than a water film would (roughness 0.3 turned the low sun into a silver streak).
  const roughness = mix(rough, WET_ROUGHNESS, wet);


  const material = new MeshPhysicalNodeMaterial({ metalness: 0, side: FrontSide });
  material.vertexColors = false;
  material.name = 'terrain';
  material.colorNode = albedo;
  material.roughnessNode = roughness;
  material.specularIntensityNode = mix(SPECULAR_DRY, SPECULAR_WET, wet);
  if (!lite) {
    // Micro-relief: one slope fetch (the texture stores the gradient), no finite differences.
    const g = triplanarSlope(noise, pW, nGeo, RELIEF_METRES);
    const strength = grass.mul(surface ? mix(0.38, 0.08, carpetWeight) : float(0.3)).add(w.x.mul(0.15)).add(rock.mul(0.6)).add(w.z.mul(0.34))
      .mul(detail).mul(mix(1, 0.4, wet));
    const ground = nGeo.sub(g.mul(strength));
    const nW = normalize(carpet ? ground.add(carpet.lean.mul(carpetWeight).mul(grass)) : ground);
    material.normalNode = transformNormalToView(nW);
  } else if (surface) {
    material.normalNode = transformNormalToView(nGeo);
  }
  const rockOcclusion = mix(w.w, w.w.max(0.55), rock.mul(detail));
  material.aoNode = surface ? rockOcclusion : w.w;

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
    setGrassRange(midM: number): void {
      grassRange.value = midM;
    },
  };
}
