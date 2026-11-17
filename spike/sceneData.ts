import { CHUNK_COUNT, CHUNK_SIZE, MAX_LOD, TILE_DIM } from '../src/world/constants';
import type { LodPolicy } from '../src/world/chunkGrid';
import { lodIndexCount, selectLod, slotCx, slotCz } from '../src/world/chunkGrid';
import { generateTile, heightAt } from '../src/world/heightField';
import { buildChunkMesh, buildLodIndices, createMeshBuffers, type ChunkMeshBuffers } from '../src/world/terrainMesh';

/**
 * Engine-neutral scene for the renderer spike: the same chunks, LODs and
 * camera path for every engine, so only the engine differs between runs.
 * LODs are fixed per chunk (chosen from the orbit centre), not re-selected
 * per frame, so every engine draws exactly the same geometry.
 */
export const ORBIT = { x: 0, z: -100, radius: 520, height: 170, framesPerTurn: 1800 };

export interface SpikeChunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: ChunkMeshBuffers;
}

export interface SpikeScene {
  chunks: SpikeChunk[];
  /** Shared index buffer per LOD. */
  indices: Uint16Array[];
  triangles: number;
  buildMs: number;
}

/** The benchmark scene is pinned (the med tier's ring before G1.4.1) so engine comparisons stay comparable when tiers are retuned. */
const SPIKE_POLICY: LodPolicy = { lod0Distance: 150, viewRadius: 1300 };

export function buildSpikeScene(): SpikeScene {
  const start = performance.now();
  const policy = SPIKE_POLICY;
  const tile = new Int16Array(TILE_DIM * TILE_DIM);
  const chunks: SpikeChunk[] = [];
  let triangles = 0;
  for (let slot = 0; slot < CHUNK_COUNT; slot++) {
    const cx = slotCx(slot);
    const cz = slotCz(slot);
    const d = Math.hypot((cx + 0.5) * CHUNK_SIZE - ORBIT.x, (cz + 0.5) * CHUNK_SIZE - ORBIT.z);
    const lod = selectLod(d, policy, -1, 0);
    if (lod < 0) continue;
    const mesh = createMeshBuffers(lod);
    buildChunkMesh(generateTile(cx, cz, tile), cx, cz, lod, mesh);
    chunks.push({ cx, cz, lod, mesh });
    triangles += lodIndexCount(lod) / 3;
  }
  const indices: Uint16Array[] = [];
  for (let lod = 0; lod <= MAX_LOD; lod++) indices.push(buildLodIndices(lod));
  return { chunks, indices, triangles, buildMs: performance.now() - start };
}

export interface Pose {
  eye: [number, number, number];
  target: [number, number, number];
}

/** Ground height under the orbit centre; the terrain must be installed (buildSpikeScene's callers do that). */
let centreCache = Number.NaN;
const centreHeight = (): number => {
  if (Number.isNaN(centreCache)) centreCache = Math.max(heightAt(ORBIT.x, ORBIT.z), 0);
  return centreCache;
};

/** Camera pose for a frame index (frame-based, so every engine sees the same views). */
export function orbitPose(frame: number, out: Pose): Pose {
  const angle = (frame / ORBIT.framesPerTurn) * Math.PI * 2;
  out.eye[0] = ORBIT.x + Math.sin(angle) * ORBIT.radius;
  const centreY = centreHeight();
  out.eye[1] = centreY + ORBIT.height;
  out.eye[2] = ORBIT.z + Math.cos(angle) * ORBIT.radius;
  out.target[0] = ORBIT.x;
  out.target[1] = centreY;
  out.target[2] = ORBIT.z;
  return out;
}

/** Shared lighting so engines are compared under the same conditions. */
export const LIGHTING = {
  sky: [0.32, 0.5, 0.78] as const,
  sunDirection: [-0.45, 0.72, 0.53] as const,
  sunIntensity: 3,
  ambientIntensity: 0.8,
  fogNear: 1500,
  fogFar: 5200,
  fovDeg: 55,
  near: 0.3,
  far: 7000,
};
