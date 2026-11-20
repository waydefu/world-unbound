import { DoubleSide, MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn, attribute, cos, dot, float, max, mix, normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, step,
  texture, transformNormalToView, varying, varyingProperty, vec2, vec3,
} from 'three/tsl';
import { CARD_FADE_JITTER_SHARE, THIN_BLADE_STRIDE, grassField, type GrassField, type GrassInputs, type GrassLayout, type GrassUniforms } from './grassField';
import { canopyShade, groundCover, meadowTint } from './grassPalette';

/**
 * Grass materials (spec G2.1 phases C and G): three Lambert node materials whose vertex stage builds every blade (or
 * card) from (cell, index) with `grassField`. Lambert because blades are thin and many: diffuse sun and
 * hemisphere light with the CSM shadows, no specular. The translucency of a backlit blade is added as emission.
 *
 *  - dense:  curved blades and two short companion leaves near the eye;
 *  - thin:   1-segment blades (every second dense blade) from half the ring to its edge;
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
const MIN_WIDTH_PER_M = 0.00095;

function buildVertex(kind: GrassKind, inp: GrassInputs, u: GrassUniforms, layout: GrassLayout, lite: boolean) {
  const vColour = varyingProperty('vec3', `grassColour_${kind}`);
  const vNormal = varyingProperty('vec3', `grassNormal_${kind}`);
  const vHeight = varyingProperty('float', `grassHeight_${kind}`);
  const vCardDetail = kind === 'card' && inp.cardMask ? varyingProperty('float', 'grassCardDetail') : null;
  const position = Fn(() => {
    const companion = kind === 'dense' ? attribute('part', 'float') : null;
    const f: GrassField = grassField(inp, u, layout, SALT[kind], companion);
    const near = u.rings.x;
    const mid = u.rings.y;
    const inner = u.rings.z;
    const side = positionGeometry.x;
    const t = positionGeometry.y;
    const a = f.archetype;
    const d = f.dist;
    const yaw = f.rnd(9).mul(TWO_PI).add(companion ? companion.mul(2.4) : 0);

    // Every second dense blade is also in the thin mesh. Fade only the extra blades as the cell approaches
    // the CPU's halfway switch, keeping the same surviving roots and probability on either side.
    // Cards stand for grass and heath alike; blades only for grass (meadow density).
    let keep: Node<'float'> = f.veg.r.mul(f.densityMul);
    if (inp.sward) keep = keep.mul(mix(1, 1.48, f.lawn));
    const shared = positionGeometry.z.div(THIN_BLADE_STRIDE).fract().equal(0);
    if (kind === 'dense') {
      const spread = f.rnd(5).sub(0.5).mul(near.mul(0.24));
      const extra = float(1).sub(smoothstep(near.mul(0.3), near.mul(0.48), d.add(spread)))
        .mul(float(1).sub(smoothstep(near.mul(0.42), near.mul(0.5), f.cellDist)));
      keep = keep.mul(shared.select(1, extra));
      if (companion) keep = keep.mul(companion.greaterThan(0).select(extra, 1));
    } else if (kind === 'thin') {
      keep = keep.mul(float(1).sub(smoothstep(near.mul(0.7), near, d)));
    } else {
      const fadeDistance = d.add(f.rnd(3).sub(0.5).mul(near.mul(CARD_FADE_JITTER_SHARE)));
      const fade = smoothstep(inner, inner.add(near.mul(0.20).max(1)), fadeDistance)
        .mul(float(1).sub(smoothstep(mid.mul(0.5), mid, max(d, fadeDistance))));
      keep = keep.add(f.veg.g.mul(0.8).mul(a.heath)).mul(0.85).mul(fade);
    }
    // Heath has no blades: its meadow density is already ~0 there, cards carry it.
    const alive = f.rnd(8).lessThan(keep).select(1, 0);
    const lean = f.lean(a.stiffness);
    const out = f.root;
    // Total bend: the rest lean of the clump plus the wind (fraction of the height the tip moves, quadratic along t).
    const bend = f.restBend.add(lean);
    const leafHeight = companion ? companion.greaterThan(0).select(mix(f.rnd(13).mul(0.38).add(0.45), f.rnd(13).mul(0.25).add(0.3), a.hay), 1) : float(1);
    const hs = a.height.mul(alive).mul(leafHeight);
    // Shared dense blades converge to the thin triangle's straight silhouette before the cell switches.
    const straight = kind === 'dense' ? shared.select(smoothstep(near.mul(0.38), near.mul(0.5), f.cellDist), 0) : float(0);
    const bendAlong = mix(t.mul(t), t, straight);
    const rest = f.restDir.mul(f.restBend.mul(hs).mul(bendAlong));
    const windOff = f.windDir.mul(lean.mul(hs).mul(bendAlong));
    // The root stays inset for contact. Restore that buried length only for short pasture
    // blades so their visible height still reflects the pasture archetype.
    const visibleBase = kind !== 'card' ? a.pasture : inp.sward ? a.pasture.mul(0.65) : float(0);
    const aboveRoot = f.rootInset.mul(visibleBase).mul(alive);
    const lift = t.mul(hs.mul(float(1).sub(bend.mul(bend).mul(0.3))).add(aboveRoot));

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
      // Spread the cutout over the overlap zone. At long range, keep the original stable tuft silhouette.
      const detail = vCardDetail
        ? float(1).sub(smoothstep(mid.mul(0.43), mid.mul(0.75), d)).mul(float(1).sub(a.heath))
        : float(0);
      if (vCardDetail) vCardDetail.assign(detail);
      // At card range the width describes several leaves. Narrow the silhouette where cards overlap individual leaves.
      const widthScale = inp.sward ? mix(0.9, 0.73, detail) : float(1);
      const width = max(a.width, d.mul(MIN_WIDTH_PER_M)).mul(widthScale)
        .mul(mix(2.6, 5.2, detail)).mul(float(1).sub(t.mul(0.9))).mul(alive);
      const reach = float(0.07).mul(alive).add(t.mul(hs).mul(0.3));
      px = out.x.add(outX.mul(reach)).add(outZ.negate().mul(side).mul(width).mul(0.5)).add(rest.x.mul(tuft)).add(windOff.x.mul(tuft));
      py = out.y.add(lift.mul(tuft));
      pz = out.z.add(outZ.mul(reach)).add(outX.mul(side).mul(width).mul(0.5)).add(rest.y.mul(tuft)).add(windOff.y.mul(tuft));
      normal = normalize(mix(f.terrainNormal, vec3(outX, 0.5, outZ), 0.3));
    } else {
      const right = vec3(cos(yaw), 0, sin(yaw));
      const fwd = vec3(sin(yaw).negate(), 0, cos(yaw));
      // Give the dense middle row the thin triangle's exact half-width before the handoff.
      const remaining = float(1).sub(t);
      const taper = mix(inp.sward ? remaining.mul(remaining.mul(0.65).add(0.35))
        : remaining.pow(1.4).mul(0.92).add(0.08), remaining, straight);
      const leafWidth = companion ? companion.greaterThan(0).select(inp.sward ? 0.9 : 1.35, 1) : float(1);
      // Pasture basal leaves spread gently from their rooted centre; longer hay stems remain upright.
      const fan = companion ? companion.greaterThan(0).select(
        float(0.06).mul(a.pasture).mul(t).mul(alive), 0,
      ) : float(0);
      const reach = inp.sward ? hs.mul(f.rnd(10).mul(0.95).add(0.40)).mul(bendAlong) : fan;
      const arch = inp.sward ? hs.mul(t).mul(remaining).mul(float(1).sub(straight)).mul(1.4) : float(0);
      // Limit the screen-space width floor to keep distant blade tips from gaining bulk.
      const widthFloor = inp.sward ? d.mul(0.0011).min(0.014) : d.mul(MIN_WIDTH_PER_M);
      const widthM = max(a.width, widthFloor).mul(taper).mul(alive).mul(leafWidth);
      px = out.x.add(right.x.mul(side).mul(widthM).mul(0.5)).add(rest.x).add(windOff.x).add(fwd.x.mul(reach));
      py = out.y.add(lift).add(arch);
      pz = out.z.add(right.z.mul(side).mul(widthM).mul(0.5)).add(rest.y).add(windOff.y).add(fwd.z.mul(reach));
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
    if (!lite) ground = ground.mul(meadowTint(f.veg.r, u.season.z));
    ground = mix(ground, ground.mul(SILVER), a.tussock.mul(0.7));
    ground = mix(ground, HEATHER.mul(float(1).add(u.season.y)).mul(wetDark), a.heath);
    const tipIntensity = inp.sward ? float(0.46) : float(1);
    const tipLift = mix(vec3(1, 1, 1), vec3(1.14, 1.16, 0.9), smoothstep(0.1, 1, t).mul(tipIntensity));
    let colour = ground.mul(f.variation).mul(tipLift);
    if (inp.sward) {
      // A shallow brightness gradient gives texture without punching dark holes in the lawn.
      const leafShade = mix(vec3(0.89, 0.95, 0.91), vec3(1.05, 1.16, 1.03), smoothstep(0, 0.9, t));
      colour = colour.mul(mix(leafShade, vec3(1, 1, 1), a.heath));
    }
    if (kind !== 'card' && !inp.sward) {
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
  return { position, vColour, vNormal, vHeight, vCardDetail };
}

/** Builds the material of one grass class. `lite` skips the translucency term (low tier). */
export function createGrassMaterial(kind: GrassKind, inp: GrassInputs, u: GrassUniforms, layout: GrassLayout, lite: boolean): MeshLambertNodeMaterial {
  const { position, vColour, vNormal, vHeight, vCardDetail } = buildVertex(kind, inp, u, layout, lite);
  const material = new MeshLambertNodeMaterial({ side: DoubleSide });
  material.name = `grass-${kind}`;
  material.positionNode = position();
  material.colorNode = vColour;
  material.normalNode = transformNormalToView(vNormal);
  if (vCardDetail && inp.cardMask) {
    const uv = varying(vec2(positionGeometry.x.mul(0.5).add(0.5), positionGeometry.y));
    material.opacityNode = mix(1, texture(inp.cardMask, uv).r, vCardDetail);
    material.alphaTest = 0.34;
  }
  if (!lite) {
    // Backlit blades glow: pow(saturate(V . -L), 4), strongest at the tip, tinted by the blade colour. The sun's
    // pre-exposed illuminance over pi is the radiance a fully lit white Lambert surface returns.
    const view = normalize(positionWorld.negate());
    const backlit = pow(saturate(dot(view, u.sunDir.negate())), 4).mul(vHeight);
    material.emissiveNode = vColour.mul(u.sunColour).mul(backlit).mul(TRANSLUCENCY / Math.PI);
  }
  return material;
}
