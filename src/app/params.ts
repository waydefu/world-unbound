/** URL debug parameters (pure parsing; invalid values fall back to defaults). */
import { WEATHERS, type Weather } from '../env/weather';
import type { BackendChoice } from '../render/renderer';
import { CAMERAS, type TurfSite, type TurfView } from './cameras';
import type { SoilPreview } from './soilRuntime';

export type { BackendChoice, Weather };
export type QualityName = 'low' | 'med' | 'high';
export type SodView = 'edge' | 'standing' | 'elevated' | 'backlight';

export interface DebugParams {
  /** Index of a fixed test camera. */
  cam: number;
  backend: BackendChoice;
  /** null = choose automatically from device capabilities. */
  quality: QualityName | null;
  /** null = dynamic resolution; otherwise a pinned render scale in [0.5, 1.5]. */
  scale: number | null;
  /** Local solar hour in [0, 24). */
  hour: number;
  weather: Weather;
  /** Day of the 32-day year in [0, 32): 0 spring equinox, 8 summer solstice. */
  day: number;
  /** False when the value is a default, so a camera preset may override it. */
  hourExplicit: boolean;
  weatherExplicit: boolean;
  dayExplicit: boolean;
  /** Sun shadows; ?shadows=0 turns them off for A/B cost measurements. */
  shadows: boolean;
  hud: boolean;
  /** Terrain renderer: CDLOD on a GPU height texture (default) or per-chunk meshes (?terrain=chunks, rollback). */
  terrain: 'cdlod' | 'chunks';
  /** Grass; ?grass=0 turns it off for A/B comparisons (CDLOD only). */
  grass: boolean;
  /** The grass sod on CDLOD. Use ?sward=0 to restore the previous procedural grass. */
  sward: boolean;
  worldTurf: boolean;
  turfStats: boolean;
  turfSite: TurfSite | null;
  turfView: TurfView;
  turfReference: boolean;
  /** ?sod=full compares the complete high-poly tile on camera 2. */
  sodView: SodView | null;
  /** Deterministic soil moisture states for fixed-light A/B captures. */
  soilPreview: SoilPreview | null;
  /** Repeat the eye-height grass test path on camera 1 or 2. */
  walk: boolean;
}

/** Late spring: long evenings, so the dusk camera gets a real golden hour. */
export const DEFAULT_DAY = 6;
const QUALITIES: readonly QualityName[] = ['low', 'med', 'high'];

function numberIn(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function parseParams(search: string): DebugParams {
  const p = new URLSearchParams(search);
  const cam = numberIn(p.get('cam'), 0, CAMERAS.length - 1);
  const backend = p.get('backend');
  const q = p.get('q') as QualityName | null;
  const wx = p.get('wx') as Weather | null;
  const hour = numberIn(p.get('hour'), 0, 24);
  const day = numberIn(p.get('day'), 0, 32);
  const view = p.get('sodView');
  const soil = p.get('soil');
  const turfSite = p.get('turfSite');
  const turfView = p.get('turfView');
  const terrain = p.get('terrain') === 'chunks' ? 'chunks' : 'cdlod';
  const grass = p.get('grass') !== '0';
  const sodView = p.get('sod') === 'full' && grass && terrain === 'cdlod'
    ? (view === 'standing' || view === 'elevated' || view === 'backlight' ? view : 'edge') : null;
  const worldTurf = p.get('sward') === 'world' && grass && terrain === 'cdlod' && sodView === null;
  return {
    cam: cam === null ? (sodView === null ? 5 : 2) : Math.floor(cam),
    backend: backend === 'webgpu' || backend === 'webgl2' ? backend : 'auto',
    quality: q !== null && QUALITIES.includes(q) ? q : null,
    scale: numberIn(p.get('scale'), 0.5, 1.5),
    hour: hour === null ? 13 : hour % 24,
    weather: wx !== null && WEATHERS.includes(wx) ? wx : 'clear',
    day: day === null ? DEFAULT_DAY : day % 32,
    hourExplicit: hour !== null,
    weatherExplicit: wx !== null && WEATHERS.includes(wx),
    dayExplicit: day !== null,
    shadows: p.get('shadows') !== '0',
    hud: p.get('hud') !== '0',
    terrain,
    grass,
    sward: p.get('sward') !== '0',
    worldTurf,
    turfStats: p.get('turfStats') === '1',
    turfSite: turfSite === 'slope' || turfSite === 'lowland' || turfSite === 'highland' || turfSite === 'seam' ? turfSite : null,
    turfView: turfView === 'standing' || turfView === 'raised' ? turfView : 'close',
    turfReference: worldTurf && p.get('turfReference') === '1',
    sodView,
    soilPreview: soil === 'dry' || soil === 'rain' || soil === 'drained' ? soil : null,
    walk: p.get('walk') === '1',
  };
}
