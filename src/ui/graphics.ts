interface GraphicsState {
  camera: number;
  tier: string;
  scale: number;
}

export function graphicsUrl(source: string, camera: number, quality: string, scale: string): URL {
  const url = new URL(source);
  url.searchParams.set('cam', String(camera));
  if (quality === 'auto') url.searchParams.delete('q');
  else url.searchParams.set('q', quality);
  if (scale === 'auto') url.searchParams.delete('scale');
  else url.searchParams.set('scale', scale);
  return url;
}

export function graphicsButton(parent: HTMLElement, state: () => GraphicsState): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Graphics';
  button.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog');
  dialog.className = 'graphics-dialog';
  dialog.setAttribute('aria-label', 'Graphics and performance');
  dialog.innerHTML = `<form>
    <strong>Graphics</strong>
    <output></output>
    <label>Quality
      <select name="quality"><option value="auto">Auto</option><option value="low">Low</option>
        <option value="med">Medium</option><option value="high">High</option></select>
    </label>
    <label>Render scale
      <select name="scale"><option value="auto">Auto</option><option value="1">Fixed 100%</option></select>
    </label>
    <menu><button type="button">Cancel</button><button type="submit">Apply and reload</button></menu>
  </form>`;
  const form = dialog.querySelector('form');
  if (!form) throw new Error('Missing graphics form');
  const quality = form.elements.namedItem('quality') as HTMLSelectElement;
  const scale = form.elements.namedItem('scale') as HTMLSelectElement;
  const output = form.querySelector('output');
  if (!output) throw new Error('Missing graphics status');
  form.querySelector('button[type=button]')?.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    location.assign(graphicsUrl(location.href, state().camera, quality.value, scale.value).href);
  });
  button.addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    const active = state();
    const tier = params.get('q');
    quality.value = tier === 'low' || tier === 'med' || tier === 'high' ? tier : 'auto';
    const rawScale = params.get('scale');
    scale.querySelector('[data-custom]')?.remove();
    if (rawScale !== null && Number(rawScale) >= 0.5 && Number(rawScale) <= 1.5 && rawScale !== '1') {
      const custom = new Option(`URL · ${Math.round(Number(rawScale) * 100)}%`, rawScale);
      custom.dataset.custom = '';
      scale.append(custom);
      scale.value = rawScale;
    } else scale.value = rawScale === '1' ? '1' : 'auto';
    output.textContent = `Active: ${active.tier === 'med' ? 'Medium' : active.tier} · ${Math.round(active.scale * 100)}%`;
    dialog.showModal();
  });
  parent.append(dialog);
  return button;
}
