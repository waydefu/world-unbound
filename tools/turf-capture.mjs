/** Capture one production frame per deterministic turf camera, then suspend the software render loop. */
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [dir = 'out/turf', backend = 'webgl2', ...sites] = process.argv.slice(2);
const origin = process.env.WU_BASE ?? 'http://127.0.0.1:4174/world-unbound/';
const width = Number(process.env.WU_TURF_WIDTH ?? 640);
const height = Number(process.env.WU_TURF_HEIGHT ?? Math.round(width * 9 / 16));
const variant = process.env.WU_TURF_COMPARE;
const views = process.env.WU_TURF_VIEWS?.split(',') ?? [variant === 'stage1' ? 'macro' : 'close', 'standing', 'raised'];
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
  if (variant === 'stage1') await captureStageOne(browser);
  else await captureLegacy(browser);
} finally {
  await browser.close();
}

async function captureLegacy(browser) {
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
        assert.equal(report.world.grass.worldTurf.ribbonLod?.mode, backend === 'webgl2' && ribbon === 'depth' ? 'trim' : ribbon);
      }
      assert.deepEqual(problems, []);
      await writeFile(join(dir, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
      await writeFile(join(dir, name + '.json'), JSON.stringify(report, null, 2));
      console.log(name, JSON.stringify(report.world.grass.worldTurf));
      await page.close();
    }
  }
}

/**
 * Compare production render paths under the same camera, weather and visual time.
 * WU_TURF_COMPARE=stage1 enables this matrix. WU_TURF_VARIANTS and WU_TURF_VIEWS
 * select subsets, and WU_TURF_MOTION_MS=off omits the sampled walk.
 */
