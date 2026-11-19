// Phone-size HUD screenshot (390x844 @2x). Usage: node tools/hud-shot.mjs [out=out/hud.png] [query=cam=5&q=med]
import { chromium } from 'playwright';

const [out = 'out/hud.png', query = 'cam=5&q=med'] = process.argv.slice(2);
const base = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${base}?backend=webgl2&scale=1&hud=1&${query}`);
await page.waitForFunction(() => window.__wu?.ready() === true, null, { timeout: 200000 }).catch(() => console.log('not ready'));
await page.waitForTimeout(4000);
await page.screenshot({ path: out, timeout: 120000 });
console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)));
await browser.close();
