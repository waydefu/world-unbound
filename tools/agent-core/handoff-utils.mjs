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

// Agent-only tests and the Node typing shim do not alter game acceptance.
// Classify these separately instead of flagging a docs/tooling squash merge as game-state drift.
export const agentToolingPath = (file) => /^(?:tools\/(?:agent-|handoff-check)|tests\/agent(?:Tooling|[-_/])|tests\/setup\/node-modules\.d\.ts|CLAUDE\.md$|GEMINI\.md$|docs\/architecture\/CODE-MAP\.md$|docs\/process\/index-benchmark\.md$)/.test(file);
export const relevantPath = (file) => !agentToolingPath(file) && (
  /^(src\/|spike\/|assets\/|tests\/|governance\/|\.github\/|\.claude\/|scripts\/|docs\/(?:specs|adr|contracts|governance|release-policy)\/)/.test(file)
  || ['AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(file)
);

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
  const tooling = files.filter(agentToolingPath).sort();
  if (tooling.length) {
    return { state: 'advanced-agent-tooling', severity: 'info', reason: 'Agent tooling/docs/tests advanced without a detected game-state change; verify the tooling contract and live PR/Issue states.', relevant: [], tooling };
  }
  return { state: 'advanced-docs-only', severity: 'info', reason: 'Main advanced without detected material state changes; GitHub Issues/PRs still require live verification.', relevant: [] };
};
