import { DoubleSide, MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn, attribute, cos, dot, float, max, mix, normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, step,
  transformNormalToView, varyingProperty, vec3,
} from 'three/tsl';
import { grassField, type GrassField, type GrassInputs, type GrassLayout, type GrassUniforms } from './grassField';
import { canopyShade, groundCover } from './grassPalette';

/**
 * Grass materials (spec G2.1 phases C and G): three Lambert node materials whose vertex stage builds every blade (or
 * card) from (cell, index) with `grassField`. Lambert because blades are thin and many: diffuse sun and
 * hemisphere light with the CSM shadows, no specular. The translucency of a backlit blade is added as emission.
 *
 *  - dense:  3-segment curved blades near the eye; blades drop out by their hash with distance;
 *  - thin:   2-segment blades (every fourth dense blade) from half the ring to its edge;
 *  - card:   tufts of three blades, dropping in over the blade ring's last part and out at the mid limit.
 */
export type GrassKind = 'dense' | 'thin' | 'card';

const BUTTERCUP = vec3(0.62, 0.44, 0.03);
const CLOVER = vec3(0.56, 0.55, 0.5);
const SEED_HEAD = vec3(0.36, 0.31, 0.14);
/** Heather in late summer: dark purple-brown (the terrain's heath colour is its brown base). // unverified */
const HEATHER = vec3(0.13, 0.085, 0.095);
/** Tufted hair-grass is silvery: a cool, slightly lighter cast on the grass colour. // unverified */
const SILVER = vec3(0.94, 1.04, 1.08);
/** Share of a leaf's diffuse light transmitted when the sun is behind it. */
const TRANSLUCENCY = 0.3;
const TWO_PI = 2 * Math.PI;
/** Random-stream salts so blades and cards sharing a cell do not repeat each other. */
const SALT = { dense: 0, thin: 0, card: 7919 } as const;
/** Smallest blade width as a fraction of the distance (about one pixel at 720p and 60 degrees): no sub-pixel shimmer. */
const MIN_WIDTH_PER_M = 0.0013;

