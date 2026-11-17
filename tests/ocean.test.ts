import { describe, expect, it } from 'vitest';
import { waveSet } from '../src/env/ocean';
import { WEATHERS } from '../src/env/weather';
import { TOWN_X, TOWN_Z, WORLD_MAX, WORLD_MIN } from '../src/world/constants';
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
    expect(SEAFLOOR_DIM).toBe(1024);
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
      // The map stores f32: compare against the f32 rounding of heightAt (terrain now reaches 1050 m, where one f32 step is 1e-4).
      expect(Math.abs(floor[j * SEAFLOOR_DIM + i] - Math.fround(heightAt(centre(i), centre(j))))).toBeLessThan(1e-6);
    }
    expect(WORLD_MAX - WORLD_MIN).toBe(SEAFLOOR_DIM * SEAFLOOR_RES);
  });

  it('is deep fjord water in the north-east and dry land at the village centre', () => {
    const texel = (v: number): number => Math.floor((v - WORLD_MIN) / SEAFLOOR_RES);
    expect(floor[texel(-1500) * SEAFLOOR_DIM + texel(1500)]).toBeLessThan(-2);
    expect(floor[texel(TOWN_Z) * SEAFLOOR_DIM + texel(TOWN_X)]).toBeGreaterThan(0.5);
  });
});
