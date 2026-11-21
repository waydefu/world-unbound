import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [output = 'out/turf-bench', backend = 'webgl2', site = 'slope', view = 'standing', ...radii] = process.argv.slice(2);
const base = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
const width = Number(process.env.WU_TURF_WIDTH ?? 400);
const minFrames = Number(process.env.WU_TURF_FRAMES ?? 12);
const timeout = Number(process.env.WU_TURF_TIMEOUT_MS ?? 90_000);
const stats = process.env.WU_TURF_STATS === '1';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (backend === 'webgpu') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader');

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.WU_CHROMIUM, args });
try {
  for (const radius of radii.length ? radii : ['0', '2', '4', 'all']) {
    const page = await browser.newPage({ viewport: { width, height: Math.round(width * 9 / 16) } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = new URL(base);
    url.search = new URLSearchParams({
      sward: 'world', turfBench: radius, turfStats: stats ? '1' : '0', cam: '6', turfSite: site,
      turfView: view, backend, q: 'med', scale: '1', hud: '0', hour: '13', wx: 'clear',
    });
    let status = 'measured';
    try {
      await page.goto(url.href);
      await page.waitForFunction(({ minFrames, stats }) => {
        if (!window.__wu?.ready()) return false;
        const state = window.__wu.report();
        const turf = state.world.grass.worldTurf;
        return turf?.overflow || (state.frames.total >= minFrames && (!stats || turf?.submittedCrowns !== null));
      }, { minFrames, stats }, { timeout, polling: 200 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      status = 'timeout';
    }
    const report = await page.evaluate(() => window.__wu?.report() ?? null);
    const turf = report?.world.grass.worldTurf ?? null;
    if (turf?.overflow) status = 'buffer-limit';
    if (report) {
      assert.equal(report.backend.active, backend);
      assert.equal(report.viewport.renderScale, 1);
      assert.equal(report.params.turfBench, radius === 'all' ? radius : Number(radius));
    }
    assert.deepEqual(errors, []);
    const record = { url: url.href, status, report };
    await writeFile(join(output, `${backend}-${site}-${view}-${radius}.json`), JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ backend, site, view, radius, status, turf, frames: report?.frames ?? null }));
    await page.close();
  }
} finally {
  await browser.close();
}
