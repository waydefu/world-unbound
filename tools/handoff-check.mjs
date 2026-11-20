#!/usr/bin/env node
// Offline, read-only snapshot audit. Does not fetch from GitHub or rewrite files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySnapshot, inside, realInside } from './agent-core/handoff-utils.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (opt) => { const i = args.indexOf(opt); return i < 0 ? null : args[i + 1]; };
const strict = args.includes('--strict');
const json = args.includes('--json');
const linksOnly = args.includes('--links-only');
const maxDays = Math.min(180, Math.max(1, Number(get('--max-days') ?? 14) || 14));
const problems = [];
const warnings = [];
const info = [];
const run = (...cmd) => {
  try { return execFileSync('git', cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const sha = (name) => run('rev-parse', '--verify', name + '^{commit}');
const handoff = readFileSync(join(ROOT, 'docs/HANDOFF.md'), 'utf8');
const recorded = handoff.match(/^Base main:\s*([0-9a-f]{40})\s*$/m)?.[1] ?? null;
const snapshot = handoff.match(/^Snapshot:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null;
const paths = [
  'docs/HANDOFF.md', 'docs/INDEX.md', 'docs/process/agent-workflow.md',
  'docs/architecture/CODE-MAP.md', 'docs/process/index-benchmark.md',
  'CLAUDE.md', 'GEMINI.md',
];
for (const doc of paths) {
  const file = join(ROOT, doc);
  if (!existsSync(file)) { problems.push(`Missing expected document: ${doc}`); continue; }
  const content = readFileSync(file, 'utf8');
  const stripped = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, '');
  for (const m of stripped.matchAll(/!?\[[^\]\n]*\]\(([^)]+)\)/g)) {
    let href = m[1].trim().replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, '').trim().replace(/^<|>$/g, '');
    if (!href || /^(?:https?:|mailto:|data:)/i.test(href) || href[0] === '#') continue;
    try {
      href = decodeURIComponent(href.split('#')[0].split('?')[0]);
      const target = resolve(dirname(file), href);
      if (!inside(ROOT, target) || !existsSync(target) || !realInside(ROOT, target))
        problems.push(`${doc}: broken/escaping local link ${m[1]}`);
    } catch { problems.push(`${doc}: malformed local link ${m[1]}`); }
  }
}
let current = null;
let source = 'unavailable';
let ageDays = null;
let drift = { state: 'not-checked', severity: 'ok', relevant: [] };
if (!linksOnly) {
  if (!snapshot || !Number.isFinite(Date.parse(snapshot + 'T00:00:00Z')))
    problems.push('Snapshot date must be YYYY-MM-DD');
  else {
    ageDays = Math.floor((Date.now() - Date.parse(snapshot + 'T00:00:00Z')) / 86400000);
    if (ageDays < 0) warnings.push('Snapshot date is in the future; check timezone');
    if (ageDays > maxDays) warnings.push(`Snapshot is ${ageDays} days old (max ${maxDays})`);
  }
  if (!recorded) problems.push('Missing full 40-character Base main SHA');
  const userSha = get('--base-sha');
  if (userSha !== null) {
    if (!/^[a-f0-9]{40}$/.test(userSha)) problems.push('--base-sha must be a full 40-character hexadecimal commit SHA');
    else { current = userSha; source = 'explicit'; }
  } else {
    current = sha('refs/remotes/origin/main');
    if (current) source = 'origin/main (local tracking ref; freshness not guaranteed)';
    else {
      current = sha('refs/heads/main');
      if (current) source = 'local main (remote unavailable)';
    }
  }
  if (source.includes('local main')) warnings.push('No origin/main tracking ref; cannot verify remote freshness');
  if (source === 'unavailable') warnings.push('No verified main commit available; provide --base-sha');
  if (recorded && current) {
    const known = sha(recorded);
    const resolvedCurrent = sha(current);
    if (!known || !resolvedCurrent) {
      drift = classifySnapshot({ recorded, current, ancestor: null });
      warnings.push('Recorded/current history missing; shallow checkout, foreign SHA, or unfetched remote');
    } else {
      const checkAncestor = (a, b) => {
        try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: ROOT, stdio: 'ignore' }); return true; }
        catch { return false; }
      };
      const ancestor = checkAncestor(recorded, current);
      const reverseAncestor = !ancestor && checkAncestor(current, recorded);
      let changed = [];
      if (ancestor && recorded !== current) {
        const listing = run('diff', '--name-only', '-z', recorded, current);
        changed = listing ? listing.split('\0').filter(Boolean) : [];
      }
      drift = classifySnapshot({ recorded, current, ancestor, reverseAncestor, files: changed });
      if (drift.severity === 'warning') warnings.push(drift.reason);
      else if (drift.severity === 'info') info.push(drift.reason);
    }
  } else if (recorded || current) {
    drift = classifySnapshot({ recorded, current, ancestor: null });
    warnings.push(drift.reason);
  }
}
const status = problems.length ? 'invalid' : warnings.length ? 'stale-or-unknown' : 'ok';
const result = { status, snapshot, ageDays, baseMain: recorded, observedMain: current, observedSource: source, drift, checkedLinks: paths, problems, warnings, info,
  note: 'Offline only: refs may be stale. Live GitHub PR/Issue/Actions state and phone performance are NOT verified.' };
if (json) console.log(JSON.stringify(result));
else {
  console.log(`handoff-check: ${status}; snapshot=${snapshot ?? 'missing'}; observed=${current?.slice(0, 12) ?? 'unknown'}; drift=${drift.state}`);
  for (const p of problems) console.log('ERROR ' + p);
  for (const w of warnings) console.log('WARN ' + w);
  for (const n of info) console.log('INFO ' + n);
  console.log(result.note);
}
if (strict && (problems.length || warnings.length)) process.exitCode = 1;
