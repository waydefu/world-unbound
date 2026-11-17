/// <reference lib="webworker" />
import { SEAFLOOR_DIM, buildSeaFloor } from '../world/seaFloor';
import { runTerrainJob, type TerrainRequest } from '../world/terrainJob';
import { loadAndInstallTerrain } from './terrainAssets';

/** Terrain worker: tile generation and mesh building off the main thread. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The worker fetches and verifies the terrain tiles itself; jobs wait for it, in arrival order. */
const ready: Promise<boolean> = loadAndInstallTerrain().then(
  (ms) => {
    scope.postMessage({ kind: 'terrain-ready', ms });
    return true;
  },
  (error: unknown) => {
    scope.postMessage({ kind: 'terrain-error', message: error instanceof Error ? error.message : String(error) });
    return false;
  },
);

scope.onmessage = async (event: MessageEvent<TerrainRequest | { kind: 'seafloor' }>): Promise<void> => {
  const data = event.data;
  if (!(await ready)) return;
  if ('kind' in data) {
    const heights = buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
    scope.postMessage({ kind: 'seafloor', heights }, [heights.buffer]);
    return;
  }
  const result = runTerrainJob(data);
  scope.postMessage(result, [result.positions.buffer, result.normals.buffer, result.colors.buffer]);
};
