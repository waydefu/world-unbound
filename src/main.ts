import './ui/style.css';
import { App } from './app/App';
import { parseParams } from './app/params';
import { QUALITY, chooseQuality } from './app/quality';
import { detectCapabilities } from './platform/capabilities';
import { beginSession } from './platform/session';

/** Automation/debug surface used by the visual audit and manual testing. */
interface DebugSurface {
  ready(): boolean;
  report(): Record<string, unknown>;
  setCamera(index: number): void;
  simulateDeviceLost(): Promise<void>;
}

declare global {
  interface Window {
    __wu?: DebugSurface;
  }
}

async function boot(): Promise<void> {
  const bootScreen = document.getElementById('boot') as HTMLElement;
  const bootMessage = document.getElementById('boot-message') as HTMLElement;
  const bootProgress = document.getElementById('boot-progress') as HTMLProgressElement;
  const retry = document.getElementById('boot-retry') as HTMLButtonElement;
  const viewportRoot = document.getElementById('viewport-root') as HTMLElement;
  const hudRoot = document.getElementById('hud-root') as HTMLElement;
  retry.addEventListener('click', () => location.reload());
  let failed = false;
  const progress = (percent: number, message: string): void => {
    if (failed) return;
    bootProgress.value = Math.max(bootProgress.value, percent);
    bootMessage.textContent = message;
    if (percent === 100) bootScreen.hidden = true;
  };
  try {
    const params = parseParams(location.search);
    const session = beginSession();
    const capabilities = await detectCapabilities();
    if (!capabilities.webgl2 && !capabilities.webgpu.adapter) {
      throw new Error('This browser offers neither WebGPU nor WebGL2.');
    }
    progress(5, 'Loading terrain');
    const quality = chooseQuality(params.quality, {
      mobile: capabilities.mobile,
      recoveredFromCrash: session.recoveredFromCrash,
      webgpu: capabilities.webgpu.adapter,
    });
    const app = await App.create({
      params,
      capabilities,
      tier: QUALITY[quality],
      recoveredFromCrash: session.recoveredFromCrash,
      viewportRoot,
      hudRoot,
      progress,
    });
    window.__wu = {
      ready: () => app.ready,
      report: () => app.report(),
      setCamera: (index) => app.setCamera(index),
      simulateDeviceLost: () => app.recoverFromDeviceLoss(),
    };
  } catch (err) {
    failed = true;
    console.error(err);
    bootMessage.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
    retry.hidden = false;
  }
}

void boot();
