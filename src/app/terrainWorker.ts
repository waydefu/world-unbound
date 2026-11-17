/// <reference lib="webworker" />
import { runTerrainJob, type TerrainRequest } from './terrainJob';

/** Terrain worker: tile generation and mesh building off the main thread. */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<TerrainRequest>): void => {
  const result = runTerrainJob(event.data);
  scope.postMessage(result, [result.positions.buffer, result.normals.buffer, result.colors.buffer]);
};
