// Headless renders for visual review (WebGL2 on SwiftShader; WebGPU needs a real GPU).
// Usage: npm run build && npx vite preview --port 4174 &
//        node tools/render.mjs [outDir=out/renders] "name|query" ...
//   e.g. node tools/render.mjs out/renders "cam5|cam=5" "cam2-med|cam=2&q=med"
// Defaults: 1280x720, q=high, hud=0, scale=1; a query can override them. Base URL: WU_BASE (default http://127.0.0.1:4174/world-unbound/).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [outDir = 'out/renders', ...jobs] = process.argv.slice(2);
const base = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const job of jobs) {
  const [name, query = ''] = job.split('|');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(name, 'pageerror', String(e).slice(0, 300)));
  await page.goto(`${base}?backend=webgl2&hud=0&q=high&scale=1&${query}`);
  await page.waitForFunction(() => window.__wu?.ready(), null, { timeout: 280000 }).catch(() => console.log(name, 'NOT READY'));
  await page.waitForTimeout(2500);
  const world = await page.evaluate(() => window.__wu.report().world);
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 120000 });
  console.log('saved', name, JSON.stringify({ mode: world.terrainMode, nodes: world.nodes, draws: world.drawCalls, readyMs: world.readyMs }));
  await page.close();
}
await browser.close();
