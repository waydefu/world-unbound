import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('GitHub development environment', () => {
  it('defines a reproducible, lightweight Node 22 setup', () => {
    const config = JSON.parse(read('.devcontainer/devcontainer.json')) as {
      features: Record<string, { version: string }>;
      postCreateCommand: string;
    };
    expect(config.features['ghcr.io/devcontainers/features/node:1']?.version).toBe('22');
    expect(config.postCreateCommand).toBe('bash .devcontainer/setup-tools.sh');
    const script = read('.devcontainer/setup-tools.sh');
    for (const dependency of ['ripgrep', 'fd-find', 'jq']) expect(script).toContain(dependency);
    expect(script).not.toContain('npm ci');
    expect(script).not.toContain('playwright install');
  });

  it('keeps agent entrypoints subordinate to AGENTS.md', () => {
    for (const entry of ['CLAUDE.md', 'GEMINI.md']) {
      expect(read(entry)).toContain('AGENTS.md');
    }
  });

  it('does not accidentally invite sensitive local files into version control', () => {
    const ignore = read('.gitignore');
    for (const pattern of ['*.db', '*.sqlite', '*.jsonl', '.codex/', '.gemini/', '.env']) {
      expect(ignore).toContain(pattern);
    }
  });
});
