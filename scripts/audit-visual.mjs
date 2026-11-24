#!/usr/bin/env node
/**
 * Six-camera headless sweep against the production build.
 *
 * For every fixed camera it loads the page, waits for the world to settle and
 * fails on any console error, page error, failed request, blank frame or a
 * sweep whose cameras all look the same. Screenshots and telemetry reports are
 * written to artifacts/visual/ for human review.
 *
 * This proves the build runs in headless Chromium (software GPU). It is NOT a
 * device performance or visual-quality verdict; those need real hardware.
 *
 * Usage: node scripts/audit-visual.mjs [--backend=webgl2|webgpu|both] [--skip-build]
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts', 'visual');
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const backendArg = args.get('backend') ?? 'webgl2';
const backends = backendArg === 'both' ? ['webgl2', 'webgpu'] : [backendArg];
const PORT = Number(args.get('port') ?? 4173);
const BASE = `http://127.0.0.1:${PORT}/world-unbound/`;
const CAMERAS = 6;
const READY_TIMEOUT_MS = 45000;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not answer at ${url}`);
}

/** Decodes the screenshot inside the page and returns simple image statistics. */
async function imageStats(page, pngBuffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 160, 90);
    const { data } = ctx.getImageData(0, 0, 160, 90);
    let sum = 0;
    let sumSq = 0;
    const buckets = new Set();
    const signature = [];
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += luma;
      sumSq += luma * luma;
      buckets.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
      if ((i / 4) % 97 === 0) signature.push(Math.round(luma / 8));
    }
    const n = data.length / 4;
    const mean = sum / n;
    return { mean, stdDev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), colours: buckets.size, signature: signature.join(',') };
  }, pngBuffer.toString('base64'));
}

async function sweep(browser, backend, failures) {
  const results = [];
  for (let cam = 0; cam < CAMERAS; cam++) {
    const label = `${backend}/cam${cam}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    try {
      await page.goto(`${BASE}?cam=${cam}&backend=${backend}&q=low&scale=1&hud=0`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__wu?.ready() === true, null, { timeout: READY_TIMEOUT_MS }).catch(async () => {
        const boot = await page.evaluate(() => document.getElementById('boot')?.textContent ?? '');
        throw new Error(`world not ready after ${READY_TIMEOUT_MS / 1000} s (boot screen: "${boot}")`);
      });
      await page.waitForTimeout(700);
      const report = await page.evaluate(() => window.__wu.report());
      // Preserve the scene report even when a software-GPU screenshot stalls.
      writeFileSync(path.join(outDir, `${backend}-cam${cam}.json`), JSON.stringify(report, null, 2));
      // SwiftShader can take longer than Playwright's default 30 s to read back a frame.
      // Keep screenshot and image-quality validation mandatory; timeout remains finite.
      const png = await page.screenshot({ type: 'png', timeout: 60_000 });
      const stats = await imageStats(page, png);
      writeFileSync(path.join(outDir, `${backend}-cam${cam}.png`), png);
      if (report.backend.active !== backend) problems.push(`asked for ${backend}, got ${report.backend.active} (${report.backend.fallbackReason})`);
      if (stats.stdDev < 4 || stats.colours < 12) problems.push(`frame looks blank (stdDev ${stats.stdDev.toFixed(1)}, ${stats.colours} colours)`);
      if (report.world.chunksLoaded < 20) problems.push(`only ${report.world.chunksLoaded} chunks resident`);
      if (report.world.drawCalls < 2) problems.push(`only ${report.world.drawCalls} draw calls`);
      results.push({ label, stats, report });
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${label} ${report.camera.name}: ${report.world.chunksLoaded} chunks, `
        + `${report.world.drawCalls} draws, ${report.frames.fps} fps, stdDev ${stats.stdDev.toFixed(1)}, ${stats.colours} colours`);
    } catch (err) {
      problems.push(`exception: ${err.message}`);
      console.log(`FAIL ${label}: ${err.message}`);
    }
    for (const p of problems) failures.push(`${label}: ${p}`);
    await context.close();
  }
  if (results.length === CAMERAS && new Set(results.map((r) => r.stats.signature)).size < CAMERAS) {
    failures.push(`${backend}: two or more cameras produced the same image`);
  }
}

/**
 * Degradation checks on one camera:
 *  - asking for WebGPU must end in a running app, either on WebGPU or on the
 *    WebGL2 fallback with a stated reason (never a frozen loading screen);
 *  - a simulated device loss must be survived with frames still advancing.
 */
