import type { DataTexture, Node, UniformNode, Vector3, Vector4 } from 'three/webgpu';
import {
  clamp, dot, float, floor, hash, ivec2, length, max, mix, positionGeometry, attribute, sin, smoothstep,
  texture, uint, vec2, vec3,
} from 'three/tsl';
import { TOWN_RADIUS, TOWN_X, TOWN_Z, WORLD_MIN } from '../world/constants';
import { CELL_M } from '../world/grassCells';
import { HEIGHT_DIM } from '../world/terrainTextures';
import { WIND_SPAN_M } from './windTexture';

/**
 * The part of the grass vertex shader that blades and cards share (spec G2.1 phase C): from (cell, index in
 * cell) derive the random numbers, the root position on the terrain, the vegetation, wetness and normal under
 * it, the species archetype and the wind lean. Everything is a node graph evaluated in the vertex stage.
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

/** Wavelength of the travelling gusts (m). */
export const GUST_WAVELENGTH_M = 40;
/** Metres per noise tile of the macro patches the terrain shader uses (the colour must match). */
export const MACRO_METRES = 37;
const LAST_TEXEL = HEIGHT_DIM - 1;
const TWO_PI = 2 * Math.PI;
const LOD0 = float(0);

type F = Node<'float'>;

/** Archetypes (flora note: pasture, hay meadow, tussock). Heights in metres. */
export interface Archetype {
  /** Blade height (m), width at the base (m), stiffness (wind lean multiplier). */
  height: F;
  width: F;
  stiffness: F;
  /** 1 for hay meadow (seed heads, flower specks) and tussock respectively. */
  hay: F;
  tussock: F;
  /** 1 for short pasture and lawn. */
  pasture: F;
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
  archetype: Archetype;
  /** Local wind direction (unit xz) and the lean (fraction of the height the tip is displaced). */
  windDir: Node<'vec2'>;
  lean: (stiffness: F) => F;
}

/**
 * Builds the shared graph. `salt` separates the random streams of blades and cards that share a cell;
 * `clumping` is the fraction of tussock blades snapped to a per-cell clump centre.
 * Must be called inside an Fn (it creates variables).
 */