function buildVertex(kind: GrassKind, inp: GrassInputs, u: GrassUniforms, layout: GrassLayout) {
  const vColour = varyingProperty('vec3', `grassColour_${kind}`);
  const vNormal = varyingProperty('vec3', `grassNormal_${kind}`);
  const vHeight = varyingProperty('float', `grassHeight_${kind}`);
  const position = Fn(() => {
    const f: GrassField = grassField(inp, u, layout, SALT[kind]);
    const near = u.rings.x;
    const mid = u.rings.y;
    const inner = u.rings.z;
    const side = positionGeometry.x;
    const t = positionGeometry.y;
    const a = f.archetype;
    const d = f.dist;
    const yaw = f.rnd(9).mul(TWO_PI);

    // Fade by dropping blades (phase G.6): survivors keep their place and size. Dense blades thin out from 30 % to
    // 50 % of the ring (where the thin class, a quarter of the blades, takes over), thin blades from 70 % to the edge,
    // cards drop in over the last 40 % of the blade ring and out over the last 30 % of the mid ring.
    // Cards stand for grass and heath alike; blades only for grass (meadow density).
    let keep: Node<'float'> = f.veg.r.mul(f.densityMul);
    if (kind === 'dense') {
      keep = keep.mul(mix(1, 0.3, smoothstep(near.mul(0.3), near.mul(0.5), d)));
    } else if (kind === 'thin') {
      keep = keep.mul(float(1).sub(smoothstep(near.mul(0.7), near, d)));
    } else {
      const fade = smoothstep(inner, inner.add(near.mul(0.4).max(1)), d).mul(float(1).sub(smoothstep(mid.mul(0.7), mid, d)));
      keep = keep.add(f.veg.g.mul(0.8).mul(a.heath)).mul(0.85).mul(fade);
    }
    // Heath has no blades: its meadow density is already ~0 there, cards carry it.
    const alive = f.rnd(8).lessThan(keep).select(1, 0);
    const lean = f.lean(a.stiffness);
    const out = f.root;
    // Total bend: the rest lean of the clump plus the wind (fraction of the height the tip moves, quadratic along t).
    const bend = f.restBend.add(lean);
    const hs = a.height.mul(alive);
    const rest = f.restDir.mul(f.restBend.mul(hs).mul(t).mul(t));
    const windOff = f.windDir.mul(lean.mul(hs).mul(t).mul(t));
    const lift = t.mul(hs).mul(float(1).sub(bend.mul(bend).mul(0.3)));

    let px = out.x;
    let py = out.y;
    let pz = out.z;
    let normal = f.terrainNormal;
    if (kind === 'card') {
      const part = attribute('part', 'float');
      const psi = yaw.add(part.mul(TWO_PI / 3));
      const outX = cos(psi);
      const outZ = sin(psi);
      const tuft = f.rnd(10).mul(0.5).add(0.6);
      const width = max(a.width, d.mul(MIN_WIDTH_PER_M)).mul(3.4).mul(float(1).sub(t.mul(0.9))).mul(alive);
      const reach = float(0.07).mul(alive).add(t.mul(hs).mul(0.3));
      px = out.x.add(outX.mul(reach)).add(outZ.negate().mul(side).mul(width).mul(0.5)).add(rest.x.mul(tuft)).add(windOff.x.mul(tuft));
      py = out.y.add(lift.mul(tuft));
      pz = out.z.add(outZ.mul(reach)).add(outX.mul(side).mul(width).mul(0.5)).add(rest.y.mul(tuft)).add(windOff.y.mul(tuft));
      normal = normalize(mix(f.terrainNormal, vec3(outX, 0.5, outZ), 0.3));
    } else {
      const right = vec3(cos(yaw), 0, sin(yaw));
      const fwd = vec3(sin(yaw).negate(), 0, cos(yaw));
      // Tapered to a point; hay meadow seed heads thicken just under the tip; thin far blades are widened to about a pixel.
      const taper = float(1).sub(t.mul(0.9));
      const seedBulge = a.hay.mul(step(f.rnd(11), 0.08)).mul(smoothstep(0.7, 0.8, t)).mul(float(1).sub(smoothstep(0.93, 1, t))).mul(1.6).add(1);
      const widthM = max(a.width, d.mul(MIN_WIDTH_PER_M)).mul(taper).mul(seedBulge).mul(alive);
      px = out.x.add(right.x.mul(side).mul(widthM).mul(0.5)).add(rest.x).add(windOff.x);
      py = out.y.add(lift);
      pz = out.z.add(right.z.mul(side).mul(widthM).mul(0.5)).add(rest.y).add(windOff.y);
      // Rounded normal (phase G.4): tilted across the width towards the side, towards the blade's face on tall
      // blades, and anchored to the terrain normal at the root. Short pasture is lit like the ground.
      const towardsEye = fwd.x.mul(u.eye.x.sub(out.x)).add(fwd.z.mul(u.eye.z.sub(out.z)));
      const facing = towardsEye.greaterThan(0).select(float(1), float(-1));
      normal = normalize(f.terrainNormal.add(right.mul(side).mul(0.35)).add(fwd.mul(facing).mul(float(0.3).mul(float(1).sub(a.pasture.mul(0.7))))));
    }

    // Colour (phase G.5): the terrain's ground colour at the root, from the same functions and inputs (macro noise,
    // wetness, season, shade between blades, wet shore); the tip lifted a small step in brightness and warmth; each
    // clump and blade a little different. No blade is darker than the ground under it.
    const wetDark = mix(1, 0.55, max(float(1).sub(smoothstep(0.2, 1.4, out.y)), u.wetness));
    let ground = groundCover(f.macro, f.wet, f.veg, u.season).mul(canopyShade(f.veg.r, d, mid)).mul(wetDark);
    ground = mix(ground, ground.mul(SILVER), a.tussock.mul(0.7));
    ground = mix(ground, HEATHER.mul(float(1).add(u.season.y)).mul(wetDark), a.heath);
    const tipLift = mix(vec3(1, 1, 1), vec3(1.14, 1.16, 0.9), smoothstep(0.1, 1, t));
    let colour = ground.mul(f.variation).mul(tipLift);
    if (kind !== 'card') {
      const green = float(1).sub(u.season.z);
      const seeds = a.hay.mul(smoothstep(0.78, 0.9, t)).mul(step(f.rnd(11), 0.08)).mul(0.85);
      colour = mix(colour, SEED_HEAD.mul(mix(1, 0.8, u.season.y)).mul(wetDark), seeds);
      const r = f.rnd(11).mul(1.0);
      const tip = smoothstep(0.82, 0.95, t).mul(a.hay).mul(green);
      colour = mix(colour, BUTTERCUP.mul(wetDark), step(0.9, r).mul(step(r, 0.93)).mul(tip));
      colour = mix(colour, CLOVER.mul(wetDark).mul(0.8), step(0.93, r).mul(step(r, 0.96)).mul(tip));
    }
    vColour.assign(colour);
    vNormal.assign(normal);
    vHeight.assign(t);
    return vec3(px, py, pz);
  });
  return { position, vColour, vNormal, vHeight };
}

/** Builds the material of one grass class. `lite` skips the translucency term (low tier). */
export function createGrassMaterial(kind: GrassKind, inp: GrassInputs, u: GrassUniforms, layout: GrassLayout, lite: boolean): MeshLambertNodeMaterial {
  const { position, vColour, vNormal, vHeight } = buildVertex(kind, inp, u, layout);
  const material = new MeshLambertNodeMaterial({ side: DoubleSide });
  material.name = `grass-${kind}`;
  material.positionNode = position();
  material.colorNode = vColour;
  material.normalNode = transformNormalToView(vNormal);
  if (!lite) {
    // Backlit blades glow: pow(saturate(V . -L), 4), strongest at the tip, tinted by the blade colour. The sun's
    // pre-exposed illuminance over pi is the radiance a fully lit white Lambert surface returns.
    const view = normalize(positionWorld.negate());
    const backlit = pow(saturate(dot(view, u.sunDir.negate())), 4).mul(vHeight);
    material.emissiveNode = vColour.mul(u.sunColour).mul(backlit).mul(TRANSLUCENCY / Math.PI);
  }
  return material;
}