async function captureStageOne(browser) {
  const modes = {
    normal: {},
    master: { sward: 'world', turfReference: '1' },
    pr49: { sward: 'world', turfLod: '30', turfTrial: 'canopy', turfRibbon: 'quality' },
    surface: { sward: 'world', turfLod: '30', turfTrial: 'canopy', turfRibbon: 'quality', turfFrame: 'surface' },
  };
  const prior48 = process.env.WU_BASE_48;
  if (prior48) modes.pr48 = { sward: 'world', turfLod: '30', turfTrial: 'canopy' };
  const requestedModes = process.env.WU_TURF_VARIANTS?.split(',') ?? Object.keys(modes);
  assert(requestedModes.every(mode => Object.hasOwn(modes, mode)), 'Unknown Stage 1 comparison mode');
  assert.equal(new Set(requestedModes).size, requestedModes.length, 'Duplicate Stage 1 comparison mode');
  assert(requestedModes.some(mode => mode !== 'pr48'), 'The #48 origin needs a local comparison');
  const orderedModes = [...requestedModes.filter(mode => mode !== 'pr48'), ...requestedModes.filter(mode => mode === 'pr48')];
  const captureMs = Number(process.env.WU_TURF_CAPTURE_MS ?? 0);
  const walkSamples = process.env.WU_TURF_MOTION_MS === 'off' ? [] :
    (process.env.WU_TURF_MOTION_MS ?? '0,1500,3000,4500,6000,7500,9000,10500,12000').split(',').map(Number);
  const validTime = ms => Number.isSafeInteger(ms) && ms >= 0 && ms <= 12_000;
  assert(validTime(captureMs) && walkSamples.every(validTime), 'Stage 1 times must be whole milliseconds from 0 to 12000');
  assert.equal(new Set(walkSamples).size, walkSamples.length, 'Duplicate Stage 1 walk timestamp');
  // Centers from TURF_SITES. The full master covers a fixed 4×4 m patch at each site.
  const referenceCenters = { lowland: [684, 444], slope: [20, -40], highland: [-660, 492], seam: [0, -40] };
  const locations = sites.length ? sites : Object.keys(referenceCenters);
  assert(locations.every(site => Object.hasOwn(referenceCenters, site)), 'Unknown Stage 1 turf site');
  const fixed = { backend, q: 'med', cam: '6', hud: '0', day: '6', hour: '13', wx: 'clear', exposure: '1.428', scale: '1' };
  const manifest = {
    viewport: { width, height }, settings: fixed, chromium: browser.version(),
    inputRevision: process.env.WU_CAPTURE_REVISION ?? null, captures: [], omitted: [],
  };
  const saveManifest = () => writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await saveManifest();
  let priorLacksCapture = false;
  for (const site of locations) {
    const samples = [
      ...views.map(view => ({ view, motion: false, elapsedMs: captureMs })),
      ...walkSamples.map(elapsedMs => ({ view: 'standing', motion: true, elapsedMs })),
    ];
    for (const sample of samples) {
      let matched;
      for (const mode of orderedModes) {
        const url = new URL(mode === 'pr48' ? prior48 : origin);
        url.search = new URLSearchParams({
          ...fixed, turfSite: site, turfView: sample.view, captureMs: String(sample.elapsedMs),
          walk: sample.motion ? '1' : '0', ...modes[mode],
        });
        const name = [mode, site, sample.motion ? 'walk' : sample.view, sample.elapsedMs, backend].join('-');
        const omit = async reason => {
          manifest.omitted.push({ name, url: url.href, reason });
          await saveManifest();
          console.log(`omit ${name}: ${reason}`);
        };
        if (mode === 'pr48' && priorLacksCapture) {
          await omit('The #48 origin lacks matching fixed-time capture telemetry');
          continue;
        }
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        const problems = [];
        page.on('pageerror', error => problems.push(error.message));
        page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
        page.on('requestfailed', request => problems.push(`Request failed: ${request.url()}`));
        page.on('response', response => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });
        try {
          const { png, report, frameStats } = await captureStageFrame(page, url);
          if (mode === 'pr48' && (!report?.camera.pose || report.params.captureMs !== sample.elapsedMs)) {
            priorLacksCapture = true;
            await omit('The #48 origin lacks matching fixed-time capture telemetry');
            continue;
          }
          assert.deepEqual(problems, [], name);
          assert(png, `${name}: no production frame`);
          assert(frameStats.stdDev >= 4 && frameStats.colours >= 12, `${name}: frame looks blank`);
          const pose = report.camera.pose;
          assert(pose?.eye && pose.direction && [...Object.values(pose.eye), ...Object.values(pose.direction), pose.fovDeg, pose.nearM, pose.aspect]
            .every(Number.isFinite), `${name}: invalid camera pose telemetry`);
          assert.equal(report.backend.active, backend, name);
          assert.equal(report.camera.index, Number(fixed.cam), name);
          assert.equal(report.quality.tier, fixed.q, name);
          assert.equal(report.params.captureMs, sample.elapsedMs, name);
          assert.equal(report.params.walk, sample.motion, name);
          assert.equal(report.params.turfSite, site, name);
          assert.equal(report.params.turfView, sample.view, name);
          assert.equal(report.viewport.renderScale, 1, name);
          assert.equal(report.viewport.renderScaleLocked, true, name);
          assert.equal(report.environment.day, Number(fixed.day), name);
          assert.equal(report.environment.hour, Number(fixed.hour), name);
          assert.equal(report.environment.weather, fixed.wx, name);
          const turf = report.world.grass.worldTurf;
          assert.equal(report.world.grass.enabled, true, name);
          if (mode === 'normal') {
            assert.equal(turf, null, name);
          } else {
            assert.equal(turf.reference, mode === 'master', name);
            assert.equal(turf.overflow, false, name);
            if (mode !== 'master') {
              assert.equal(turf.ribbonLod?.rangeM, 30, name);
              assert.equal(turf.trial?.mode, 'canopy', name);
            }
            if (mode === 'pr49' || mode === 'surface') assert.equal(turf.ribbonLod?.mode, 'quality', name);
            if (mode === 'surface') assert.equal(report.params.turfFrame, 'surface', name);
          }
          const { day, hour, weather, sunAltitudeDeg, moonIllumination, exposure, windDirDeg, windSpeedMs } = report.environment;
          const conditions = {
            pose, backend, day, hour, weather, sunAltitudeDeg, moonIllumination, exposure, windDirDeg, windSpeedMs,
            buffer: [report.viewport.drawingBufferWidth, report.viewport.drawingBufferHeight],
          };
          const [centerX, centerZ] = referenceCenters[site];
          const referencePatchContainsEye = mode === 'master'
            ? Math.abs(pose.eye.x - centerX) < 2 && Math.abs(pose.eye.z - centerZ) < 2
            : null;
          if (referencePatchContainsEye === false) {
            await omit('Camera outside the 4 × 4 m source patch');
            continue;
          }
          if (mode === 'pr48' && !isDeepStrictEqual(conditions, matched)) {
            await omit('The #48 capture conditions differ from the matched local pair');
            continue;
          }
          if (matched) assert.deepEqual(conditions, matched, `${name}: unmatched camera, light, wind, or buffer size`);
          else matched = conditions;
          const image = name + '.png';
          const telemetry = name + '.json';
          await writeFile(join(dir, image), Buffer.from(png.split(',')[1], 'base64'));
          await writeFile(join(dir, telemetry), JSON.stringify(report, null, 2) + '\n');

          manifest.captures.push({ mode, site, ...sample, url: url.href, image, telemetry, ...conditions, frameStats, referencePatchContainsEye });
          await saveManifest();
          console.log(`ok ${name}`);
        } finally {
          await page.close();
        }
      }
    }
  }
}

async function captureStageFrame(page, url) {
  await page.addInitScript(minFrames => {
    const next = window.requestAnimationFrame.bind(window);
    let framesAfterReady = 0;
    window.requestAnimationFrame = callback => next(time => {
      if (window.__turfFrame) return;
      const ready = window.__wu?.ready();
      callback(time);
      if (!ready || ++framesAfterReady < minFrames) return;
      const canvas = document.querySelector('#viewport-root canvas');
      if (canvas) window.__turfFrame = canvas.toDataURL('image/png');
    });
  }, minFrames);
  await page.goto(url.href);
  await page.waitForFunction(() => window.__turfFrame || document.querySelector('#boot-message')?.textContent.startsWith('Could not start'), null,
    { timeout: 220_000, polling: 250 });
  return page.evaluate(async () => {
    const png = window.__turfFrame;
    const report = window.__wu?.report();
    if (!png) throw new Error(document.querySelector('#boot-message')?.textContent ?? 'No production frame');
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set();
    let total = 0;
    let squares = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      total += luma;
      squares += luma * luma;
      colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4));
    }
    const count = data.length / 4;
    const stdDev = Math.sqrt(Math.max(0, squares / count - (total / count) ** 2));
    return { png, report, frameStats: { stdDev, colours: colours.size } };
  });
}