export function grassField(inp: GrassInputs, u: GrassUniforms, salt: number, clumping: number): GrassField {
  const cell = attribute('grassCell', 'vec4');
  const index = positionGeometry.z;
  const cellU = cell.x.sub(WORLD_MIN).div(CELL_M).toUint().mul(uint(512)).add(cell.y.sub(WORLD_MIN).div(CELL_M).toUint());
  const bladeU = cellU.mul(uint(2048)).add(index.toUint()).mul(uint(16)).add(uint(salt));
  const rnd = (k: number): F => hash(bladeU.add(uint(k)));
  const cellRnd = (k: number): F => hash(cellU.mul(uint(16)).add(uint(salt + 100000 + k)));

  // Root before clumping: uniform in the cell.
  const x0 = cell.x.add(rnd(0).mul(CELL_M)).toVar();
  const z0 = cell.y.add(rnd(1).mul(CELL_M)).toVar();
  const surfaceUv = (x: F, z: F): Node<'vec2'> => vec2(x, z).sub(WORLD_MIN).div(2 * inp.vegetationStep).add(0.5).div(inp.vegetationDim);
  const uv0 = surfaceUv(x0, z0);
  const veg = texture(inp.vegetation, uv0).level(LOD0).toVar();
  const wet = texture(inp.wetness, uv0).level(LOD0).r.toVar();
  const nrm = texture(inp.normal, uv0).level(LOD0).xyz.mul(2).sub(1).normalize().toVar();

  // Archetype: tussock in hollows, hay meadow on flat low ground, pasture elsewhere and on the village lawn.
  const town = float(1).sub(smoothstep(TOWN_RADIUS - 15, TOWN_RADIUS, length(vec2(x0.sub(TOWN_X), z0.sub(TOWN_Z)))));
  const tussockW = smoothstep(0.3, 0.5, wet).mul(float(1).sub(town)).mul(smoothstep(0.85, 0.95, nrm.y));
  const pick = rnd(3);
  const isTussock = pick.lessThan(tussockW).select(1, 0).toVar();

  // Tussock clumps: a share of the blades is pulled to one of four per-cell clump centres.
  const clump = floor(rnd(2).mul(3.999));
  const cx = cell.x.add(mix(cellRnd(0), cellRnd(4), clump.greaterThan(0.5).select(1, 0)).mul(CELL_M));
  const cz = cell.y.add(mix(cellRnd(1), cellRnd(5), clump.greaterThan(1.5).select(1, 0)).mul(CELL_M));
  const snapped = isTussock.mul(rnd(5).lessThan(clumping).select(1, 0));
  const x = mix(x0, cx.add(x0.sub(cx).mul(0.12)), snapped).toVar();
  const z = mix(z0, cz.add(z0.sub(cz).mul(0.12)), snapped).toVar();

  // Terrain height at the root: bilinear of four lattice points on the same triangle split as the terrain mesh.
  const heights = texture(inp.height);
  const load = (i: F, j: F): F => heights.load(ivec2(clamp(i, 0, LAST_TEXEL).toInt(), clamp(j, 0, LAST_TEXEL).toInt())).r;
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
  const root = vec3(x, y, z).toVar();

  const hayW = smoothstep(0.93, 0.97, nrm.y).mul(float(1).sub(smoothstep(60, 110, y)))
    .mul(float(1).sub(town)).mul(float(1).sub(tussockW));
  const isHay = pick.lessThan(tussockW.add(hayW)).select(1, 0).mul(float(1).sub(isTussock)).toVar();
  const r4 = rnd(4);
  const pasture = float(1).sub(isTussock).sub(isHay);
  const archetype: Archetype = {
    height: pasture.mul(r4.mul(0.08).add(0.06)).add(isHay.mul(r4.mul(0.3).add(0.3))).add(isTussock.mul(r4.mul(0.4).add(0.4))),
    width: pasture.mul(0.06).add(isHay.mul(0.036)).add(isTussock.mul(0.04)),
    stiffness: pasture.mul(0.35).add(isHay).add(isTussock.mul(0.8)),
    hay: isHay,
    tussock: isTussock,
    pasture,
  };

  // Colour noise: the terrain shader's macro patches (top projection of the shared noise texture, channel b).
  const macro = texture(inp.noise, vec2(x, z).div(MACRO_METRES)).level(LOD0).b.mul(2).sub(1);
  const dist = length(vec2(x.sub(u.eye.x), z.sub(u.eye.z)));

  // Wind: the local velocity at the root from the wind texture, and a gust wave travelling along the global wind.
  const w = texture(inp.wind, vec2(x, z).div(WIND_SPAN_M)).level(LOD0);
  const speed = length(w.xy);
  const windDir = w.xy.div(max(speed, 0.05));
  const gustDir = vec2(u.wind.x, u.wind.y);
  const phase = w.z.add(dot(vec2(x, z), gustDir).div(GUST_WAVELENGTH_M)).sub(u.gustPhase);
  const wave = sin(phase.mul(TWO_PI)).mul(0.5).add(0.5);
  const lean = (stiffness: F): F => {
    const base = clamp(speed.div(12), 0, 1).mul(0.5);
    const gust = u.wind.w.mul(wave.mul(wave)).mul(clamp(speed.div(8), 0.25, 1)).mul(0.5);
    const flutter = sin(u.time.mul(rnd(6).mul(3).add(3)).add(rnd(7).mul(TWO_PI))).mul(0.04).mul(clamp(speed.div(10), 0, 1).add(0.4));
    return base.add(gust).add(flutter).mul(stiffness);
  };

  return { rnd, root, terrainNormal: nrm, veg, wet, macro, dist, archetype, windDir, lean };
}
