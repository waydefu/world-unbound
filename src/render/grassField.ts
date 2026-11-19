import type { DataTexture, Node, UniformNode, Vector3, Vector4 } from 'three/webgpu';
import {
  clamp, cos, dot, float, floor, hash, ivec2, length, max, mix, positionGeometry, attribute, pow, sin, smoothstep,
  sqrt, texture, uint, vec2, vec3,
} from 'three/tsl';
import { TOWN_RADIUS, TOWN_X, TOWN_Z, WORLD_MIN } from '../world/constants';
import { CELL_M } from '../world/grassCells';
import { HEIGHT_DIM } from '../world/terrainTextures';
import { WIND_SPAN_M } from './windTexture';

/**
 * The part of the grass vertex shader that blades and cards share (spec G2.1 phases C and G): from (cell, index in
 * cell) derive the clump the blade belongs to, the clump's species archetype and look, the blade's place around the
 * clump centre, the terrain under it and the wind lean. Everything is a node graph evaluated in the vertex stage;
 * nothing is stored per blade or per clump.
 *
 * Clumps own the look (phase G.1): a cell holds CLUMPS_PER_CELL clumps at hashed centres, a blade index maps to a clump
 * by division, and the blade scatters around the centre (densest at the centre). Thin and card draws use the same
 * clump centres as the dense blades, and a thin blade is every `stride`-th dense blade, so survivors of a distance
 * fade keep their place.
 */
export interface GrassInputs {
  readonly height: DataTexture;
  readonly normal: DataTexture;
  readonly vegetation: DataTexture;
  readonly wetness: DataTexture;
  readonly noise: DataTexture;
  readonly wind: DataTexture;
  /** Texels per side of the vegetation lattice and lattice cells per texel (the material texture's). */
  readonly vegetationDim: number;
  readonly vegetationStep: number;
}

export interface GrassUniforms {
  /** Eye position, absolute world metres. */
  eye: UniformNode<'vec3', Vector3>;
  /** (dirX, dirZ, speed m/s, gust01) of the global wind. */
  wind: UniformNode<'vec4', Vector4>;
  /** Frame time (s) for the flutter; gust travel as cycles integrated on the CPU. */
  time: UniformNode<'float', number>;
  gustPhase: UniformNode<'float', number>;
  /** Fresh / summer / straw weights. */
  season: UniformNode<'vec3', Vector3>;
  /** Ground wetness 0..1 of the weather (wet blades are darker, like the wet terrain). */
  wetness: UniformNode<'float', number>;
  /** Sun direction (towards the sun, unit) and sun illuminance colour (pre-exposed), for the translucency. */
  sunDir: UniformNode<'vec3', Vector3>;
  sunColour: UniformNode<'vec3', Vector3>;
  /** (nearM, midM, cardInnerM, 0). */
  rings: UniformNode<'vec4', Vector4>;
}

/** How a draw's instance index maps to clumps: clump = floor(index * stride / perClump). */
export interface GrassLayout {
  readonly stride: number;
  readonly perClump: number;
}

/** Wavelength of the travelling gusts (m) and of the finer ripple riding on them. */
export const GUST_WAVELENGTH_M = 30;
const RIPPLE_WAVELENGTH_M = 11;
/** Wind speed (m/s, local, after shelter) at which grass is fully laid over; a storm in the village reaches it. */
const FULL_LEAN_MS = 10;
/** Clumps per 8 m cell: one per 0.67 m2, a clump every 0.8 m or so (research note 7: clumps of 0.6-1.5 m). */
export const CLUMPS_PER_CELL = 96;
/** The thin mesh reuses one of every four dense blades. */
export const THIN_BLADE_STRIDE = 4;
/** Metres per noise tile of the macro patches the terrain shader uses (the colour must match) and of the patch noise. */
export const MACRO_METRES = 37;
const PATCH_M = 17;
const LAST_TEXEL = HEIGHT_DIM - 1;
const TWO_PI = 2 * Math.PI;
const LOD0 = float(0);

type F = Node<'float'>;

