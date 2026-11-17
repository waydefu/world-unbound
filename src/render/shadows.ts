import type { DirectionalLight } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { ShadowSettings } from '../app/quality';

/**
 * Cascaded shadow maps for the sun (G1.2). Practical split scheme (blend of
 * uniform and logarithmic) so near terrain gets the texels; cascades blend at
 * their seams. The light margin covers terrain relief behind the view.
 *
 * Returns the depth-map memory in bytes for the memory registry.
 */
export function attachSunShadows(sun: DirectionalLight, settings: ShadowSettings): number {
  sun.castShadow = true;
  const shadow = sun.shadow;
  shadow.mapSize.set(settings.mapSize, settings.mapSize);
  shadow.camera.near = 1;
  shadow.camera.far = 4000;
  // Terrain is the only caster so far: a small depth bias plus a normal offset
  // keeps grazing light free of acne without detaching contact shadows.
  shadow.bias = -0.0004;
  shadow.normalBias = 0.6;
  const csm = new CSMShadowNode(sun, {
    cascades: settings.cascades,
    maxFar: settings.maxFar,
    mode: 'practical',
    lightMargin: 600,
  });
  csm.fade = true;
  shadow.shadowNode = csm;
  // 32-bit depth per texel, one map per cascade.
  return settings.cascades * settings.mapSize * settings.mapSize * 4;
}
