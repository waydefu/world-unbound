/**
 * The game calendar: a 32-day year of four 8-day astronomical seasons
 * (specification §4.2). Day 0 starts at the March equinox, day 8 is the
 * summer solstice, day 16 the September equinox, day 24 the winter solstice.
 * A game day maps to 1/32 of a real year for solar geometry.
 */
export const DAYS_PER_YEAR = 32;
export const DAYS_PER_SEASON = 8;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** Earth's axial tilt in radians. */
export const OBLIQUITY = (23.44 * Math.PI) / 180;

/** Wraps any day number into [0, 32). */
export function normaliseDay(day: number): number {
  const d = day % DAYS_PER_YEAR;
  return d < 0 ? d + DAYS_PER_YEAR : d;
}

export function seasonOf(day: number): Season {
  return SEASONS[Math.floor(normaliseDay(day) / DAYS_PER_SEASON)];
}

/** Fraction of the year elapsed since the March equinox, from day and solar hour. */
export function yearFraction(day: number, hour: number): number {
  return (normaliseDay(day) + hour / 24) / DAYS_PER_YEAR;
}

/** Solar declination in radians (circular-orbit approximation). */
export function solarDeclination(day: number, hour: number): number {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(2 * Math.PI * yearFraction(day, hour)));
}
