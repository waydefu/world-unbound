import { describe, expect, it } from 'vitest';
import { waveSet } from '../src/env/ocean';
import { WEATHERS } from '../src/env/weather';
import { WORLD_MAX, WORLD_MIN } from '../src/world/constants';
import { heightAt } from '../src/world/heightField';
import { SEAFLOOR_DIM, SEAFLOOR_RES, buildSeaFloor } from '../src/world/seaFloor';

describe('waveSet', () => {
  it('returns four unit-direction waves with non-looping steepness for every weather', () => {
    for (const weather of WEATHERS) {
      const waves = waveSet(weather);
      expect(waves).toHaveLength(4);
      let sum = 0;
      for (const w of waves) {
        expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 12);
        expect(w.dirZ).toBeGreaterThan(0);
        const k = (2 * Math.PI) / w.wavelength;
        sum += w.steepness * k * w.amplitude;
        expect(w.steepness).toBeLessThanOrEqual(1);
        expect(Math.abs(w.speed - Math.sqrt((9.81 * w.wavelength) / (2 * Math.PI)))).toBeLessThan(1e-9);
      }
      expect(sum).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });

  it('grows amplitude with weather severity and is allocation-free', () => {
    const clear = waveSet('clear');
    const storm = waveSet('storm');
    for (let i = 0; i < 4; i++) expect(storm[i].amplitude).toBeGreaterThan(clear[i].amplitude);
    expect(waveSet('rain')).toBe(waveSet('rain'));
  });
});

describe('buildSeaFloor', () => {
  const floor = buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
  const centre = (i: number): number => WORLD_MIN + (i + 0.5) * SEAFLOOR_RES;

  it('has the documented size and is deterministic', () => {
    expect(floor.length).toBe(SEAFLOOR_DIM * SEAFLOOR_DIM);
    expect(SEAFLOOR_DIM).toBe(512);
    const again = buildSeaFloor(new Float32Array(SEAFLOOR_DIM * SEAFLOOR_DIM));
    expect(again).toEqual(floor);
  });

  it('matches heightAt at texel centres', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % SEAFLOOR_DIM;
    };
    for (let n = 0; n < 20; n++) {
      const i = next();
      const j = next();
      expect(Math.abs(floor[j * SEAFLOOR_DIM + i] - heightAt(centre(i), centre(j)))).toBeLessThan(1e-6);
    }
    expect(WORLD_MAX - WORLD_MIN).toBe(SEAFLOOR_DIM * SEAFLOOR_RES);
  });

  it('is deep water far to the north and dry land at the town centre', () => {
    const mid = SEAFLOOR_DIM / 2;
    expect(floor[2 * SEAFLOOR_DIM + mid]).toBeLessThan(-2);
    expect(floor[mid * SEAFLOOR_DIM + mid]).toBeGreaterThan(2);
  });
});
