/**
 * Fullscreen toggle for the HUD bar. Uses the standard Fullscreen API (and the webkit-prefixed one that
 * iPadOS Safari still needs). iPhone Safari has no element fullscreen, so `fullscreenSupported()` is false
 * there and the HUD shows no button rather than one that does nothing. Entering or leaving fullscreen
 * fires a window resize, which the app already handles (canvas size, dynamic resolution, HUD layout).
 */
type WebkitDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

export function fullscreenSupported(doc: Document = document): boolean {
  const d = doc as WebkitDocument;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function isFullscreen(d: WebkitDocument): boolean {
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Enters fullscreen on the whole page, or leaves it. Must run from a user gesture (a click). */
export function toggleFullscreen(doc: Document = document): void {
  const d = doc as WebkitDocument;
  if (isFullscreen(d)) {
    if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined);
    else d.webkitExitFullscreen?.();
    return;
  }
  const root = doc.documentElement as WebkitElement;
  if (root.requestFullscreen) void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  else root.webkitRequestFullscreen?.();
}

/** Keeps the button label in step with the state (Esc, the back gesture or the browser can leave fullscreen). */
export function watchFullscreen(element: HTMLButtonElement, doc: Document = document): void {
  const update = (): void => {
    const on = isFullscreen(doc as WebkitDocument);
    element.textContent = on ? '⤡' : '⛶';
    element.title = on ? 'Exit fullscreen' : 'Fullscreen';
    element.setAttribute('aria-pressed', String(on));
  };
  doc.addEventListener('fullscreenchange', update);
  doc.addEventListener('webkitfullscreenchange', update);
  update();
}
