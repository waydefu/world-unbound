import './inspectionControls.css';

export type InspectionHeight = 'macro' | 'standing' | 'raised';

type MoveKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';

export function createInspectionControls(viewport: HTMLElement, actions: {
  move: (key: MoveKey, held: boolean) => void;
  height: (height: InspectionHeight) => void;
}) {
  const root = document.createElement('div');
  root.className = 'inspection-controls';
  const motion = document.createElement('div');
  motion.className = 'inspection-motion';
  const height = document.createElement('div');
  height.className = 'inspection-height';
  const help = document.createElement('p');
  help.textContent = 'WASD or arrows to move · Drag to look';
  root.append(motion, height, help);

  for (const [key, label, arrow] of [
    ['KeyW', 'Forward', '↑'], ['KeyA', 'Left', '←'], ['KeyS', 'Back', '↓'], ['KeyD', 'Right', '→'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.textContent = arrow;
    let pointerId: number | null = null;
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointerId !== null) return;
      pointerId = event.pointerId;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      actions.move(key, true);
    });
    button.addEventListener('lostpointercapture', () => {
      pointerId = null;
      actions.move(key, false);
    });
    motion.append(button);
  }

  const heights = new Map<InspectionHeight, HTMLButtonElement>();
  for (const [mode, label, key] of [
    ['macro', 'Macro', 'C'], ['standing', 'Standing', 'V'], ['raised', 'Raised', 'B'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = `${label} (${key})`;
    button.setAttribute('aria-keyshortcuts', key);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => actions.height(mode));
    height.append(button);
    heights.set(mode, button);
  }
  viewport.after(root);
  return {
    /** @amortized Update only on a height preset change. */
    setHeight(lift: number): void {
      const active = lift < .2 ? 'macro' : lift < 3 ? 'standing' : 'raised';
      for (const [mode, button] of heights) button.setAttribute('aria-pressed', String(mode === active));
    },
  };
}
