/**
 * Lightweight abnormal-reload detection. iOS can discard a page under memory
 * pressure without any event; a flag that is set while running and cleared on
 * a clean exit lets the next start choose a safe low configuration.
 */
const KEY = 'world-unbound.session';

export interface SessionStart {
  recoveredFromCrash: boolean;
}

export function beginSession(): SessionStart {
  let recoveredFromCrash = false;
  try {
    recoveredFromCrash = localStorage.getItem(KEY) === 'running';
    localStorage.setItem(KEY, 'running');
  } catch {
    // Storage may be blocked (private mode); run without the safety net.
  }
  const markClean = (): void => {
    try {
      localStorage.setItem(KEY, 'clean');
    } catch {
      /* ignore */
    }
  };
  const markRunning = (): void => {
    try {
      localStorage.setItem(KEY, 'running');
    } catch {
      /* ignore */
    }
  };
  // pagehide fires on normal navigation; a discarded tab never gets it.
  window.addEventListener('pagehide', markClean);
  window.addEventListener('pageshow', markRunning);
  return { recoveredFromCrash };
}