/**
 * Species archetypes (phase G.8; species from general knowledge of western-Norway semi-natural grassland, not
 * verified for Hellesylt). Heights in metres, as (low, high) of the mid-range a clump scales by 0.6-1.4.
 *   pasture   - red fescue, common bent: grazed 5-12 cm, very fine, little lean (village lawn, flat low ground);
 *   hayMeadow - sweet vernal grass, cock's-foot: 30-60 cm, softer bend, seed heads and flower specks (valley floor);
 *   tussock   - tufted hair-grass: 40-80 cm, tight clumps that arch outwards (hollows, moist ground);
 *   heath     - heather, crowberry: short dark purple-brown cards only, no blades (above the treeline, thin soil).
 */
const PASTURE = { height: 0.085, width: 0.016, radius: 0.6, stiffness: 0.6, bend: 0.08 }; // unverified
const HAY = { height: 0.45, width: 0.03, radius: 0.8, stiffness: 1, bend: 0.25 }; // unverified
const TUSSOCK = { height: 0.6, width: 0.02, radius: 0.36, stiffness: 0.8, bend: 0.5 }; // unverified
const HEATH = { height: 0.11, width: 0.03, radius: 0.5, stiffness: 0.5, bend: 0.1 }; // unverified

/** Per-blade species look. Weights are 0 or 1 per clump (heath beats the rest). */
export interface Archetype {
  height: F;
  width: F;
  stiffness: F;
  /** 1 for hay meadow (seed heads, flower specks), tussock, short pasture and lawn, and heath respectively. */
  hay: F;
  tussock: F;
  pasture: F;
  heath: F;
}

export interface GrassField {
  /** Random number k in [0, 1) of this blade (card). */
  rnd: (k: number) => F;
  /** Root position: x, terrain height, z (absolute world). */
  root: Node<'vec3'>;
  /** Unit terrain normal, world axes. */
  terrainNormal: Node<'vec3'>;
  /** Meadow, heath, tree, bare at the root; wetness; macro noise -1..1. */
  veg: Node<'vec4'>;
  wet: F;
  macro: F;
  /** Horizontal distance from the eye (m). */
  dist: F;
  /** Distance to the cell centre, used to finish the dense fade before the CPU switches LOD. */
  cellDist: F;
  archetype: Archetype;
  /** Where the blade leans when no wind blows: unit xz direction and the fraction of its height the tip moves. */
  restDir: Node<'vec2'>;
  restBend: F;
  /** Local wind direction (unit xz) and the lean (fraction of the height the tip is displaced). */
  windDir: Node<'vec2'>;
  lean: (stiffness: F) => F;
  /** Multiplier of the survival probability of this blade: clumps and patches of thick and thin growth. */
  densityMul: F;
  /** Colour multiplier of this blade: brightness and a yellow-to-blue-green hue shift, clump and blade. */
  variation: Node<'vec3'>;
}

/**
 * Builds the shared graph. `salt` separates the random streams of blades and cards that share a cell.
 * Must be called inside an Fn (it creates variables).
 */
