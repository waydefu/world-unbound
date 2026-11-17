/**
 * Logical memory accounting in four partitions. These are engine-side
 * estimates of what we allocated, not measurements of browser/driver memory.
 * A buffer shared by several owners must be registered once.
 */
export const MemoryPartition = {
  Gpu: 0,
  CpuRetained: 1,
  Staging: 2,
  Wasm: 3,
} as const;
export type MemoryPartitionId = (typeof MemoryPartition)[keyof typeof MemoryPartition];
export const PARTITION_NAMES = ['gpu', 'cpuRetained', 'staging', 'wasm'] as const;

const MIB = 1024 * 1024;
/** Mobile engineering budgets in MiB: gpu / cpuRetained / staging / wasm. */
export const BUDGET_BALANCED = [192, 128, 64, 64] as const;
export const BUDGET_HIGH = [320, 192, 96, 96] as const;

export const Pressure = { Ok: 0, Reclaim: 1, Full: 2 } as const;
export type PressureLevel = (typeof Pressure)[keyof typeof Pressure];

export class MemoryRegistry {
  readonly used = new Float64Array(4);
  readonly peak = new Float64Array(4);
  readonly budget = new Float64Array(4);

  constructor(budgetMiB: readonly number[]) {
    for (let i = 0; i < 4; i++) this.budget[i] = budgetMiB[i] * MIB;
  }

  add(partition: MemoryPartitionId, bytes: number): void {
    this.used[partition] += bytes;
    if (this.used[partition] > this.peak[partition]) this.peak[partition] = this.used[partition];
  }

  remove(partition: MemoryPartitionId, bytes: number): void {
    this.used[partition] -= bytes;
    if (this.used[partition] < 0) throw new Error(`memory partition ${PARTITION_NAMES[partition]} went negative`);
  }

  ratio(partition: MemoryPartitionId): number {
    return this.used[partition] / this.budget[partition];
  }

  /** 80 % => reclaim distant/LRU resources; 100 % => no new non-essential residents. */
  pressure(partition: MemoryPartitionId): PressureLevel {
    const r = this.ratio(partition);
    return r >= 1 ? Pressure.Full : r >= 0.8 ? Pressure.Reclaim : Pressure.Ok;
  }

  /** Worst pressure across all partitions. */
  worstPressure(): PressureLevel {
    let worst: PressureLevel = Pressure.Ok;
    for (let i = 0; i < 4; i++) {
      const p = this.pressure(i as MemoryPartitionId);
      if (p > worst) worst = p;
    }
    return worst;
  }

  snapshot(): Record<string, { usedMiB: number; peakMiB: number; budgetMiB: number }> {
    const out: Record<string, { usedMiB: number; peakMiB: number; budgetMiB: number }> = {};
    for (let i = 0; i < 4; i++) {
      out[PARTITION_NAMES[i]] = {
        usedMiB: round2(this.used[i] / MIB),
        peakMiB: round2(this.peak[i] / MIB),
        budgetMiB: this.budget[i] / MIB,
      };
    }
    return out;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
