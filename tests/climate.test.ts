import { describe, expect, it } from 'vitest';
import {
  BASE_WIND_MS, computeClimate, createClimateState, temperatureAtAltitude, vegetationSeason, windFromDeg,
} from '../src/env/climate';
import { WEATHERS } from '../src/env/weather';
import { createLocalWind, localWind, windDirX, windDirZ } from '../src/env/wind';
import { WindTexture, WIND_BYTES, WIND_TEXELS, WIND_CELL_M } from '../src/render/windTexture';
import { DataUtils } from 'three/webgpu';

const SEED = 0x5a17a1d;

describe('climate state', () => {
  it('is a pure function of its inputs', () => {
    const a = computeClimate(SEED, 123456.7, 'rain', 12.3, createClimateState());
    const b = computeClimate(SEED, 123456.7, 'rain', 12.3, createClimateState());
    expect(a).toEqual(b);
    const other = computeClimate(SEED + 1, 123456.7, 'rain', 12.3, createClimateState());
    expect(other.windDirRad).not.toBe(a.windDirRad);
  });

  it('stays in range for every weather over a week of game time', () => {
    const c = createClimateState();
    for (const weather of WEATHERS) {
      for (let t = 0; t < 7 * 86400; t += 997) {
        computeClimate(SEED, t, weather, (t / 86400) % 32, c);
        expect(c.season01).toBeGreaterThanOrEqual(0);
        expect(c.season01).toBeLessThan(1);
        expect(c.windDirRad).toBeGreaterThanOrEqual(0);
        expect(c.windDirRad).toBeLessThan(2 * Math.PI);
        expect(c.windSpeedMs).toBeGreaterThanOrEqual(BASE_WIND_MS[weather] * 0.75 - 1e-9);
        expect(c.windSpeedMs).toBeLessThanOrEqual(BASE_WIND_MS[weather] * 1.25 + 1e-9);
        expect(c.gust01).toBeGreaterThanOrEqual(0);
        expect(c.gust01).toBeLessThanOrEqual(1);
        expect(c.temperatureC).toBeGreaterThan(-12);
        expect(c.temperatureC).toBeLessThan(25);
        expect(windFromDeg(c)).toBeGreaterThanOrEqual(0);
        expect(windFromDeg(c)).toBeLessThan(360);
      }
    }
  });

  it('orders the weather states by wind speed and the seasons by temperature', () => {
    const mean = (weather: (typeof WEATHERS)[number]): number => {
      const c = createClimateState();
      let sum = 0;
      for (let t = 0; t < 86400; t += 600) sum += computeClimate(SEED, t, weather, 5, c).windSpeedMs;
      return sum / 144;
    };
    expect(mean('clear')).toBeLessThan(mean('cloudy'));
    expect(mean('cloudy')).toBeLessThan(mean('rain'));
    expect(mean('rain')).toBeLessThan(mean('storm'));
    const day = (d: number): number => {
      let sum = 0;
      for (let h = 0; h < 24; h++) sum += computeClimate(SEED, (d * 24 + h) * 3600, 'clear', d, createClimateState()).temperatureC;
      return sum / 24;
    };
    expect(day(10.3)).toBeGreaterThan(day(26.3) + 10);
    // Seasonal means (July 15 C, January 0 C) plus the +-1.5 C front noise and the weather offset.
    expect(Math.abs(day(10.3) - 15)).toBeLessThan(2);
    expect(Math.abs(day(26.3) - 0)).toBeLessThan(2);
  });

  it('changes smoothly: consecutive seconds never jump', () => {
    const a = createClimateState();
    const b = createClimateState();
    let maxDir = 0;
    let maxSpeed = 0;
    let maxGust = 0;
    let maxTemp = 0;
    for (let t = 1000; t < 1000 + 3 * 3600; t++) {
      computeClimate(SEED, t, 'cloudy', 8, a);
      computeClimate(SEED, t + 1, 'cloudy', 8, b);
      let dd = Math.abs(a.windDirRad - b.windDirRad);
      if (dd > Math.PI) dd = 2 * Math.PI - dd;
      maxDir = Math.max(maxDir, dd);
      maxSpeed = Math.max(maxSpeed, Math.abs(a.windSpeedMs - b.windSpeedMs));
      maxGust = Math.max(maxGust, Math.abs(a.gust01 - b.gust01));
      maxTemp = Math.max(maxTemp, Math.abs(a.temperatureC - b.temperatureC));
    }
    expect(maxDir).toBeLessThan(0.002);
    expect(maxSpeed).toBeLessThan(0.05);
    expect(maxGust).toBeLessThan(0.5);
    expect(maxTemp).toBeLessThan(0.01);
  });

  it('gusts vary over seconds while the direction holds for minutes', () => {
    const c = createClimateState();
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 600; t++) {
      const g = computeClimate(SEED, t, 'clear', 6, c).gust01;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
    const d0 = computeClimate(SEED, 0, 'clear', 6, createClimateState()).windDirRad;
    const d1 = computeClimate(SEED, 600, 'clear', 6, createClimateState()).windDirRad;
    expect(Math.abs(d1 - d0)).toBeLessThan(0.3);
  });

  it('lapses 6.5 C per kilometre', () => {
    expect(temperatureAtAltitude(10, 1000)).toBeCloseTo(3.5, 9);
    expect(temperatureAtAltitude(10, 0)).toBe(10);
  });

  it('vegetation season weights sum to one, start spring-fresh at the default day and turn to straw in autumn', () => {
    const w = new Float32Array(3);
    for (let s = 0; s <= 1; s += 0.01) {
      vegetationSeason(s, w);
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 5);
      expect(Math.min(w[0], w[1], w[2])).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(Array.from(vegetationSeason(6 / 32, w))).toEqual([1, 0, 0]);
    expect(vegetationSeason(0.4, w)[1]).toBeCloseTo(1, 5);
    expect(vegetationSeason(0.75, w)[2]).toBeCloseTo(1, 5);
  });
});

