/// <reference lib="webworker" />
import { COAST_DIM, SEAFLOOR_DIM, buildCoastFloor, buildSeaFloor } from '../world/seaFloor';
import { runTerrainJob, type TerrainRequest } from '../world/terrainJob';
import { buildTerrainTextures, type MaterialStep } from '../world/terrainTextures';
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

type WorkerRequest = TerrainRequest | { kind: 'seafloor'; fine?: boolean } | { kind: 'textures'; step: MaterialStep };

scope.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const data = event.data;
  if (!(await ready)) return;
  if ('kind' in data && data.kind === 'textures') {
    // The GPU height and material textures (ADR-0003), derived from the lattice this worker just installed.
    const started = performance.now();
    const textures = buildTerrainTextures(data.step);
    textures.ms = performance.now() - started;
    scope.postMessage({ kind: 'textures', textures }, [textures.height.buffer, textures.material.buffer, textures.normal.buffer, textures.pyramid.buffer]);
    return;
  }
  if ('kind' in data) {
    const fine = data.fine === true;
    const heights = fine
      ? buildCoastFloor(new Float32Array(COAST_DIM * COAST_DIM))
      : buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
    scope.postMessage({ kind: 'seafloor', fine, heights }, [heights.buffer]);
    return;
  }
  const started = performance.now();
  const result = runTerrainJob(data);
  result.buildMs = performance.now() - started;
  scope.postMessage(result, [result.positions.buffer, result.normals.buffer, result.colors.buffer]);
};
