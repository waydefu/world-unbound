/** Spike run results: per-device storage, comparison table and JSON export. */
export interface Stat {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

export interface SpikeResult {
  schema: 'world-unbound.engine-spike/1';
  runAt: string;
  engine: string;
  backend: string;
  snapshotActive: boolean;
  gpuScope: string;
  buffer: { width: number; height: number; pixels: number };
  scene: { chunks: number; triangles: number; buildMs: number };
  engineInitMs: number;
  measuredSeconds: number;
  frames: number;
  drawCallsMean: number;
  intervalMs: Stat;
  fps: number;
  cpuSubmitMs: Stat;
  gpuMs: Stat | null;
  longFramesOver50Ms: number;
  crossOriginRequests: string[];
  adapter: { vendor: string; architecture: string } | null;
  userAgent: string;
  error: string | null;
}

const KEY = 'world-unbound.engine-spike';

export function loadResults(): SpikeResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SpikeResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResult(result: SpikeResult): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadResults(), result]));
  } catch {
    /* storage blocked: the result is still shown and exportable */
  }
}

export function clearResults(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);

export function resultsTable(results: SpikeResult[]): HTMLTableElement {
  const table = document.createElement('table');
  const head = ['#', 'engine', 'backend', 'fps', 'frame p95', 'CPU p50', 'CPU p95', 'GPU p50', 'GPU p95', 'draws', 'long'];
  const header = table.insertRow();
  for (const h of head) header.insertCell().textContent = h;
  results.forEach((r, i) => {
    const row = table.insertRow();
    const cells = r.error
      ? [String(i + 1), r.engine, r.backend, `error: ${r.error}`]
      : [
          String(i + 1),
          r.engine + (r.snapshotActive ? ' (bundles)' : ''),
          r.backend,
          f1(r.fps),
          f1(r.intervalMs.p95),
          f2(r.cpuSubmitMs.p50),
          f2(r.cpuSubmitMs.p95),
          r.gpuMs ? f2(r.gpuMs.p50) : 'N/A',
          r.gpuMs ? f2(r.gpuMs.p95) : 'N/A',
          f1(r.drawCallsMean),
          String(r.longFramesOver50Ms),
        ];
    for (const c of cells) row.insertCell().textContent = c;
  });
  return table;
}

export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