describe('local wind and channelling', () => {
  const out = createLocalWind();
  const dirOf = (rad: number): [number, number] => [windDirX(rad), windDirZ(rad)];

  it('uses compass bearings: towards north is -z, towards east is +x', () => {
    expect(windDirX(0)).toBeCloseTo(0, 12);
    expect(windDirZ(0)).toBeCloseTo(-1, 12);
    expect(windDirX(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(windDirZ(Math.PI / 2)).toBeCloseTo(0, 12);
  });

  it('leaves the global wind alone in the open', () => {
    const [dx, dz] = dirOf(1);
    localWind(6, dx, dz, 1, 0, 1, 1, out);
    expect(out.x).toBeCloseTo(dx * 6, 9);
    expect(out.z).toBeCloseTo(dz * 6, 9);
    expect(out.shelter).toBeCloseTo(1, 9);
  });

  it('turns the wind towards a synthetic valley axis, whichever way the axis points', () => {
    // Valley along x; wind blowing 60 degrees off it, towards +x and +z.
    const angle = (60 * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const offAxis = (): number => Math.abs(Math.atan2(out.z, out.x));
    localWind(5, dx, dz, 1, 0, 1, 0.9, out);
    const weak = offAxis();
    localWind(5, dx, dz, 1, 0, 1, 0.2, out);
    const strong = offAxis();
    localWind(5, dx, dz, 1, 0, 1, 0, out);
    const full = offAxis();
    expect(weak).toBeLessThan(angle);
    expect(strong).toBeLessThan(weak);
    expect(full).toBeLessThan(1e-9);
    expect(out.x).toBeGreaterThan(0);
    // The sign of the axis is irrelevant: -x gives the same result.
    localWind(5, dx, dz, -1, 0, 1, 0.2, out);
    expect(offAxis()).toBeCloseTo(strong, 9);
    expect(out.x).toBeGreaterThan(0);
    // A wind blowing the other way along the axis is channelled to -x.
    localWind(5, -dx, -dz, 1, 0, 1, 0, out);
    expect(out.x).toBeLessThan(0);
  });

  it('shelters enclosed points and cross-valley wind more than open ones', () => {
    localWind(5, 1, 0, 1, 0, 1, 0, out);
    const along = out.shelter;
    localWind(5, 0, 1, 1, 0, 1, 0, out);
    const across = out.shelter;
    localWind(5, 0, 1, 1, 0, 1, 1, out);
    expect(across).toBeLessThan(along);
    expect(along).toBeLessThan(out.shelter);
    expect(out.shelter).toBe(1);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(5, 9);
  });

  it('is finite for degenerate inputs (no axis, wind across a fully channelled valley)', () => {
    localWind(5, 0, 1, 1, 0, 1, 0, out);
    expect(Number.isFinite(out.x) && Number.isFinite(out.z)).toBe(true);
    localWind(5, 1, 0, 0, 0, 0, 0.5, out);
    expect(Math.hypot(out.x, out.z)).toBeGreaterThan(0);
  });
});

describe('wind texture', () => {
  const toFloat = (h: number): number => DataUtils.fromHalfFloat(h);
  const climate = computeClimate(SEED, 5000, 'rain', 6, createClimateState());

  it('is 64 x 64 half floats (32 KiB) and refreshes at most ten times a second', () => {
    const wind = new WindTexture(null);
    expect(WIND_BYTES).toBe(WIND_TEXELS * WIND_TEXELS * 8);
    expect(wind.update(1000, 0, 0, climate)).toBe(true);
    expect(wind.update(1050, 0, 0, climate)).toBe(false);
    expect(wind.update(1100, 0, 0, climate)).toBe(true);
    expect(wind.updates).toBe(2);
  });

  it('writes the climate wind everywhere without a channel, and is independent of where the toroidal window starts', () => {
    const data = (wind: WindTexture): Uint16Array => wind.texture.image.data as unknown as Uint16Array;
    const a = new WindTexture(null);
    a.update(0, 100, -300, climate);
    const speed = Math.hypot(toFloat(data(a)[0]), toFloat(data(a)[1]));
    expect(speed).toBeCloseTo(climate.windSpeedMs, 1);
    // A camera one cell further east: one column of texels swaps its world cell (only the gust phase, which
    // depends on position, differs); every other texel holds the same value for the same cell.
    const b = new WindTexture(null);
    b.update(0, 100 + WIND_CELL_M, -300, climate);
    let differing = 0;
    for (let k = 0; k < data(a).length; k++) {
      if (data(a)[k] === data(b)[k]) continue;
      differing++;
      expect(k % 4).toBe(2);
    }
    expect(differing).toBeLessThanOrEqual(WIND_TEXELS);
  });

  it('applies the channel: wind in a channelled cell is rotated and sheltered', () => {
    // Uniform map: axis along x (double angle 0 -> (1, 0)), enclosed (openness 0.1), fully coherent.
    const map = new Float32Array(256 * 256 * 4);
    for (let k = 0; k < 256 * 256; k++) {
      map[k * 4] = 1;
      map[k * 4 + 2] = 0.1;
    }
    const open = new WindTexture(null);
    const channelled = new WindTexture(map);
    open.update(0, 0, 0, climate);
    channelled.update(0, 0, 0, climate);
    const d = (w: WindTexture): number[] => Array.from(w.texture.image.data as unknown as Uint16Array).map(toFloat);
    const o = d(open);
    const c = d(channelled);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(Math.hypot(o[0], o[1]));
    expect(Math.abs(c[1] / c[0])).toBeLessThan(Math.abs(o[1] / o[0]) + 1e-6);
    expect(c[3]).toBeLessThan(1);
  });
});
