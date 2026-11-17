/**
 * Lightweight abnormal-reload detection. iOS can discard a page under memory
 * pressure without any event; a flag that is set while running and cleared on
 * a clean exit lets the next start choose a safe low configuration.
 *
 * The flag is kept in sessionStorage, which is scoped to one tab: a second tab
 * or a tab switch (Android) must not look like a crash of the first one, while
 * a reload of the same tab, the case being detected, still does.
 */
const KEY = 'world-unbound.session';

export interface SessionStart {
  recoveredFromCrash: boolean;
}

export function beginSession(): SessionStart {
  let recoveredFromCrash = false;
  try {
    recoveredFromCrash = sessionStorage.getItem(KEY) === 'running';
    sessionStorage.setItem(KEY, 'running');
  } catch {
    // Storage may be blocked (private mode); run without the safety net.
  }
  const markClean = (): void => {
    try {
      sessionStorage.setItem(KEY, 'clean');
    } catch {
      /* ignore */
    }
  };
  const markRunning = (): void => {
    try {
      sessionStorage.setItem(KEY, 'running');
    } catch {
      /* ignore */
    }
  };
  // pagehide fires on normal navigation; a discarded tab never gets it.
  window.addEventListener('pagehide', markClean);
  window.addEventListener('pageshow', markRunning);
  return { recoveredFromCrash };
}
