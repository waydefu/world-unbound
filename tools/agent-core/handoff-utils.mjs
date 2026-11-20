// Pure helpers: Git snapshot classification and cross-platform repository boundaries.
// Used by the CLI and by fixture-based regressions; never access a network.
import path from 'node:path';
import { realpathSync } from 'node:fs';

export const inside = (root, candidate, mod = path) => {
  const rel = mod.relative(mod.resolve(root), mod.resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${mod.sep}`) && !mod.isAbsolute(rel));
};

export const realInside = (root, candidate) => {
  try {
    return inside(realpathSync(root), realpathSync(candidate));
  } catch {
    return false;
  }
};

export const relevantPath = (file) => /^(src\/|assets\/|tests\/|governance\/|\.github\/|scripts\/|docs\/(?:specs|adr|contracts)\/)/.test(file)
  || ['AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(file);

export const classifySnapshot = ({ recorded, current, ancestor, reverseAncestor = false, files = [] }) => {
  if (!recorded || !current || ancestor === null) {
    return { state: 'unknown', severity: 'warning', reason: 'A base or reachable Git history is unavailable; current GitHub state is not proven.', relevant: [] };
  }
  if (recorded === current) {
    return { state: 'at-base', severity: 'ok', reason: 'Recorded SHA equals the available main ref (not verified against the remote server).', relevant: [] };
  }
  if (!ancestor) {
    return { state: reverseAncestor ? 'recorded-ahead' : 'diverged', severity: 'warning', reason: 'Recorded commit is not an ancestor of the observed main; inspect Git history.', relevant: [] };
  }
  const relevant = files.filter(relevantPath).sort();
  if (relevant.length) {
    return { state: 'review-required', severity: 'warning', reason: 'Potentially relevant files changed since the snapshot; do not presume the handoff remains valid.', relevant };
  }
  return { state: 'advanced-docs-only', severity: 'info', reason: 'Main advanced without tracked runtime/governance/spec/test changes; GitHub Issues/PRs still require live verification.', relevant: [] };
};
