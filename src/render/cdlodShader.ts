import type { DataTexture, Node, UniformNode, Vector3 } from 'three/webgpu';
import {
  Fn, attribute, clamp, exp2, float, floor, fract, ivec2, length, mix, normalize, positionGeometry, texture, varyingProperty, vec3,
} from 'three/tsl';
import { PATCH } from '../world/cdlodPyramid';
import { WORLD_MIN } from '../world/constants';
import { HEIGHT_DIM } from '../world/terrainTextures';

/**
 * Vertex stage of the CDLOD terrain (ADR-0003, spec G2.0 phase C). Every node is the same 33 x 33 vertex
 * patch (`positionGeometry.xz` = uv in [0, 1]); the instance attributes say where it goes:
 *  - `nodeInfo`: (origin x, origin z, size, level) in world metres;
 *  - `nodeEdge`: packed neighbour relations, north + 3 east + 9 south + 27 west, each 0 same level,
 *    1 neighbour one level coarser, 2 one level finer (world/cdlod.ts).
 * Heights come from the R32F height texture by texel fetch (never filtered), one texel per 2 m lattice point.
 *
 * Morphing (Strugar): odd grid vertices slide towards the even vertex below them as the camera distance goes
 * from the level's morph start to its range, so a level hands over to its parent without a pop. Where a
 * neighbour differs in level, the shared edge is forced instead: vertices next to a coarser neighbour sit on
 * its grid (k = 1), vertices next to a finer one stay put (k = 0), which closes every T-junction exactly.
 */
const LAST_TEXEL = HEIGHT_DIM - 1;

export interface CdlodShaders {
  /** Main-pass local position (absolute world x, y, z); also writes the normal varying. */
  readonly position: Node<'vec3'>;
  /** Shadow-pass position: same surface, no normal. */
  readonly shadowPosition: Node<'vec3'>;
  /** World-space unit-ish normal of the morphed surface (interpolated; normalise in the fragment stage). */
  readonly normal: Node<'vec3'>;
}

export function createCdlodShaders(heightTexture: DataTexture, eye: UniformNode<'vec3', Vector3>, lod0: UniformNode<'float', number>): CdlodShaders {
  const heights = texture(heightTexture);
  const vNormal = varyingProperty('vec3', 'cdlodNormal');
  const load = (x: Node<'float'>, z: Node<'float'>): Node<'float'> =>
    heights.load(ivec2(clamp(x, 0, LAST_TEXEL).toInt(), clamp(z, 0, LAST_TEXEL).toInt())).r;

  const build = (withNormal: boolean): Node<'vec3'> => Fn(() => {
    const info = attribute('nodeInfo', 'vec4');
    const code = attribute('nodeEdge', 'float');
    const uv = positionGeometry.xz;
    const size = info.z;
    const level = info.w;
    const gx = info.x.add(uv.x.mul(size));
    const gz = info.y.add(uv.y.mul(size));
    // Lattice position (exact integers for unmorphed vertices) and texels between the vertices of this level.
    const ix = gx.sub(WORLD_MIN).mul(0.5);
    const iz = gz.sub(WORLD_MIN).mul(0.5);
    const quad = size.div(2 * PATCH);
    // 1 on odd grid indices (the vertices that morph), 0 on even ones.
    const odd = fract(uv.mul(PATCH / 2)).mul(2);

    const hP = load(ix, iz).toVar();
    const dist = length(vec3(gx.sub(eye.x), hP.sub(eye.y), gz.sub(eye.z)));
    const range = lod0.mul(exp2(level));
    const start = range.mul(level.greaterThan(0.5).select(0.85, 0.7));
    // The root has no parent to morph to.
    const k = clamp(dist.sub(start).div(range.sub(start)), 0, 1).mul(level.lessThan(5.5).select(1, 0)).toVar();

    // Edge stitching: a vertex on an edge next to a coarser node takes the coarser grid, next to a finer one it stays.
    const eN = code.mod(3);
    const eE = floor(code.div(3)).mod(3);
    const eS = floor(code.div(9)).mod(3);
    const eW = floor(code.div(27));
    const onN = uv.y.lessThan(0.001);
    const onS = uv.y.greaterThan(0.999);
    const onW = uv.x.lessThan(0.001);
    const onE = uv.x.greaterThan(0.999);
    const coarse = onN.and(eN.equal(1)).or(onE.and(eE.equal(1))).or(onS.and(eS.equal(1))).or(onW.and(eW.equal(1)));
    const fine = onN.and(eN.equal(2)).or(onE.and(eE.equal(2))).or(onS.and(eS.equal(2))).or(onW.and(eW.equal(2)));
    k.assign(coarse.select(float(1), k));
    k.assign(fine.select(float(0), k));

    const shift = odd.mul(k);
    const px = gx.sub(shift.x.mul(size.div(PATCH)));
    const pz = gz.sub(shift.y.mul(size.div(PATCH)));
    // The vertex slides to its lower-index even neighbour: height is the lerp of the two endpoint texels.
    const hQ = load(ix.sub(odd.x.mul(quad)), iz.sub(odd.y.mul(quad)));
    const y = mix(hP, hQ, k);

    if (withNormal) {
      // Central differences on the lattice at the vertex's own spacing, blended towards the parent's spacing
      // with k so the shading is continuous across the morph and at node borders.
      const mx = floor(ix.sub(shift.x.mul(quad)).add(0.5));
      const mz = floor(iz.sub(shift.y.mul(quad)).add(0.5));
      const stencil = (w: Node<'float'>): Node<'vec3'> => {
        const dx = load(mx.add(w), mz).sub(load(mx.sub(w), mz));
        const dz = load(mx, mz.add(w)).sub(load(mx, mz.sub(w)));
        const inv = float(1).div(w.mul(4)); // 1 / (2 w texels x 2 m)
        return normalize(vec3(dx.mul(inv).negate(), 1, dz.mul(inv).negate()));
      };
      vNormal.assign(normalize(mix(stencil(quad), stencil(quad.mul(2)), k)));
    }
    return vec3(px, y, pz);
  })();

  return { position: build(true), shadowPosition: build(false), normal: vNormal };
}
