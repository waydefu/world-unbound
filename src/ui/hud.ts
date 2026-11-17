/**
 * Telemetry HUD and debug controls. DOM only, refreshed at low frequency by
 * the app; uses flat translucent backgrounds (no backdrop-filter) to keep
 * mobile compositing cheap.
 */
/** Terrain attribution required by the CC BY 4.0 licence of the Kartverket data; always on screen. */
export const TERRAIN_CREDIT = 'Terrain © Kartverket (CC BY 4.0), modified';

export interface HudActions {
  setCamera(index: number): void;
  exportReport(): void;
}

export class Hud {
  private readonly panel: HTMLPreElement;
  private readonly status: HTMLDivElement;
  private visible: boolean;

  /** `cameraNames` labels the camera buttons; the HUD does not depend on the app's camera table. */
  constructor(parent: HTMLElement, actions: HudActions, visible: boolean, cameraNames: readonly string[]) {
    this.visible = visible;
    const bar = document.createElement('div');
    bar.className = 'hud-bar';
    const toggle = button('HUD', () => this.setVisible(!this.visible));
    toggle.title = 'Toggle telemetry (H)';
    bar.append(toggle);
    cameraNames.forEach((name, index) => {
      const b = button(String(index), () => actions.setCamera(index));
      b.title = name;
      bar.append(b);
    });
    bar.append(button('JSON', () => actions.exportReport()));

    this.panel = document.createElement('pre');
    this.panel.className = 'hud-panel';
    this.status = document.createElement('div');
    this.status.className = 'hud-status';
    const credit = document.createElement('div');
    credit.className = 'hud-credit';
    credit.textContent = TERRAIN_CREDIT;
    parent.append(bar, this.panel, this.status, credit);
    this.setVisible(visible);

    window.addEventListener('keydown', (event) => {
      if (event.key === 'h' || event.key === 'H') this.setVisible(!this.visible);
      else if (event.key >= '0' && event.key <= '5') actions.setCamera(Number(event.key));
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.panel.hidden = !visible;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setText(text: string): void {
    this.panel.textContent = text;
  }

  /** Persistent banner for degraded states (fallback backend, crash recovery, device loss). */
  setStatus(message: string | null): void {
    this.status.hidden = message === null;
    this.status.textContent = message ?? '';
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/** Offers the report as a file download without any server round trip. */
export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
