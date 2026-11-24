import { type DataTexture, DoubleSide, MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import {
  cos, Fn, mix, normalize, positionGeometry, sin, smoothstep, transformNormalToView,
  varyingProperty, vec2, vec3,
} from 'three/tsl';
import { grassCarpetColour } from './grassPalette';
import { grassGust, type GrassWindUniforms } from './grassWind';
import { terrainHeightNode } from './terrainHeightNode';
import type { WorldTurf } from './worldTurf';

/**
 * Quality-first opaque leaf surface. Inspired by the independent procedural
 * vertex construction used by Abyssal Garden, but implemented for the existing
 * Three.js/TSL renderer and the Hellesylt ground/wind data contract.
 *
 * Important: each proxy strip represents distant volume; it does NOT replace
 * the fully authored, near-camera 79,524-leaf-per-m² master.
 */
export function createTurfCurvedMaterial(root: Node<'vec4'>, height: DataTexture,
  native: WorldTurf, wind: GrassWindUniforms, range: number, proxy: boolean): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({
    side: DoubleSide, roughness: .78, specularIntensity: .13,
    transparent: false, depthWrite: true, alphaTest: 0, forceSinglePass: true,
  });
  const terrain = terrainHeightNode(height);
  const normal = varyingProperty('vec3', 'turfCurvedNormal');
  const leafV = varyingProperty('float', 'turfCurvedHeight');
  material.positionNode = Fn(() => {
    const side = positionGeometry.x;
    const v = positionGeometry.y;
    const blade = positionGeometry.z;
    // Separate deterministic azimuths per leaf without allocating blade data on CPU.
    const angle = root.w.mul(6.2831853).add(blade.mul(2.3999632));
    const along = vec2(cos(angle), sin(angle));
    const across = vec2(along.y.negate(), along.x);
    const lengthM = sin(root.w.mul(19.7).add(blade.mul(1.91))).mul(.012).add(.092)
      .mul(blade.mul(-.075).add(1));
    const h = v.mul(lengthM);
    const bend = h.mul(h).mul(mix(2.6, 4.8, root.w));
    const gust = grassGust(root.xz, root.w.add(blade.mul(.173)), wind);
    const sway = wind.wind.xy.mul(h.mul(h).mul(gust.mul(1.7).add(.2)).mul(wind.wind.z.min(8)));
    const anchor = root.xz.add(along.mul(blade.mul(.007).add(.006)));
    const twist = v.mul(2.1).add(root.w.mul(5.1)).add(blade.mul(.41));
    const bladeSide = across.mul(cos(twist)).add(along.mul(sin(twist)));
    // Rounded lens and an exact zero-width tip: physical silhouette, no alpha texture.
    const leafWidth = sin(v.mul(3.14159265)).max(0).pow(.65)
      .mul(mix(.010, .016, root.w)).mul(mix(.72, 1.15, blade.div(3)));
    const distance = root.xyz.sub(native.eye).length().max(.01);
    const near = proxy ? smoothstep(native.detailReach.x, native.detailReach.y, distance) : smoothstep(10, 13, distance);
    const far = smoothstep(range * .84, range, distance).oneMinus();
    const lateral = bladeSide.mul(side.mul(leafWidth).mul(near).mul(far));
    const centre = anchor.add(along.mul(bend)).add(sway).add(lateral);
    const base = terrain.withNormal(anchor);
    // Normal follows curvature and twist; doesn't just reuse terrain normal.
    normal.assign(normalize(vec3(
      along.x.mul(.78).add(bladeSide.x.mul(side.mul(.21))),
      v.mul(.42).add(.17),
      along.y.mul(.78).add(bladeSide.y.mul(side.mul(.21))),
    ).add(base.normal.mul(.18))));
    leafV.assign(v);
    return vec3(centre.x, base.y.add(h).sub(.002), centre.y);
  })();
  material.normalNode = transformNormalToView(normal);
  material.colorNode = grassCarpetColour(native.season)
    .mul(mix(.56, 1.16, smoothstep(0, .92, leafV)))
    .mul(mix(.82, 1.16, root.w));
  material.aoNode = mix(.48, .96, smoothstep(0, .75, leafV));
  material.roughnessNode = mix(.91, .68, leafV);
  return material;
}
