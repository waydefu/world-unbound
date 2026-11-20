import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type Result = {
  command?: string;
  total?: number;
  results?: Array<{ name?: string; at?: string } | string>;
  incomingCount?: number;
  problems?: string[];
  status?: string;
};
const runTool = (file: string, ...args: string[]): Result => {
  const out = spawnSync('node', [file, ...args, '--json'], { encoding: 'utf8', timeout: 30_000 });
  expect(out.status, `${file} ${args.join(' ')}: ${out.stderr}`).toBe(0);
  return JSON.parse(out.stdout) as Result;
};

describe('read-only Agent discovery tools', () => {
  it('locates GrassCells without printing entire source files', () => {
    const data = runTool('tools/agent-index.mjs', 'find', 'GrassCells', '--limit', '5');
    expect(data.command).toBe('find');
    expect(data.results?.some((r) => typeof r !== 'string' && r.at?.startsWith('src/world/grassCells.ts:'))).toBe(true);
    expect(data.results?.length).toBeLessThanOrEqual(5);
  });

  it('resolves incoming calls to GrassCells.select', () => {
    const data = runTool('tools/agent-index.mjs', 'calls', 'select', '--file', 'src/world/grassCells.ts');
    expect(data.command).toBe('calls');
    expect(data.incomingCount).toBeGreaterThan(0);
    expect(data.results?.some((r) => typeof r !== 'string' && r.name?.startsWith('incoming:'))).toBe(true);
  }, 20_000); // TypeScript program analysis can exceed Vitest's default 5s under CI contention.

  it('traces import impact to existing grass tests', () => {
    const data = runTool('tools/agent-index.mjs', 'impact', 'src/world/grassCells.ts');
    expect(data.command).toBe('impact');
    expect(data.results?.some((r) => typeof r === 'string' && r.includes('tests/grass.test.ts'))).toBe(true);
  });

  it('validates internal handoff links without external network', () => {
    const data = runTool('tools/handoff-check.mjs', '--links-only');
    expect(data.status).toBe('ok');
    expect(data.problems).toEqual([]);
  });

  it('covers Git drift, portable paths, symlink escapes, independent call windows and ambiguity', () => {
    const out = spawnSync('node', ['--test', 'tools/agent-core/quality.test.mjs'], { encoding: 'utf8', timeout: 90_000 });
    expect(out.status, `${out.stderr}\n${out.stdout}`).toBe(0);
  }, 45_000);

  it('benchmarks CLI costs without claiming model token usage', () => {
    const out = spawnSync('node', ['tools/agent-benchmark.mjs', '--runs', '1', '--json'], { encoding: 'utf8', timeout: 60_000 });
    expect(out.status, out.stderr).toBe(0);
    const report = JSON.parse(out.stdout) as { kind: string; tasks: Array<{ p50WallMs: number; medianOutputBytes: number }> };
    expect(report.kind).toBe('CLI_EXECUTION_PROXY_NOT_LLM_TOKENS');
    expect(report.tasks.length).toBe(3);
    expect(report.tasks.every((x) => x.p50WallMs > 0 && x.medianOutputBytes > 0)).toBe(true);
  }, 30_000);
});
