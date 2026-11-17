import { describe, expect, it } from 'vitest';
import { ChunkRequests } from '../src/world/chunkRequests';
import { slotOf } from '../src/world/chunkGrid';
import { CHUNK_COUNT } from '../src/world/constants';

const policy = { lod0Distance: 100, viewRadius: 400 };

describe('ChunkRequests', () => {
  it('dispatches nearest chunks first and never exceeds the table size', () => {
    const r = new ChunkRequests();
    r.updateDesired(32, 32, 0, 0, 0, policy, 0);
    const first = r.nextToDispatch();
    expect(first).toBe(slotOf(0, 0));
    let dispatched = 0;
    let last = -1;
    for (;;) {
      const slot = r.nextToDispatch();
      if (slot < 0) break;
      expect(r.priority[slot]).toBeGreaterThanOrEqual(last);
      last = r.priority[slot];
      r.dispatch(slot);
      dispatched++;
    }
    expect(dispatched).toBeGreaterThan(20);
    expect(dispatched).toBeLessThanOrEqual(CHUNK_COUNT);
    expect(r.inFlightCount).toBe(dispatched);
  });

  it('accepts a matching result and rejects stale or unknown ones', () => {
    const r = new ChunkRequests();
    r.updateDesired(32, 32, 0, 0, 0, policy, 0);
    const slot = r.nextToDispatch();
    const lod = r.desired[slot];
    const seq = r.dispatch(slot);
    expect(r.complete(slot, seq + 99, lod)).toBe(false);
    expect(r.inFlightCount).toBe(1);
    expect(r.complete(slot, seq, lod)).toBe(true);
    expect(r.loaded[slot]).toBe(lod);
    expect(r.loadedCount).toBe(1);
    expect(r.complete(slot, seq, lod)).toBe(false);
  });

  it('drops a result whose chunk is no longer wanted (cancellation)', () => {
    const r = new ChunkRequests();
    r.updateDesired(32, 32, 0, 0, 0, policy, 0);
    const slot = r.nextToDispatch();
    const lod = r.desired[slot];
    const seq = r.dispatch(slot);
    r.updateDesired(-900, -900, 0, 0, 0, policy, 0); // camera cut far away
    expect(r.desired[slot]).toBe(-1);
    expect(r.complete(slot, seq, lod)).toBe(false);
    expect(r.staleResults).toBe(1);
    expect(r.loadedCount).toBe(0);
    expect(r.inFlightCount).toBe(0);
  });

  it('evicts chunks that left the view radius', () => {
    const r = new ChunkRequests();
    r.updateDesired(32, 32, 0, 0, 0, policy, 0);
    const slot = r.nextToDispatch();
    expect(r.complete(slot, r.dispatch(slot), r.desired[slot])).toBe(true);
    expect(r.nextToEvict(0)).toBe(-1);
    r.updateDesired(900, 900, 0, 0, 0, policy, 0);
    expect(r.nextToEvict(0)).toBe(slot);
    r.markEvicted(slot);
    expect(r.loadedCount).toBe(0);
    expect(r.nextToEvict(0)).toBe(-1);
  });

  it('prefetches along the velocity vector', () => {
    const still = new ChunkRequests();
    const moving = new ChunkRequests();
    still.updateDesired(0, 0, 0, 0, 0.75, policy, 0);
    moving.updateDesired(0, 0, 400, 0, 0.75, policy, 0);
    const ahead = slotOf(9, 0); // ~608 m east: outside the radius unless prefetched
    expect(still.desired[ahead]).toBe(-1);
    expect(moving.desired[ahead]).toBeGreaterThanOrEqual(0);
  });
});
