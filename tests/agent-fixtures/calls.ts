export class CallFixture {
  step(n: number): number { return this.leaf(n); }
  private leaf(n: number): number { return n + 1; }
}
export function firstCaller(value: CallFixture): number { return value.step(1); }
export function secondCaller(value: CallFixture): number { return value.step(2); }
export const arrowCaller = (value: CallFixture): number => value.step(4);
export function overloadStep(n: number): number;
export function overloadStep(n: string): number;
export function overloadStep(n: number | string): number { return Number(n) + 1; }