export function grassField(inp: GrassInputs, u: GrassUniforms, layout: GrassLayout, salt: number): GrassField {
  const cell = attribute('grassCell', 'vec4');
  const idx = positionGeometry.z.mul(layout.stride);
  const cellU = cell.x.sub(WORLD_MIN).div(CELL_M).toUint().mul(uint(512)).add(cell.y.sub(WORLD_MIN).div(CELL_M).toUint());
  const bladeU = cellU.mul(uint(8192)).add(idx.toUint()).mul(uint(16)).add(uint(salt));
  const rnd = (k: number): F => hash(bladeU.add(uint(k)));
  // Clump streams carry no salt: blades, thin blades and cards of one cell share their clumps.
  const clump = floor(idx.div(layout.perClump));
  const clumpU = cellU.mul(uint(256)).add(clump.toUint()).mul(uint(16));
  const cr = (k: number): F => hash(clumpU.add(uint(k + 900000)));

  const surfaceUv = (x: F, z: F): Node<'vec2'> => vec2(x, z).sub(WORLD_MIN).div(2 * inp.vegetationStep).add(0.5).div(inp.vegetationDim);
  const heights = texture(inp.height);
  const load = (i: F, j: F): F => heights.load(ivec2(clamp(i, 0, LAST_TEXEL).toInt(), clamp(j, 0, LAST_TEXEL).toInt())).r;

  // Clump centre and what lies under it: species is decided per clump.
  const cx = cell.x.add(cr(0).mul(CELL_M));
  const cz = cell.y.add(cr(1).mul(CELL_M));
  const uvC = surfaceUv(cx, cz);
  const vegC = texture(inp.vegetation, uvC).level(LOD0);
  const wetC = texture(inp.wetness, uvC).level(LOD0).r;
  const nyC = texture(inp.normal, uvC).level(LOD0).y.mul(2).sub(1);
  const yC = load(cx.sub(WORLD_MIN).mul(0.5).add(0.5).floor(), cz.sub(WORLD_MIN).mul(0.5).add(0.5).floor());
  const town = float(1).sub(smoothstep(TOWN_RADIUS - 15, TOWN_RADIUS, length(vec2(cx.sub(TOWN_X), cz.sub(TOWN_Z)))));
  const heath = vegC.g.div(vegC.r.add(vegC.g).max(1e-3)).greaterThan(0.5).select(1, 0);
  const tussockW = smoothstep(0.3, 0.5, wetC).mul(float(1).sub(town)).mul(smoothstep(0.85, 0.95, nyC));
  const hayW = smoothstep(0.93, 0.97, nyC).mul(float(1).sub(smoothstep(60, 110, yC)))
    .mul(float(1).sub(town)).mul(float(1).sub(tussockW));
  const pick = cr(3);
  const isTussock = pick.lessThan(tussockW).select(1, 0).mul(float(1).sub(heath));
  const isHay = pick.lessThan(tussockW.add(hayW)).select(1, 0).mul(float(1).sub(isTussock)).mul(float(1).sub(heath));
  const pasture = float(1).sub(isTussock).sub(isHay).sub(heath);
  const sel = (p: number, h: number, t: number, e: number): F =>
    pasture.mul(p).add(isHay.mul(h)).add(isTussock.mul(t)).add(heath.mul(e));

  // Clump look (phase G.1): height scale 0.6-1.4, lean direction and amount, hue offset.
  const clumpH = cr(2).mul(0.8).add(0.6);
  const leanAngle = cr(4).mul(TWO_PI);
  const clumpHue = cr(5).sub(0.5);
  const radius = sel(PASTURE.radius, HAY.radius, TUSSOCK.radius, HEATH.radius);

  // Mix irregular clumps with dispersed blades so contiguous uncovered strips cannot form between clumps.
  const angle = rnd(0).mul(TWO_PI);
  const rad = sqrt(rnd(1)).mul(radius).mul(1.25);
  const dispersed = rnd(2).lessThan(mix(0.4, 0.15, isTussock));
  const x = dispersed.select(cell.x.add(rnd(0).mul(CELL_M)), cx.add(cos(angle).mul(rad)));
  const z = dispersed.select(cell.y.add(rnd(1).mul(CELL_M)), cz.add(sin(angle).mul(rad)));
  const edge = float(1).sub(rad.div(radius).mul(0.25));

  const uv = surfaceUv(x, z);
  const veg = texture(inp.vegetation, uv).level(LOD0);
  const wet = texture(inp.wetness, uv).level(LOD0).r;
  const nrm = texture(inp.normal, uv).level(LOD0).xyz.mul(2).sub(1).normalize();

  // Terrain height at the root: bilinear of four lattice points on the same triangle split as the terrain mesh.
  const lx = x.sub(WORLD_MIN).mul(0.5);
  const lz = z.sub(WORLD_MIN).mul(0.5);
  const ix = floor(lx);
  const iz = floor(lz);
  const fx = lx.sub(ix);
  const fz = lz.sub(iz);
  const h00 = load(ix, iz);
  const h10 = load(ix.add(1), iz);
  const h01 = load(ix, iz.add(1));
  const h11 = load(ix.add(1), iz.add(1));
  const lower = h00.add(h10.sub(h00).mul(fx)).add(h01.sub(h00).mul(fz));
  const upper = h11.add(h01.sub(h11).mul(float(1).sub(fx))).add(h10.sub(h11).mul(float(1).sub(fz)));
  const y = fx.add(fz).lessThanEqual(1).select(lower, upper);
  // Roots sit a little below the surface (more on slopes, where the bilinear height and the mesh differ most).
  const root = vec3(x, y.sub(float(1).sub(nrm.y).mul(0.25).add(0.03)), z);

  // Patch noise (alpha channel, ~17 m): tall and short, thick and thin, dry and lush areas.
  const patch = texture(inp.noise, vec2(x, z).div(PATCH_M)).level(LOD0).a;
  const densityMul = mix(0.85, 1.3, cr(6)).mul(mix(0.75, 1.15, patch));
  const hue = clumpHue.mul(0.8).add(rnd(14).sub(0.5).mul(0.3));
  const variation = vec3(hue.mul(0.26).add(1), hue.mul(0.04).add(1), float(1).sub(hue.mul(0.26))).mul(rnd(15).mul(0.16).add(0.92));

  // Height: archetype mid-range x clump (0.6-1.4) x blade (+-30 %) x patch, lower at the clump's edge.
  const height = sel(PASTURE.height, HAY.height, TUSSOCK.height, HEATH.height)
    .mul(clumpH).mul(rnd(4).mul(0.6).add(0.7)).mul(patch.mul(0.3).add(0.85)).mul(edge);
  const archetype: Archetype = {
    height,
    width: sel(PASTURE.width, HAY.width, TUSSOCK.width, HEATH.width).mul(rnd(12).mul(0.5).add(0.75)),
    stiffness: sel(PASTURE.stiffness, HAY.stiffness, TUSSOCK.stiffness, HEATH.stiffness),
    hay: isHay, tussock: isTussock, pasture, heath,
  };

  // Rest lean: the clump leans one way (amount 0.5-1.5 x the archetype's bend); tussock blades arch outwards.
  const outward = vec2(cos(angle), sin(angle));
  const clumpDir = vec2(cos(leanAngle.add(rnd(10).sub(0.5).mul(0.9))), sin(leanAngle.add(rnd(10).sub(0.5).mul(0.9))));
  const restDir = mix(clumpDir, outward, isTussock.mul(0.7)).normalize();
  const restBend = sel(PASTURE.bend, HAY.bend, TUSSOCK.bend, HEATH.bend).mul(cr(7).add(0.5)).mul(rnd(13).mul(0.6).add(0.7));

  // Colour noise: the terrain shader's macro patches (top projection of the shared noise texture, channel b).
  const macro = texture(inp.noise, vec2(x, z).div(MACRO_METRES)).level(LOD0).b.mul(2).sub(1);
  const dist = length(vec2(x.sub(u.eye.x), z.sub(u.eye.z)));
  const cellDist = length(cell.xy.add(CELL_M / 2).sub(u.eye.xz));

  // Wind: the local velocity at the root from the wind texture, and gust fronts travelling along the global wind.
  const w = texture(inp.wind, vec2(x, z).div(WIND_SPAN_M)).level(LOD0);
  const speed = length(w.xy);
  const windDir = w.xy.div(max(speed, 0.05));
  const gustDir = vec2(u.wind.x, u.wind.y);
  const along = dot(vec2(x, z), gustDir);
  // Gust fronts: a slow wave along the wind (sharpened so lulls and gusts alternate) carrying a faster ripple. The
  // clump shifts the phase a little, so a clump moves as one and neighbours differ.
  const phase0 = w.z.add(cr(8).mul(0.12));
  const front = pow(sin(phase0.add(along.div(GUST_WAVELENGTH_M)).sub(u.gustPhase).mul(TWO_PI)).mul(0.5).add(0.5), float(2));
  const ripple = sin(phase0.mul(2).add(along.div(RIPPLE_WAVELENGTH_M)).sub(u.gustPhase.mul(2.4)).mul(TWO_PI)).mul(0.5).add(0.5);
  const lean = (stiffness: F): F => {
    const sp = clamp(speed.div(FULL_LEAN_MS), 0, 1.4);
    // Steady lean (calm 0.1, storm 0.7), travelling gusts (a few cm of tip motion in calm, a lot in a storm) and
    // per-blade flutter whose amplitude and pitch rise with the wind.
    const steady = pow(sp, float(1.3)).mul(0.7);
    const gusts = mix(0.16, 0.32, clamp(sp, 0, 1)).mul(u.wind.w.mul(0.45).add(0.55)).mul(front.mul(0.75).add(ripple.mul(0.25)));
    const flutter = sin(u.time.mul(rnd(6).mul(6).add(6)).mul(sp.mul(2.2).add(0.6)).add(rnd(7).mul(TWO_PI))).mul(sp.mul(0.1).add(0.01));
    return steady.add(gusts).add(flutter).mul(stiffness);
  };

  return { rnd, root, terrainNormal: nrm, veg, wet, macro, dist, cellDist, archetype, restDir, restBend, windDir, lean, densityMul, variation };
}
