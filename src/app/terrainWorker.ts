/// <reference lib="webworker" />
import { SEAFLOOR_DIM, buildSeaFloor } from '../world/seaFloor';
import { runTerrainJob, type TerrainRequest } from '../world/terrainJob';

/** Terrain worker: tile generation and mesh building off the main thread. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<TerrainRequest | { kind: 'seafloor' }>): void => {
  const data = event.data;
  if ('kind' in data) {
    const heights = buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
    scope.postMessage({ kind: 'seafloor', heights }, [heights.buffer]);
    return;
  }
  const result = runTerrainJob(data);
  scope.postMessage(result, [result.positions.buffer, result.normals.buffer, result.colors.buffer]);
};
