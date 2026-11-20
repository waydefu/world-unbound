import type { CallFixture as RenamedFixture } from './calls';
export function aliasCaller(value: RenamedFixture): number { return value.step(3); }
import { overloadStep } from './calls';
export { overloadStep } from './calls';
export function useOverload(): number { return overloadStep(5); }
export const loadDynamic = (flag: boolean) => (flag ? import('./calls') : new Worker('./worker.js'));
