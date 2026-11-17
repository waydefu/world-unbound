/** URL debug parameters (pure parsing; invalid values fall back to defaults). */
export type BackendChoice = 'auto' | 'webgpu' | 'webgl2';
export type QualityName = 'low' | 'med' | 'high';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';

export interface DebugParams {
  /** Fixed test camera 0..5. */
  cam: number;
  backend: BackendChoice;
  /** null = choose automatically from device capabilities. */
  quality: QualityName | null;
  /** null = dynamic resolution; otherwise a pinned render scale in [0.5, 1.5]. */
  scale: number | null;
  /** Local solar hour in [0, 24). */
  hour: number;
  weather: Weather;
  /** False when the value is a default, so a camera preset may override it. */
  hourExplicit: boolean;
  weatherExplicit: boolean;
  hud: boolean;
}

export const CAMERA_COUNT = 6;
const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'storm'];
const QUALITIES: readonly QualityName[] = ['low', 'med', 'high'];

function numberIn(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function parseParams(search: string): DebugParams {
  const p = new URLSearchParams(search);
  const cam = numberIn(p.get('cam'), 0, CAMERA_COUNT - 1);
  const backend = p.get('backend');
  const q = p.get('q') as QualityName | null;
  const wx = p.get('wx') as Weather | null;
  const hour = numberIn(p.get('hour'), 0, 24);
  return {
    cam: cam === null ? 5 : Math.floor(cam),
    backend: backend === 'webgpu' || backend === 'webgl2' ? backend : 'auto',
    quality: q !== null && QUALITIES.includes(q) ? q : null,
    scale: numberIn(p.get('scale'), 0.5, 1.5),
    hour: hour === null ? 13 : hour % 24,
    weather: wx !== null && WEATHERS.includes(wx) ? wx : 'clear',
    hourExplicit: hour !== null,
    weatherExplicit: wx !== null && WEATHERS.includes(wx),
    hud: p.get('hud') !== '0',
  };
}
