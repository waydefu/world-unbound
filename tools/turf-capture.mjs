/** Capture one production frame per deterministic turf camera, then suspend the software render loop. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [dir = 'out/turf', backend = 'webgl2', ...sites] = process.argv.slice(2);
const origin = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
const width = Number(process.env.WU_TURF_WIDTH ?? 640);
const height = Number(process.env.WU_TURF_HEIGHT ?? Math.round(width * 9 / 16));
const views = process.env.WU_TURF_VIEWS?.split(',') ?? ['close', 'standing', 'raised'];
const variant = process.env.WU_TURF_COMPARE;
const references = variant === 'trial' ? [false] : variant === 'reference' ? [true] : [true, false];
const stats = process.env.WU_TURF_STATS === '1';
const ribbonLod = process.env.WU_TURF_LOD;
const trial = process.env.WU_TURF_TRIAL;
const ribbon = process.env.WU_TURF_RIBBON;
const minFrames = Number(process.env.WU_TURF_FRAMES ?? 1);
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (backend === 'webgpu') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.WU_CHROMIUM, args });
try {
  for (const site of sites.length ? sites : ['slope', 'lowland', 'highland']) {
    for (const view of views) for (const reference of references) {
      const name = [reference ? 'reference' : 'trial', site, view, backend].join('-');
      const page = await browser.newPage({ viewport: { width, height } });
      const problems = [];
      page.on('pageerror', error => problems.push(error.message));
      page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
      await page.addInitScript(({ waitForCounts, minFrames }) => {
        const next = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => next(function tick(time) {
          if (window.__turfFrame) return;
          callback(time);
          if (!window.__wu?.ready()) return;
          const report = window.__wu.report();
          if (report.frames.total < minFrames || (waitForCounts && report.world.grass.worldTurf?.submittedCrowns === null)) return;
          window.__turfFrame = document.querySelector('#viewport-root canvas').toDataURL('image/png');
        });
      }, { waitForCounts: stats, minFrames });
      const url = new URL(origin);
      url.search = new URLSearchParams({
        backend, q: 'med', cam: '6', hud: '0', hour: '13', wx: 'clear', scale: '1', sward: 'world',
        turfSite: site, turfView: view, turfReference: reference ? '1' : '0',
        turfStats: stats ? '1' : '0',
      });
      if (ribbonLod && !reference) url.searchParams.set('turfLod', ribbonLod);
      if (trial && !reference) url.searchParams.set('turfTrial', trial);
      if (ribbon && !reference) url.searchParams.set('turfRibbon', ribbon);
      await page.goto(url.href);
      await page.waitForFunction(() => window.__turfFrame || document.querySelector('#boot-message')?.textContent.startsWith('Could not start'), null, { timeout: 220_000, polling: 250 });
      const { png, report } = await page.evaluate(() => ({ png: window.__turfFrame, report: window.__wu?.report() }));
      assert(png, await page.locator('#boot-message').textContent());
      assert.equal(report.backend.active, backend);
      assert.equal(report.world.grass.worldTurf.reference, reference);
      assert.equal(report.world.grass.worldTurf.overflow, false);
      if (ribbonLod && !reference) assert.equal(report.world.grass.worldTurf.ribbonLod?.rangeM, Number(ribbonLod));
      if (trial && !reference) assert.equal(report.world.grass.worldTurf.trial?.mode, trial);
      if (ribbon && !reference) {
        assert.equal(report.params.turfRibbon, ribbon);
        assert.equal(report.world.grass.worldTurf.ribbonLod?.mode, backend === 'webgl2' ? 'trim' : ribbon);
      }
      assert.deepEqual(problems, []);
      await writeFile(join(dir, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
      await writeFile(join(dir, name + '.json'), JSON.stringify(report, null, 2));
      console.log(name, JSON.stringify(report.world.grass.worldTurf));
      await page.close();
    }
  }
} finally {
  await browser.close();
}
