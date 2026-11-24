/** Add a matched macro capture to the visual audit artifact using its existing production build. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
try {
  const port = server.httpServer.address().port;
  const child = spawn(process.execPath, ['tools/turf-capture.mjs', 'artifacts/visual/turf-stage1', 'webgl2', 'slope'], {
    stdio: 'inherit',
    env: {
      ...process.env, WU_BASE: `http://127.0.0.1:${port}/world-unbound/`, WU_TURF_COMPARE: 'stage1',
      WU_TURF_VARIANTS: 'master,pr49,surface', WU_TURF_VIEWS: 'macro', WU_TURF_MOTION_MS: 'off',
      WU_CAPTURE_REVISION: process.env.GITHUB_SHA ?? '',
    },
  });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  await server.close();
}
