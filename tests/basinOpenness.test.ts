import { describe, expect, it } from 'vitest';
import { HEIGHT_OFFSET, HEIGHT_QUANTUM, WORLD_MIN } from '../src/world/constants';
import {
  ENCLOSED_OPENNESS, OPENNESS_CELL_M, OPENNESS_DIM, OPENNESS_DIRECTIONS, OPEN_REACH_M, buildOpenness, buildWaterCells,
} from '../src/world/basinOpenness';
import { buildPaddedLattice, PAD_DIM } from '../src/world/terrainLattice';
import { AO_APRON } from '../src/world/terrainAo';

const DIM = 64;
const CELL = 8;
const q = (h: number): number => Math.round((h - HEIGHT_OFFSET) / HEIGHT_QUANTUM);

describe('basin openness', () => {
  it('is the fraction of 16 directions with more than 150 m of open water: 1 at sea, 0 in a closed pond', () => {
    expect(OPENNESS_DIRECTIONS).toBe(16);
    expect(OPEN_REACH_M).toBe(150);
    const sea = new Uint8Array(DIM * DIM).fill(1);
    const open = buildOpenness(sea, DIM, CELL);
    expect(open[32 * DIM + 32]).toBe(255);
    // A 5 x 5 cell pond (40 m) in land: no direction reaches 150 m.
    const pond = new Uint8Array(DIM * DIM);
    for (let j = 30; j < 35; j++) for (let i = 30; i < 35; i++) pond[j * DIM + i] = 1;
    const closed = buildOpenness(pond, DIM, CELL);
    expect(closed[32 * DIM + 32]).toBe(0);
    expect(closed[32 * DIM + 32] / 255).toBeLessThan(ENCLOSED_OPENNESS);
  });

  it('a long channel is open only along its axis; a bay behind a breakwater is enclosed', () => {
    const channel = new Uint8Array(DIM * DIM);
    for (let j = 30; j < 34; j++) for (let i = 0; i < DIM; i++) channel[j * DIM + i] = 1;
    const c = buildOpenness(channel, DIM, CELL)[32 * DIM + 32] / 255;
    expect(c).toBeGreaterThan(0.05);
    expect(c).toBeLessThan(ENCLOSED_OPENNESS + 0.05);
    // Open sea with a wall of land one cell thick across a bay.
    const bay = new Uint8Array(DIM * DIM).fill(1);
    for (let i = 20; i < 44; i++) bay[40 * DIM + i] = 0;
    for (let j = 40; j < DIM; j++) { bay[j * DIM + 20] = 0; bay[j * DIM + 43] = 0; }
    for (let i = 20; i < 44; i++) bay[(DIM - 1) * DIM + i] = 0;
    const result = buildOpenness(bay, DIM, CELL);
    expect(result[50 * DIM + 32]).toBe(0);
    expect(result[20 * DIM + 32] / 255).toBeGreaterThan(0.8);
  });

  it('counts a thin breakwater as land when it is narrower than a cell (any land point in the 4 x 4 block)', () => {
    const apron = 8;
    const lattice = 4 * 16 + 1;
    const pad = lattice + 2 * apron;
    const heights = new Int16Array(pad * pad).fill(q(-10));
    // One lattice column of land (2 m wide) on the block boundary x = 33.
    for (let j = 0; j < pad; j++) heights[j * pad + 33 + apron] = q(2);
    const water = buildWaterCells(heights, pad, apron, 16, 4);
    let landCells = 0;
    for (let i = 0; i < 16; i++) landCells += 1 - water[8 * 16 + i];
    expect(landCells).toBe(1);
  });

  it('land cells beside water carry their neighbour mean, far land stays 0', () => {
    const w = new Uint8Array(DIM * DIM);
    for (let j = 0; j < DIM; j++) for (let i = 0; i < 20; i++) w[j * DIM + i] = 1;
    const o = buildOpenness(w, DIM, CELL);
    expect(o[30 * DIM + 20]).toBeGreaterThan(0);
    expect(o[30 * DIM + 40]).toBe(0);
  });
});

describe('basin openness of the Hellesylt terrain', () => {
  const lattice = buildPaddedLattice();
  const water = buildWaterCells(lattice, PAD_DIM, AO_APRON, OPENNESS_DIM, OPENNESS_CELL_M / 2);
  const started = performance.now();
  const open = buildOpenness(water, OPENNESS_DIM, OPENNESS_CELL_M);
  const ms = performance.now() - started;
  const at = (x: number, z: number): number => {
    const i = Math.floor((x - WORLD_MIN) / OPENNESS_CELL_M);
    const j = Math.floor((z - WORLD_MIN) / OPENNESS_CELL_M);
    return open[j * OPENNESS_DIM + i] / 255;
  };

  it('has a 512 x 512 map and builds quickly', () => {
    expect(open.length).toBe(512 * 512);
    expect(ms).toBeLessThan(2000);
  });

  it('calls the harbour basin between the pier and the quay enclosed, and the open fjord open', () => {
    expect(at(232, -100)).toBeLessThan(ENCLOSED_OPENNESS);
    expect(at(228, -104)).toBeLessThan(ENCLOSED_OPENNESS);
    expect(at(600, -600)).toBeGreaterThan(0.6);
    expect(at(1000, -1000)).toBeGreaterThan(0.9);
  });

  it('is deterministic', () => {
    expect(buildOpenness(water, OPENNESS_DIM, OPENNESS_CELL_M)).toEqual(open);
  });
});
