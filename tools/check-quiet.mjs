// Runs the same steps as `npm run check` but prints one line per step plus the tail of any failing step,
// so an agent (or a person) reads a few lines instead of thousands. Exit code = first failing step's.
// Usage: npm run check:quiet            (add -- --no-visual to skip the headless visual audit)
import { spawnSync } from 'node:child_process';

const skipVisual = process.argv.includes('--no-visual');
const steps = [
  ['lint', 'npm', ['run', '-s', 'lint']],
  ['typecheck', 'npm', ['run', '-s', 'typecheck']],
  ['test', 'npx', ['vitest', 'run', '--reporter=dot']],
  ['build', 'npm', ['run', '-s', 'build']],
  ['audit', 'node', ['scripts/audit.mjs']],
  ...(skipVisual ? [] : [['audit:visual', 'node', ['scripts/audit-visual.mjs', '--skip-build']]]),
];
for (const [name, cmd, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.log(`FAIL ${name} (${secs} s, exit ${r.status})`);
    console.log(out.slice(-40).join('\n'));
    process.exit(r.status ?? 1);
  }
  const summary = out.filter((l) => /Tests |PASS|passed|No fixes|built in/.test(l)).slice(-1)[0] ?? '';
  console.log(`ok   ${name} (${secs} s) ${summary.replace(/\x1b\[[0-9;]*m/g, '').trim()}`);
}
