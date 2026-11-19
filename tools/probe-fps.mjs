// Software-rendering frame probe (informational only: SwiftShader is not a GPU; phone telemetry is the evidence).
// Usage: taskset -c 0,1 node tools/probe-fps.mjs [q=med] [extraQuery ...]   (needs `npx vite preview --port 4174`)
import { chromium } from 'playwright';

const [q = 'med', ...extras] = process.argv.slice(2);
const base = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const extra of extras.length ? extras : ['']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`${base}?cam=0&backend=webgl2&q=${q}&scale=1&hud=0${extra}`);
  await page.waitForTimeout(12000);
  const frames = await page.evaluate(() => new Promise((resolve) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else resolve(n); };
    requestAnimationFrame(tick);
  }));
  console.log(`q=${q}${extra}`, 'frames in 5 s:', frames);
  await page.close();
}
await browser.close();
