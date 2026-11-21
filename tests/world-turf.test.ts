import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TURF_SITES } from '../src/app/cameras';
import { parseParams } from '../src/app/params';
import { CROWN_VERTICES, decodeTurfCanopy, decodeTurfMaster, MASTER_HEIGHT, MASTER_WIDTH, turfMasterOrigins } from '../src/render/worldTurfAssets';
import { worldTurfGeometry } from '../src/render/worldTurfMesh';
import { graphicsUrl } from '../src/ui/graphics';
import { heightAt } from '../src/world/heightField';
import { SOD_CROWNS_PER_M2, SOD_LEAVES_PER_M2 } from '../src/world/sodRoots';
import { buildTerrainTextures } from '../src/world/terrainTextures';
import { collectTurfMasterReference, collectTurfRoots, turfEligible } from '../src/world/turfPopulation';

const asset = (name: string): Uint8Array => readFileSync(fileURLToPath(new URL(`../assets/grass/${name}.bin`, import.meta.url)));
const asBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
async function readMaster() {
  const stream = new Blob([asBuffer(asset('sod-world-master'))]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return { pages: decodeTurfMaster(buffer), origins: turfMasterOrigins(buffer) };
}

type Point = readonly [number, number];
function clip(poly: readonly Point[], axis: 0 | 1, line: number, sign: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aInside = sign * (a[axis] - line) >= 0;
    const bInside = sign * (b[axis] - line) >= 0;
    if (aInside) out.push(a);
    if (aInside !== bInside) {
      const t = (line - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

function areaInside(x: number, z: number, endZ: number): number {
  let result = 0;
  for (let iz = Math.floor(z / 2) * 2; iz < endZ; iz += 2) for (let ix = Math.floor(x / 2) * 2; ix < x + 1; ix += 2) {
    const a = heightAt(ix, iz), b = heightAt(ix + 2, iz), c = heightAt(ix, iz + 2), d = heightAt(ix + 2, iz + 2);
    const triangles: readonly { points: Point[]; slope: number }[] = [
      { points: [[ix, iz], [ix + 2, iz], [ix, iz + 2]], slope: Math.hypot(1, (b - a) / 2, (c - a) / 2) },
      { points: [[ix + 2, iz + 2], [ix, iz + 2], [ix + 2, iz]], slope: Math.hypot(1, (c - d) / 2, (b - d) / 2) },
    ];
    for (const { points, slope } of triangles) {
      const cut = clip(clip(clip(clip(points, 0, x, 1), 0, x + 1, -1), 1, z, 1), 1, endZ, -1);
      for (let i = 0; i < cut.length; i++) {
        const b = cut[(i + 1) % cut.length];
        result += (cut[i][0] * b[1] - b[0] * cut[i][1]) * .5 * slope;
      }
    }
  }
  return result;
}

describe('world turf', () => {
  it('keeps the entire master and three directional depth layers', async () => {
    const { pages: master } = await readMaster();
    expect(master).toHaveLength(3);
    expect(master[0].image.width * master[0].image.height).toBeGreaterThanOrEqual(SOD_CROWNS_PER_M2 * CROWN_VERTICES);
    expect(master[0].image.width).toBe(MASTER_WIDTH);
    expect(master[0].image.height).toBe(MASTER_HEIGHT);
    expect(decodeTurfCanopy(asBuffer(asset('sod-world-canopy'))).every(texture => texture.generateMipmaps)).toBe(true);
    expect(worldTurfGeometry().index?.count).toBe(9 * 22 * 3);
  });

  it('preserves the scene in the graphics menu and keeps world turf opt-in', () => {
    const source = 'https://example.com/world-unbound/?cam=6&wx=rain&hour=17&scale=0.75&sward=world&backend=webgl2';
    const next = graphicsUrl(source, 5, 'med', '0.75');
    expect(parseParams(next.search)).toMatchObject({ cam: 5, worldTurf: true, quality: 'med', scale: .75, weather: 'rain', backend: 'webgl2' });
    expect(parseParams(graphicsUrl(next.href, 5, 'auto', 'auto').search)).toMatchObject({ quality: null, scale: null });
    for (const query of ['', '?sward=baseline', '?sward=world&sod=full', '?sward=world&grass=0', '?sward=world&terrain=chunks']) {
      expect(parseParams(query).worldTurf).toBe(false);
    }
    expect(parseParams('?sward=world&turfBench=all&turfReference=1&q=low'))
      .toMatchObject({ turfBench: 'all', turfReference: false, quality: 'med' });
    expect(parseParams('?sward=world&turfBench=0').turfBench).toBe(0);
    expect(parseParams('?sward=world&turfBench=65').turfBench).toBeNull();
    expect(parseParams('?sward=baseline&turfBench=all').turfBench).toBeNull();
    expect(parseParams('?sward=world&turfLod=30&turfView=wide')).toMatchObject({ turfLod: 30, turfView: 'wide' });
    expect(parseParams('?sward=world&turfLod=20').turfLod).toBe(20);
    expect(parseParams('?sward=world&turfLod=30&turfBench=all').turfLod).toBeNull();
    expect(parseParams('?sward=world&turfLod=30&turfReference=1').turfLod).toBeNull();
  });

  it('counts native blade roots in 256 actual one-square-metre terrain windows', async () => {
    const terrain = buildTerrainTextures(1);
    const { pages: assets, origins } = await readMaster();
    const lo = assets[0].image.data as Uint8Array, hi = assets[1].image.data as Uint8Array;
    const roots = new Float32Array(200_000 * 4);
    const origin = TURF_SITES.slope;
    expect(collectTurfMasterReference(terrain, origin, origins, roots)).toBe(SOD_CROWNS_PER_M2 * 16);
    expect(roots[0]).toBeCloseTo(origin.x - 1.5 + origins[0], 4);
    const uv = new Float64Array(2);
    const sites = Object.values(TURF_SITES);
    const results: { x: number; z: number; min: number; max: number }[] = [];
    for (const site of sites) {
      const { x, z } = site;
      expect(turfEligible(terrain, x, z)).toBe(true);
      const bounds = { x, z, y: heightAt(x, z), reach: 0, reference: site };
      const count = collectTurfRoots(terrain, bounds, roots, uv);
      expect(count).toBeGreaterThan(100_000);
      expect(collectTurfRoots(terrain, bounds, new Float32Array(16), uv)).toBe(-1);
      const bins = Array.from({ length: 32 ** 2 }, () => [] as number[]);
      for (let crown = 0; crown < count; crown++) {
        const base = crown * 4;
        const variant = Math.floor(roots[base + 3]);
        for (let blade = 0; blade < 9; blade++) {
          const root = (variant * CROWN_VERTICES + blade * 19 + 1) * 4;
          const ox = (lo[root] + hi[root] * 256) * .32 / 65535 - .16;
          const oz = (lo[root + 2] + hi[root + 2] * 256) * .32 / 65535 - .16;
          const wx = roots[base] + ox, wz = roots[base + 2] + oz;
          const ix = Math.floor((wx - x + 2) * 8), iz = Math.floor((wz - z + 2) * 8);
          if (ix >= 0 && ix < 32 && iz >= 0 && iz < 32) bins[iz * 32 + ix].push(wx, wz);
        }
      }
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 64; i++) {
        const startX = site === TURF_SITES.seam ? x - .95 + ((i * 37) % 64) / 64 * .85 : x - 1.38 + ((i * 37) % 64) / 64 * 1.70;
        const startZ = z - 1.38 + ((i * 19 + 11) % 64) / 64 * 1.70;
        let lowest = startZ, highest = startZ + 1;
        for (let j = 0; j < 18; j++) {
          const middle = (lowest + highest) / 2;
          if (areaInside(startX, startZ, middle) < 1) lowest = middle;
          else highest = middle;
        }
        const maxZ = (lowest + highest) / 2;
        expect(areaInside(startX, startZ, maxZ)).toBeCloseTo(1, 5);
        let blades = 0;
        for (let iz = Math.floor((startZ - z + 2) * 8); iz <= Math.floor((maxZ - z + 2) * 8); iz++) {
          for (let ix = Math.floor((startX - x + 2) * 8); ix <= Math.floor((startX + 1 - x + 2) * 8); ix++) {
            const bin = bins[iz * 32 + ix];
            for (let j = 0; j < bin.length; j += 2) {
              if (bin[j] >= startX && bin[j] < startX + 1 && bin[j + 1] >= startZ && bin[j + 1] < maxZ) blades++;
            }
          }
        }
        min = Math.min(min, blades);
        max = Math.max(max, blades);
      }
      results.push({ x, z, min, max });
    }
    console.log('World turf density ranges over 256 one-square-metre windows', JSON.stringify(results));
    for (const r of results) {
      expect(r.min, JSON.stringify(r)).toBeGreaterThanOrEqual(SOD_LEAVES_PER_M2 * .98);
      expect(r.max, JSON.stringify(r)).toBeLessThanOrEqual(SOD_LEAVES_PER_M2 * 1.02);
    }
  }, 30000);
});
