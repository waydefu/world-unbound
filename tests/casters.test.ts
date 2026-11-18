import { describe, expect, it } from 'vitest';
import { MemoryRegistry } from '../src/perf/memoryRegistry';
import { createNoiseTexture } from '../src/render/noiseTextures';
import { TerrainChunks } from '../src/render/terrainChunks';
import { slotOf, lodVertexCount } from '../src/world/chunkGrid';
import { CHUNK_SIZE } from '../src/world/constants';
import type { TerrainResult } from '../src/world/terrainJob';

function fakeResult(cx: number, cz: number, lod: number): TerrainResult {
  const n = lodVertexCount(lod);
  return {
    slot: slotOf(cx, cz), seq: 1, lod, positions: new Float32Array(n * 3), normals: new Float32Array(n * 3),
    colors: new Uint8Array(n * 4), minY: 0, maxY: 10,
  };
}

describe('TerrainChunks near/far shadow casters', () => {
  const RADIUS = 300;
  const chunks = new TerrainChunks(new MemoryRegistry([192, 128, 64, 64]), createNoiseTexture().texture, RADIUS);
  chunks.setEyeOffset(0, 50, 0);
  // Chunk (cx, cz) has its centre at ((cx + 0.5) * CHUNK_SIZE, ...): cx = 0 is ~32 m away, cx = 8 ~ 544 m.
  chunks.apply(fakeResult(0, 0, 0));
  chunks.apply(fakeResult(8, 0, 4));
  const near = chunks.root.getObjectByName('terrain-bundle-near');
  const far = chunks.root.getObjectByName('terrain-bundle-far');
  const slotNear = slotOf(0, 0);
  const slotFar = slotOf(8, 0);

  it('puts chunks inside the radius in the casting bundle and the rest in the receive-only bundle', () => {
    expect(near?.children).toHaveLength(1);
    expect(far?.children).toHaveLength(1);
    expect(near?.children[0].castShadow).toBe(true);
    expect(far?.children[0].castShadow).toBe(false);
    expect(far?.children[0].receiveShadow).toBe(true);
    expect(chunks.casterMask[slotNear]).toBe(1);
    expect(chunks.casterMask[slotFar]).toBe(0);
  });

  it('moves a chunk only past the 64 m hysteresis band when the camera retreats, and back when it returns', () => {
    // Chunk 0 is ~32 m from the origin: move the eye 300 m east (distance ~268 m: still a caster).
    chunks.setEyeOffset(300, 50, 0);
    chunks.rebalanceCasters();
    expect(chunks.casterMask[slotNear]).toBe(1);
    // 340 m away: inside radius + 64 m, so it stays a caster.
    chunks.setEyeOffset(340 + CHUNK_SIZE / 2, 50, CHUNK_SIZE / 2);
    chunks.rebalanceCasters();
    expect(chunks.casterMask[slotNear]).toBe(1);
    // 400 m away: beyond radius + 64 m, demoted.
    chunks.setEyeOffset(400 + CHUNK_SIZE / 2, 50, CHUNK_SIZE / 2);
    chunks.rebalanceCasters();
    expect(chunks.casterMask[slotNear]).toBe(0);
    expect(near?.children).toHaveLength(1); // only the promoted far chunk
    // The far chunk (cx = 8, centre ~544 m) is ~144 m from this eye: promoted.
    expect(chunks.casterMask[slotFar]).toBe(1);
    // Back at 340 m the demoted chunk is outside the radius, so it does not come back yet.
    chunks.setEyeOffset(340 + CHUNK_SIZE / 2, 50, CHUNK_SIZE / 2);
    chunks.rebalanceCasters();
    expect(chunks.casterMask[slotNear]).toBe(0);
    chunks.setEyeOffset(250 + CHUNK_SIZE / 2, 50, CHUNK_SIZE / 2);
    chunks.rebalanceCasters();
    expect(chunks.casterMask[slotNear]).toBe(1);
  });
});