async function resilience(browser, failures) {
  const context = await browser.newContext({ viewport: { width: 960, height: 442 } });
  const page = await context.newPage();
  const ready = () => page.waitForFunction(() => window.__wu?.ready() === true, null, { timeout: READY_TIMEOUT_MS });
  try {
    await page.goto(`${BASE}?cam=5&backend=webgpu&q=low&scale=1&hud=0`, { waitUntil: 'load' });
    await ready();
    const first = await page.evaluate(() => window.__wu.report());
    const flagged = first.backend.active === 'webgl2' && typeof first.backend.fallbackReason === 'string';
    if (first.backend.active !== 'webgpu' && !flagged) failures.push('resilience: WebGPU request ended in an unflagged state');
    console.log(`ok   resilience/webgpu-request -> ${first.backend.active}${flagged ? ` (fallback: ${first.backend.fallbackReason})` : ''}`);

    await page.goto(`${BASE}?cam=1&backend=webgl2&q=low&scale=1&hud=0`, { waitUntil: 'load' });
    await ready();
    await page.evaluate(() => window.__wu.simulateDeviceLost());
    const before = (await page.evaluate(() => window.__wu.report())).frames.total;
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__wu.report());
    if (after.backend.deviceLostCount !== 1) failures.push(`resilience: deviceLostCount is ${after.backend.deviceLostCount}, expected 1`);
    if (after.frames.total <= before) failures.push('resilience: no frames rendered after device-loss recovery');
    if (after.world.drawCalls < 2) failures.push('resilience: scene not drawn after device-loss recovery');
    console.log(`ok   resilience/device-loss -> ${after.backend.active}, ${after.frames.total - before} frames in 1.5 s, ${after.world.drawCalls} draws`);
  } catch (err) {
    failures.push(`resilience: ${err.message}`);
    console.log(`FAIL resilience: ${err.message}`);
  }
  await context.close();
}

/**
 * Engine spike smoke test (ADR-0002 §8): both engines must start, render and
 * report on the Lite (WebGL2) path, with no script or data fetched from
 * another origin. Timings here are software-GPU noise and are not checked.
 */
async function spikeSmoke(browser, failures) {
  for (const engine of ['three', 'three-bundle', 'babylon']) {
    const context = await browser.newContext({ viewport: { width: 960, height: 442 } });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
    try {
      await page.goto(`${BASE}spike/engines.html?engine=${engine}&backend=webgl2&warmup=2&seconds=3`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__spikeResult, null, { timeout: READY_TIMEOUT_MS });
      const r = await page.evaluate(() => window.__spikeResult);
      if (r.error) problems.push(`run failed: ${r.error}`);
      else {
        // Software-GPU frame rates vary widely, so only require that measurement happened.
        if (r.frames < 1 || r.drawCallsMean < 100) problems.push(`no real frames measured (${r.frames} frames, ${r.drawCallsMean} draws)`);
        if (r.scene.chunks < 500) problems.push(`only ${r.scene.chunks} chunks`);
        if (r.crossOriginRequests.length > 0) problems.push(`cross-origin requests: ${r.crossOriginRequests.join(', ')}`);
      }
      console.log(`${problems.length ? 'FAIL' : 'ok  '} spike/${engine}: ${r.error ? r.error : `${r.frames} frames, ${r.scene.chunks} chunks, ${r.drawCallsMean.toFixed(0)} draws`}`);
    } catch (err) {
      problems.push(`exception: ${err.message}`);
      console.log(`FAIL spike/${engine}: ${err.message}`);
    }
    for (const problem of problems) failures.push(`spike/${engine}: ${problem}`);
    await context.close();
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  if (!args.has('skip-build')) {
    const build = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  // Run Vite's own entry so server.kill() reaches the real process (npx would leave it orphaned).
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const failures = [];
  let browser;
  try {
    await waitForServer(BASE, 20000);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'],
    });
    for (const backend of backends) await sweep(browser, backend, failures);
    await resilience(browser, failures);
    await spikeSmoke(browser, failures);
  } finally {
    await browser?.close();
    server.kill();
  }
  if (failures.length > 0) {
    console.error(`\nvisual audit FAILED (${failures.length})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nvisual audit PASS: ${backends.join(', ')} x ${CAMERAS} cameras; screenshots in artifacts/visual/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
