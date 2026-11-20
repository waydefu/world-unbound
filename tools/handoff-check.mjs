#!/usr/bin/env node
// Read-only local handoff audit. PR state is never guessed from the network.
// Usage: node tools/handoff-check.mjs [--json] [--strict] [--base-sha SHA] [--links-only]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const strict = args.includes('--strict');
const json = args.includes('--json');
const linksOnly = args.includes('--links-only');
const ageLimit = Math.min(180, Math.max(1, Number(option('--max-days') ?? 14) || 14));
const handoff = readFileSync(join(ROOT, 'docs/HANDOFF.md'), 'utf8');
const problems = [];
const warnings = [];
const date = handoff.match(/^Snapshot:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
const recorded = handoff.match(/^Base main:\s*([0-9a-f]{7,40})/m)?.[1] ?? null;
let ageDays = null;
let actual = null;

for (const doc of ['docs/HANDOFF.md', 'docs/INDEX.md', 'docs/process/agent-workflow.md']) {
  const content = readFileSync(join(ROOT, doc), 'utf8');
  const matches = content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of matches) {
    const target = match[1].split('#')[0].split('?')[0];
    if (!target || /^(https?:|mailto:|data:)/i.test(target)) continue;
    const path = resolve(ROOT, dirname(doc), decodeURIComponent(target));
    if (!path.startsWith(`${ROOT}/`) || !existsSync(path)) problems.push(`${doc}: broken local link ${match[1]}`);
  }
}
if (!linksOnly) {
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) problems.push('Snapshot date is missing or invalid');
  else {
    ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    if (ageDays < 0) warnings.push('Snapshot date is in the future (check timezone)');
    if (ageDays > ageLimit) warnings.push(`Snapshot is ${ageDays} days old (threshold ${ageLimit})`);
  }
  if (!recorded) problems.push('Missing Base main: <sha> line in HANDOFF.md');
  const supplied = option('--base-sha');
  if (supplied && !/^[0-9a-f]{7,40}$/.test(supplied)) problems.push('Invalid --base-sha value');
  else if (supplied) actual = supplied;
  else {
    for (const command of [['merge-base', 'HEAD', 'origin/main'], ['rev-parse', 'refs/heads/main']]) {
      try {
        actual = execFileSync('git', command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        break;
      } catch { /* Missing local ref is normal in a shallow checkout. */ }
    }
  }
  if (!actual) warnings.push('Cannot resolve local main base; supply --base-sha to verify freshness');
  if (recorded && actual && !actual.startsWith(recorded) && !recorded.startsWith(actual)) {
    warnings.push(`Base main drift: handoff ${recorded.slice(0, 12)} vs checkout ${actual.slice(0, 12)}`);
  }
}
const result = {
  snapshot: date,
  baseMain: recorded,
  observedMain: actual,
  ageDays,
  checkedLinks: ['docs/HANDOFF.md', 'docs/INDEX.md', 'docs/process/agent-workflow.md'],
  problems,
  warnings,
  status: problems.length ? 'invalid' : warnings.length ? 'stale-or-unknown' : 'ok',
  note: 'Offline check only. Remote PR/Issue status and real phone GPU evidence require separate verification.',
};
if (json) console.log(JSON.stringify(result));
else {
  console.log(`handoff-check: ${result.status}; snapshot=${date ?? 'missing'}; base=${recorded ?? 'missing'}; observed=${actual ?? 'unknown'}`);
  for (const line of problems) console.log(`ERROR ${line}`);
  for (const line of warnings) console.log(`WARN  ${line}`);
  console.log(result.note);
}
if (strict && (problems.length || warnings.length)) process.exitCode = 1;
