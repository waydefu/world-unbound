import type { DynamicResolution } from '../perf/dynamicResolution';
import type { FrameStats, Percentiles } from '../perf/frameStats';
import { PARTITION_NAMES, type MemoryRegistry } from '../perf/memoryRegistry';
import type { AppState } from './report';

const scratch: Percentiles = { p50: 0, p95: 0, p99: 0, mean: 0 };
const MIB = 1024 * 1024;

const fmt = (v: number | null, digits = 1): string => (v === null ? 'n/a' : v.toFixed(digits));
const millions = (v: number): string => (v / 1e6).toFixed(2);
const thousands = (v: number): string => `${(v / 1e3).toFixed(0)}k`;

/** The four compact observability lines (G1.4.1 phase E); `n/a` where a value is null or unsupported. */
function observabilityLines(state: AppState): string[] {
  let shadow = '';
  for (let i = 0; i < state.shadowCascades; i++) shadow += `${i > 0 ? '/' : ''}${millions(state.trisShadow[i])}`;
  const pipes = state.pipelinesAfterWarmup === null ? 'n/a' : `+${state.pipelinesAfterWarmup}`;
  const heap = state.jsHeapMiB === null ? 'n/a' : `~${state.jsHeapMiB.toFixed(0)} MiB`;
  const loaf = state.loafSupported
    ? `LoAF ${state.loafCount} · worst ${state.loafWorstMs.toFixed(0)} ms · top ${state.loafTopScript ?? 'n/a'}`
    : 'LoAF n/a';
  return [
    `chunks vis ${state.visibleChunks}/${state.residentChunks} · cull ${state.culledChunks} · cast ${state.shadowCasterChunks} · q ${state.workerQueued}+${state.chunksInFlight} · build p50 ${fmt(state.buildP50Ms)}/p95 ${fmt(state.buildP95Ms)} ms`,
    `tris main ${millions(state.trisMain)}M · sh ${shadow ? `${shadow}M` : 'n/a'} · ocean ${thousands(state.trisOcean)} · far ${thousands(state.trisFar)}`,
    `upload ${state.uploadMiBps.toFixed(1)} MiB/s · pipes ${pipes} · mats ${state.materialVariants} · heap ${heap}`,
    loaf,
  ];
}

/** Formats the telemetry panel. Called at ~2 Hz, never per frame. */
export function formatHud(state: AppState, stats: FrameStats, dyn: DynamicResolution, memory: MemoryRegistry): string {
  const p = stats.percentiles(scratch, 600);
  const fps = p.mean > 0 ? 1000 / p.mean : 0;
  const pixels = state.bufferWidth * state.bufferHeight;
  const gpu = state.gpuPassSumP50Ms === null || state.gpuPassSumP95Ms === null
    ? 'gpu Σpass n/a'
    : `gpu Σpass ${state.gpuPassSumP50Ms.toFixed(1)}/${state.gpuPassSumP95Ms.toFixed(1)} ms${state.gpuPassesPerFrame === null ? '' : ` (${state.gpuPassesPerFrame})`}`;
  const lines = [
    `${state.backend}${state.fallbackReason ? ' (fallback)' : ''} · q=${state.quality} · cam ${state.cameraIndex} ${state.cameraName}`,
    `fps ${fps.toFixed(1)} · p50 ${p.p50.toFixed(1)} p95 ${p.p95.toFixed(1)} p99 ${p.p99.toFixed(1)} ms · ${gpu} · ${state.refreshHz.toFixed(0)} Hz${state.refreshMeasured ? '' : '?'}`,
    `long >50ms ${stats.longFrames50} · >100ms ${stats.longFrames100} · frames ${stats.totalFrames}`,
    `buffer ${state.bufferWidth}x${state.bufferHeight} (${(pixels / 1e6).toFixed(2)} MP) · css ${state.cssWidth}x${state.cssHeight} · dpr ${state.devicePixelRatio.toFixed(2)}`,
    `scale ${dyn.scale.toFixed(2)}${dyn.locked ? ' locked' : ''} · changes ${dyn.changes}`,
    `chunks ${state.chunksLoaded} · in-flight ${state.chunksInFlight} · stale ${state.staleResults} · lod bias ${state.lodBias} · ${state.terrainMode}`,
    `draws ${state.drawCalls} (+${state.bundledDraws} bundled) · tris ${(state.triangles / 1000).toFixed(1)}k`,
    `variants ${state.materialVariants}/${state.variantBudget} · warm-up ${state.warmupMs.toFixed(0)} ms · first frame ${state.firstFrameMs.toFixed(0)} ms · world ${state.worldReadyMs.toFixed(0)} ms · terrain load ${state.terrainLoadMs.toFixed(0)} ms`,
  ];
  let mem = 'mem MiB';
  for (let i = 0; i < 4; i++) {
    mem += ` · ${PARTITION_NAMES[i]} ${(memory.used[i] / MIB).toFixed(1)}/${(memory.budget[i] / MIB).toFixed(0)}`;
  }
  lines.push(mem);
  lines.push(...observabilityLines(state));
  lines.push(`day ${state.day.toFixed(1)} ${state.season} · hour ${state.hour.toFixed(1)} · ${state.weather} · sun ${state.sunAltitudeDeg.toFixed(0)}° · exp ${state.exposure.toPrecision(3)}`);
  lines.push(`lost ${state.deviceLostCount} · bg ${state.backgroundSuspends}`);
  return lines.join('\n');
}
