import { beforeAll, describe, expect, it } from 'vitest';
import { buildMultipleScattering, buildTransmittance } from '../src/env/atmosphereLuts';
import { normaliseDay, seasonOf, solarDeclination } from '../src/env/calendar';
import { computeCelestial, createCelestialState, dayLengthHours } from '../src/env/ephemeris';
import { SkyViewBuilder, SV_H, SV_W } from '../src/env/skyView';

const deg = (r: number): number => (r * 180) / Math.PI;

describe('calendar', () => {
  it('maps the 32-day year to seasons and wraps days', () => {
    expect(seasonOf(0)).toBe('spring');
    expect(seasonOf(8)).toBe('summer');
    expect(seasonOf(16)).toBe('autumn');
    expect(seasonOf(31.9)).toBe('winter');
    expect(normaliseDay(-1)).toBe(31);
    expect(normaliseDay(33)).toBe(1);
  });

  it('puts equinoxes and solstices on days 0, 8, 16 and 24', () => {
    expect(deg(solarDeclination(0, 0))).toBeCloseTo(0, 6);
    expect(deg(solarDeclination(8, 0))).toBeCloseTo(23.44, 2);
    expect(deg(solarDeclination(16, 0))).toBeCloseTo(0, 6);
    expect(deg(solarDeclination(24, 0))).toBeCloseTo(-23.44, 2);
  });
});

describe('ephemeris at 62.083 N', () => {
  const state = createCelestialState();

  it('gives the textbook noon altitude 90 - latitude + declination', () => {
    // Declination advances through the day, so use the value at that same noon.
    for (const day of [0, 8, 16, 24]) {
      expect(deg(computeCelestial(day, 12, state).sunAltitude)).toBeCloseTo(90 - 62.083 + deg(solarDeclination(day, 12)), 6);
    }
    // 90 - 62.083 + 23.44 and 90 - 62.083 - 23.44.
    expect(deg(computeCelestial(8, 12, state).sunAltitude)).toBeCloseTo(51.4, 0);
    expect(deg(computeCelestial(24, 12, state).sunAltitude)).toBeCloseTo(4.5, 0);
  });

  it('puts the noon sun due south (+z) and the morning sun in the east (+x)', () => {
    computeCelestial(0, 12, state);
    expect(Math.abs(state.sun[0])).toBeLessThan(1e-9);
    expect(state.sun[2]).toBeGreaterThan(0);
    computeCelestial(0, 9, state);
    expect(state.sun[0]).toBeGreaterThan(0);
  });

  it('has long summer days and short winter days', () => {
    // cos H = -tan(62.083 deg) tan(23.44 deg) => 19.3 h of daylight at the solstice, 4.7 h in winter.
    expect(Math.abs(dayLengthHours(8) - 19.3)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(dayLengthHours(24) - 4.7)).toBeLessThanOrEqual(0.3);
    // Day 0 noon already has declination +2.2 deg (the calendar day starts at the equinox), which at 62 deg adds half an hour.
    expect(Math.abs(dayLengthHours(0) - 12.56)).toBeLessThanOrEqual(0.3);
  });

  it('cycles the moon phase every 8 days', () => {
    expect(computeCelestial(0, 0, state).moonIllumination).toBeCloseTo(0, 6);
    expect(computeCelestial(4, 0, state).moonIllumination).toBeCloseTo(1, 6);
  });
});

describe('atmosphere', () => {
  let sky: SkyViewBuilder;
  beforeAll(() => {
    const trans = buildTransmittance();
    sky = new SkyViewBuilder(trans, buildMultipleScattering(trans));
  });
  const texel = (u: number, v: number): number[] => {
    const k = (Math.round(v * (SV_H - 1)) * SV_W + Math.round(u * (SV_W - 1))) * 4;
    return [sky.data[k], sky.data[k + 1], sky.data[k + 2]];
  };

  it('is finite and non-negative', () => {
    sky.buildNow((30 * Math.PI) / 180, 2);
    for (const v of sky.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a blue zenith and a whiter horizon at midday', () => {
    sky.buildNow((60 * Math.PI) / 180, 2);
    const [r, , b] = texel(0, 1);
    expect(b).toBeGreaterThan(3 * r);
    const [hr, , hb] = texel(0.5, 0.5);
    expect(hb / hr).toBeLessThan(b / r);
    expect(sky.summary.sunTransmittance[0]).toBeGreaterThan(sky.summary.sunTransmittance[2]);
  });

  it('turns the horizon towards the setting sun red', () => {
    sky.buildNow((2 * Math.PI) / 180, 2);
    const [r, g, b] = texel(0, 0.5);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('keeps a blue zenith in nautical twilight (ozone, the blue hour)', () => {
    sky.buildNow((-8 * Math.PI) / 180, 2);
    const [r, , b] = texel(0, 1);
    expect(b).toBeGreaterThan(2 * r);
    expect(sky.summary.sunTransmittance[1]).toBe(0);
  });

  it('builds identically across row budgets (time slicing does not change the result)', () => {
    sky.buildNow((15 * Math.PI) / 180, 2);
    const whole = sky.data.slice();
    sky.start((15 * Math.PI) / 180, 2);
    while (!sky.step(3)) { /* keep slicing */ }
    expect(sky.data).toEqual(whole);
  });
});
