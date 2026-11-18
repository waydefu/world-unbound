import type { DirectionalLight } from 'three/webgpu';
import type { FrustumSource } from './chunkStats';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';

/** Cascaded sun shadows (G1.2). Budgeted from the phone GPU ramp: about 1.5-3 ms for three cascades. */
export interface ShadowSettings {
  readonly cascades: number;
  readonly mapSize: number;
  /** Distance (m) covered by the cascades; beyond it terrain is unshadowed and fog takes over. */
  readonly maxFar: number;
}

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

const NO_CASCADES: readonly FrustumSource[] = [];

/**
 * The per-cascade light cameras of the sun's CSM shadow (empty until the first render has built them, or
 * when shadows are off). Their matrices are those of the last rendered frame.
 */
export function cascadeCameras(sun: DirectionalLight): readonly FrustumSource[] {
  const node = sun.shadow.shadowNode as unknown as { lights?: Array<{ shadow: { camera: FrustumSource } }> } | null;
  const lights = node?.lights;
  if (!lights || lights.length === 0) return NO_CASCADES;
  return lights.map((l) => l.shadow.camera);
}
