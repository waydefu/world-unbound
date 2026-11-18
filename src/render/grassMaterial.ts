import { DoubleSide, MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn, attribute, cos, dot, float, mix, normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, step,
  transformNormalToView, varyingProperty, vec3,
} from 'three/tsl';
import { grassField, type GrassField, type GrassInputs, type GrassUniforms } from './grassField';
import { groundCover } from './grassPalette';

/**
 * Grass materials (spec G2.1 phase C): three Lambert node materials whose vertex stage builds every blade (or
 * card) from (cell, index) with `grassField`. Lambert because blades are thin and many: diffuse sun and
 * hemisphere light with the CSM shadows, no specular. The translucency of a backlit blade is added as emission.
 *
 *  - dense:  3-segment blades near the eye; density thins out with distance, height fades to 0 at the ring edge;
 *  - thin:   wider one-segment blades from half the ring to its edge;
 *  - card:   tufts of three blades, fading in over the blade ring's edge and out at the mid limit.
 */
export type GrassKind = 'dense' | 'thin' | 'card';

const BUTTERCUP = vec3(0.62, 0.44, 0.03);
const CLOVER = vec3(0.56, 0.55, 0.5);
const SEED_HEAD = vec3(0.36, 0.31, 0.14);
/** Share of a leaf's diffuse light transmitted when the sun is behind it. */
const TRANSLUCENCY = 0.5;
const TWO_PI = 2 * Math.PI;
/** Random-stream salts so blades and cards sharing a cell do not repeat each other. */
const SALT = { dense: 0, thin: 0, card: 7919 } as const;

function buildVertex(kind: GrassKind, inp: GrassInputs, u: GrassUniforms) {
  const vColour = varyingProperty('vec3', `grassColour_${kind}`);
  const vNormal = varyingProperty('vec3', `grassNormal_${kind}`);
  const vHeight = varyingProperty('float', `grassHeight_${kind}`);
  const position = Fn(() => {
    const f: GrassField = grassField(inp, u, SALT[kind], kind === 'card' ? 0.25 : 0.5);
    const near = u.rings.x;
    const mid = u.rings.y;
    const inner = u.rings.z;
    const side = positionGeometry.x;
    const t = positionGeometry.y;
    const a = f.archetype;
    const d = f.dist;
    const density = f.veg.r;
    const yaw = f.rnd(9).mul(TWO_PI);

    // Size scale (0 = degenerate) and the density gate: a blade whose hash is above the local density collapses.
    let keep: Node<'float'> = density;
    let fade: Node<'float'> = float(1);
    if (kind === 'dense') {
      keep = density.mul(mix(1, 0.3, smoothstep(near.mul(0.25), near.mul(0.55), d)));
      fade = float(1).sub(smoothstep(near.mul(0.82), near, d));
    } else if (kind === 'thin') {
      fade = float(1).sub(smoothstep(near.mul(0.82), near, d));
    } else {
      keep = density.mul(0.85);
      fade = smoothstep(inner, inner.add(near.mul(0.2)), d).mul(float(1).sub(smoothstep(mid.mul(0.8), mid, d)));
    }
    const alive = f.rnd(8).lessThan(keep).select(1, 0);
    const scale = alive.mul(fade);
    const lean = f.lean(a.stiffness);
    const out = f.root;

    const hs = a.height.mul(scale);
    let px = out.x;
    let py = out.y;
    let pz = out.z;
    let normal = f.terrainNormal;
    if (kind === 'card') {
      const part = attribute('part', 'float');
      const psi = yaw.add(part.mul(TWO_PI / 3));
      const outX = cos(psi);
      const outZ = sin(psi);
      const tuft = f.rnd(10).mul(0.6).add(0.7);
      const h = hs.mul(tuft);
      const width = a.width.mul(5).mul(float(1).sub(t.mul(0.9))).mul(scale);
      const reach = float(0.07).mul(scale).add(t.mul(h).mul(0.35));
      const wind = lean.mul(h).mul(t).mul(t);
      px = out.x.add(outX.mul(reach)).add(outZ.negate().mul(side).mul(width).mul(0.5)).add(f.windDir.x.mul(wind));
      py = out.y.add(t.mul(h).mul(float(1).sub(lean.mul(lean).mul(0.3))));
      pz = out.z.add(outZ.mul(reach)).add(outX.mul(side).mul(width).mul(0.5)).add(f.windDir.y.mul(wind));
      normal = normalize(mix(f.terrainNormal, vec3(outX, 0.4, outZ), 0.3));
    } else {
      const right = vec3(cos(yaw), 0, sin(yaw));
      const fwd = vec3(sin(yaw).negate(), 0, cos(yaw));
      const shape = float(1).sub(t.mul(0.85));
      const widthM = a.width.mul(shape).mul(kind === 'thin' ? 2 : 1).mul(scale);
      const curve = f.rnd(10).mul(0.35).add(0.15).mul(t).mul(t).mul(hs);
      const wind = lean.mul(hs).mul(t).mul(t);
      px = out.x.add(right.x.mul(side).mul(widthM).mul(0.5)).add(fwd.x.mul(curve)).add(f.windDir.x.mul(wind));
      py = out.y.add(t.mul(hs).mul(float(1).sub(lean.add(0.3).mul(lean.add(0.3)).mul(0.3))));
      pz = out.z.add(right.z.mul(side).mul(widthM).mul(0.5)).add(fwd.z.mul(curve)).add(f.windDir.y.mul(wind));
      // The blade's own face, turned towards the eye, blended into the terrain normal.
      const towardsEye = fwd.x.mul(u.eye.x.sub(out.x)).add(fwd.z.mul(u.eye.z.sub(out.z)));
      const facing = towardsEye.greaterThan(0).select(float(1), float(-1));
      // Short pasture is lit like the ground (up-facing); tall blades show their sides.
      normal = normalize(mix(f.terrainNormal, fwd.mul(facing), float(0.45).mul(float(1).sub(a.pasture.mul(0.75)))));
    }

    // Colour: the terrain's ground-cover colour at the root, dark at the foot, lighter at the tip.
    // Short pasture has little room for a dark foot; wet weather darkens like the wet terrain (albedo x 0.6 at full wetness).
    const foot = a.pasture.mul(0.3).add(0.55);
    let colour = groundCover(f.macro, f.wet, f.veg, u.season).mul(mix(foot, 1.2, pow(t, 0.8))).mul(mix(1, 0.6, u.wetness));
    if (kind !== 'card') {
      const green = float(1).sub(u.season.z);
      const seeds = a.hay.mul(smoothstep(0.78, 0.9, t)).mul(0.7);
      colour = mix(colour, SEED_HEAD.mul(mix(1, 0.8, u.season.y)), seeds);
      const r = f.rnd(11);
      const tip = smoothstep(0.82, 0.95, t).mul(a.hay).mul(green);
      colour = mix(colour, BUTTERCUP, step(r, 0.03).mul(tip));
      colour = mix(colour, CLOVER, step(0.03, r).mul(step(r, 0.06)).mul(tip));
    }
    vColour.assign(colour);
    vNormal.assign(normal);
    vHeight.assign(t);
    return vec3(px, py, pz);
  });
  return { position, vColour, vNormal, vHeight };
}

/** Builds the material of one grass class. `lite` skips the translucency term (low tier). */
export function createGrassMaterial(kind: GrassKind, inp: GrassInputs, u: GrassUniforms, lite: boolean): MeshLambertNodeMaterial {
  const { position, vColour, vNormal, vHeight } = buildVertex(kind, inp, u);
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
