import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three/webgpu';
import { TURF_SITES } from '../src/app/cameras';
import { decodeTurfMaster, LEAF_VERTICES } from '../src/render/worldTurfAssets';
import { heightAt } from '../src/world/heightField';
import { SOD_LEAVES_PER_M2, SOD_ROOT_INSET_M } from '../src/world/sodRoots';

it('measures low master tips that cross a local terrain plane when only the root is raised', async () => {
  const bytes = readFileSync(new URL('../assets/grass/sod-world-master.bin', import.meta.url));
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const tables = decodeTurfMaster(await new Response(stream).arrayBuffer());
  const low = tables[0].image.data as Uint8Array, high = tables[1].image.data as Uint8Array;
  const component = (vertex: number, lane: number) => (low[vertex * 4 + lane] + high[vertex * 4 + lane] * 256) * .32 / 65535;
  const up = new Vector3(0, 1, 0), tip = new Vector3();
  let recoverable = 0;
  for (const [site, { x, z }] of Object.entries(TURF_SITES)) {
    const h = heightAt(x, z);
    const normal = new Vector3((h - heightAt(x + 2, z)) * .5, 1, (h - heightAt(x, z + 2)) * .5).normalize();
    const frame = new Quaternion().setFromUnitVectors(up, normal);
    let buried = 0, restored = 0;
    for (let blade = 0; blade < SOD_LEAVES_PER_M2; blade++) {
      const foot = blade * LEAF_VERTICES + 1, end = foot + LEAF_VERTICES - 2;
      tip.set(component(end, 0) - component(foot, 0), component(end, 1) - component(foot, 1), component(end, 2) - component(foot, 2));
      const inset = normal.y * SOD_ROOT_INSET_M;
      if (tip.dot(normal) < inset && tip.y > inset) {
        buried++;
        if (tip.applyQuaternion(frame).dot(normal) > inset) restored++;
      }
    }
    expect(restored).toBe(buried);
    recoverable += restored;
    console.log('Master tip clearance on local terrain plane', { site, tested: SOD_LEAVES_PER_M2, buried, restored });
  }
  expect(recoverable).toBeGreaterThan(0);
  for (const table of tables) table.dispose();
});
