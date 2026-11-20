/** Sample B, Festuca rubra, from the user-reviewed specimen in PR #31 (c9025b9). Metres. */
export const FESCUE_LEAVES = [
  [82, 0.059, 0.052, 0.121, 0.00093, 0.75],
  [204, 0.054, 0.018, 0.098, 0.00095, 0.80],
  [321, 0.046, 0.061, 0.119, 0.00072, 0.65],
  [152, 0.033, 0.077, 0.105, 0.00078, 0.82],
  [23, 0.057, 0.019, 0.070, 0.00089, 0.74],
  [257, 0.054, 0.015, 0.068, 0.00067, 0.83],
  [112, 0.026, 0.104, 0.113, 0.00073, 0.72],
] as const;

export const FESCUE_COLOURS = [[0.102, 0.212, 0.037], [0.071, 0.151, 0.030], [0.144, 0.248, 0.060]] as const;

/** (reach, height, half-width) of the original cubic ribbon, before its cross-section roll. */
export function fescueProfile(leaf: typeof FESCUE_LEAVES[number], t: number): [number, number, number] {
  const [, run, tip, crest, width] = leaf;
  const s = 1 - t;
  const reach = run * (0.18 * s * s * t + 1.74 * s * t * t + t ** 3);
  const y = crest * (1.86 * s * s * t + 3 * s * t * t) + tip * t ** 3;
  const half = width * (0.47 + 0.6 * Math.sin(Math.PI * t)) * s ** 0.63 / 2;
  return [reach, y, half];
}
