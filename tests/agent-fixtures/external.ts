import type { CallFixture as RenamedFixture } from './calls';
export function aliasCaller(value: RenamedFixture): number { return value.step(3); }
