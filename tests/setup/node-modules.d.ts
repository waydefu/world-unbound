// The repository has no @types/node (no new dependencies). These are the only Node
// APIs the tests use: reading committed fixtures, inflating data, and CLI smoke checks.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function statSync(path: string): { size: number };
}
declare module 'node:path' {
  const path: { resolve(...parts: string[]): string; dirname(p: string): string; join(...parts: string[]): string };
  export default path;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}
declare module 'node:zlib' {
  export function inflateRawSync(data: Uint8Array): Uint8Array;
}

declare module 'node:child_process' {
  export function spawnSync(command: string, args: string[], options?: {
    encoding?: 'utf8'; timeout?: number;
  }): { status: number | null; stdout: string; stderr: string };
}
