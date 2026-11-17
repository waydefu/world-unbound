#!/usr/bin/env node
/**
 * Static quality guard. Run after every milestone step (npm run audit).
 *
 *  1. File length: no source file over 350 lines.
 *  2. Deploy-safe paths: no root-absolute asset/worker URLs (GitHub Pages
 *     serves the site under /world-unbound/).
 *  3. Module boundaries: src/world and src/perf are pure (no three.js, no DOM);
 *     src/render never imports src/ui.
 *  4. Platform bans: no SharedArrayBuffer dependency, no GPU->CPU readback.
 *  5. Frame-loop allocations: functions tagged @hot must not allocate, and
 *     may only call project functions that are @hot or @amortized. Every
 *     animation-loop callback must be @hot.
 *  6. Release size budget (when dist/ exists): at most 150 MB.
 *
 * Rule 5 is a syntactic check of project code. It cannot see allocations made
 * inside three.js or the browser, and it is not a substitute for profiling.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINES = 350;
const DIST_BUDGET_BYTES = 150 * 1024 * 1024;
const errors = [];
const fail = (file, line, message) => errors.push(`${path.relative(root, file)}${line ? `:${line}` : ''}: ${message}`);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = walk(path.join(root, 'src')).filter((f) => /\.(ts|css)$/.test(f));
const checkedFiles = [
  ...sourceFiles,
  ...walk(path.join(root, 'scripts')).filter((f) => f.endsWith('.mjs')),
  ...walk(path.join(root, 'tests')).filter((f) => f.endsWith('.ts')),
  ...walk(path.join(root, 'spike')).filter((f) => /\.(ts|html)$/.test(f)),
  path.join(root, 'index.html'),
  path.join(root, 'vite.config.ts'),
];

// 1. File length ------------------------------------------------------------
for (const file of checkedFiles) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > MAX_LINES) fail(file, 0, `${lines} lines exceeds the ${MAX_LINES}-line limit`);
}

// 2-4. Text rules -----------------------------------------------------------
const PATH_RULES = [
  [/['"`]\/(assets|src|public|world-unbound)\//, 'root-absolute project path; use a relative URL or new URL(..., import.meta.url)'],
  [/\b(fetch|importScripts)\(\s*['"`]\//, 'root-absolute request path'],
  [/new\s+(Shared)?Worker\(\s*['"`]/, 'worker URL must be new URL(..., import.meta.url)'],
  [/new\s+URL\(\s*['"`]\//, 'root-absolute URL; resolve relative to import.meta.url'],
];
const PURE_DIRS = ['world', 'perf', 'env'];
const DOM_GLOBALS = /\b(document|window|navigator|localStorage|requestAnimationFrame)\b/;

for (const file of sourceFiles.filter((f) => f.endsWith('.ts'))) {
  const rel = path.relative(path.join(root, 'src'), file).split(path.sep);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const code = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\/\*.*?\*\//g, '');
    for (const [pattern, message] of PATH_RULES) if (pattern.test(code)) fail(file, i + 1, message);
    if (/\bSharedArrayBuffer\b/.test(code) && rel.join('/') !== 'platform/capabilities.ts') {
      fail(file, i + 1, 'SharedArrayBuffer must not be relied on (GitHub Pages cannot send COOP/COEP)');
    }
    if (/\.mapAsync\(|readRenderTargetPixels/.test(code)) fail(file, i + 1, 'GPU->CPU readback is not allowed in runtime code');
    const imported = /\bfrom\s+['"]([^'"]+)['"]/.exec(code)?.[1] ?? /\bimport\s+['"]([^'"]+)['"]/.exec(code)?.[1];
    if (PURE_DIRS.includes(rel[0])) {
      if (DOM_GLOBALS.test(code)) fail(file, i + 1, `src/${rel[0]} must stay free of DOM globals`);
      if (imported && (!imported.startsWith('./') || imported.includes('..'))) {
        fail(file, i + 1, `src/${rel[0]} may only import from its own directory (found "${imported}")`);
      }
    }
    if (rel[0] === 'render' && imported && /\/ui\//.test(imported)) fail(file, i + 1, 'src/render must not import src/ui');
  });
}

const html = readFileSync(path.join(root, 'index.html'), 'utf8');
html.split('\n').forEach((line, i) => {
  if (/\b(src|href)=["']\/(?!\/)/.test(line)) fail(path.join(root, 'index.html'), i + 1, 'root-absolute URL in index.html');
});

// 5. Frame-loop allocations -------------------------------------------------
const tsFiles = sourceFiles.filter((f) => f.endsWith('.ts'));
const program = ts.createProgram(tsFiles, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: ['vite/client', '@webgpu/types'],
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.webworker.d.ts'],
});
const checker = program.getTypeChecker();
const srcRoot = path.join(root, 'src') + path.sep;
const isFunctionLike = (n) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n)
  || ts.isFunctionExpression(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);

/** JSDoc tags of a function, including the property/variable it is assigned to. */
function tagsOf(node) {
  const names = new Set(ts.getJSDocTags(node).map((t) => t.tagName.text));
  const host = node.parent;
  if (host && (ts.isPropertyDeclaration(host) || ts.isVariableDeclaration(host))) {
    const owner = ts.isVariableDeclaration(host) ? host.parent.parent : host;
    for (const t of ts.getJSDocTags(owner)) names.add(t.tagName.text);
  }
  return names;
}
const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
const describe = (node) => (node.name?.getText?.() ?? node.parent?.name?.getText?.() ?? '<anonymous>');

/** Resolves a callee or callback expression to its function-like declaration in src/, if any. */
function projectDeclaration(expression, call) {
  let declaration = call ? checker.getResolvedSignature(call)?.declaration : undefined;
  if (!declaration) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    declaration = symbol?.valueDeclaration;
    if (declaration && (ts.isPropertyDeclaration(declaration) || ts.isVariableDeclaration(declaration))) {
      declaration = declaration.initializer ?? declaration;
    }
  }
  if (!declaration?.getSourceFile().fileName.startsWith(srcRoot)) return undefined;
  return isFunctionLike(declaration) ? declaration : undefined;
}

const ALLOCATING = new Map([
  [ts.SyntaxKind.NewExpression, 'new expression'],
  [ts.SyntaxKind.ArrayLiteralExpression, 'array literal'],
  [ts.SyntaxKind.ObjectLiteralExpression, 'object literal'],
  [ts.SyntaxKind.ArrowFunction, 'closure'],
  [ts.SyntaxKind.FunctionExpression, 'closure'],
  [ts.SyntaxKind.TemplateExpression, 'template string'],
  [ts.SyntaxKind.SpreadElement, 'spread'],
  [ts.SyntaxKind.ForOfStatement, 'for...of (iterator allocation)'],
  [ts.SyntaxKind.RegularExpressionLiteral, 'regular expression'],
]);

let hotCount = 0;
let loopEntries = 0;

function checkHotBody(fn) {
  const visit = (node) => {
    const allocation = ALLOCATING.get(node.kind);
    if (allocation) {
      fail(node.getSourceFile().fileName, lineOf(node), `@hot ${describe(fn)} allocates: ${allocation}`);
      return;
    }
    if (ts.isCallExpression(node)) {
      const target = projectDeclaration(node.expression, node);
      if (target) {
        const tags = tagsOf(target);
        if (!tags.has('hot') && !tags.has('amortized')) {
          fail(node.getSourceFile().fileName, lineOf(node),
            `@hot ${describe(fn)} calls ${describe(target)}, which is neither @hot nor @amortized`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
}

for (const sourceFile of program.getSourceFiles()) {
  if (!sourceFile.fileName.startsWith(srcRoot)) continue;
  const visit = (node) => {
    if (isFunctionLike(node) && tagsOf(node).has('hot')) {
      hotCount++;
      checkHotBody(node);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (/(^|\.)(requestAnimationFrame|setAnimationLoop)$/.test(callee) && node.arguments.length > 0) {
        const argument = node.arguments[0];
        if (argument.kind !== ts.SyntaxKind.NullKeyword) {
          loopEntries++;
          const target = isFunctionLike(argument) ? argument : projectDeclaration(argument, undefined);
          if (!target) fail(sourceFile.fileName, lineOf(node), 'animation-loop callback could not be resolved for the @hot check');
          else if (!tagsOf(target).has('hot')) fail(sourceFile.fileName, lineOf(node), `animation-loop callback ${describe(target)} must be tagged @hot`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
if (loopEntries === 0) fail(path.join(root, 'src'), 0, 'no animation-loop entry found; the @hot check would be vacuous');
if (hotCount === 0) fail(path.join(root, 'src'), 0, 'no @hot functions found');

// 6. Release size budget ----------------------------------------------------
let distNote = 'dist/ not built, size budget not checked';
const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  const files = walk(dist);
  const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const js = files.filter((f) => f.endsWith('.js')).reduce((sum, f) => sum + statSync(f).size, 0);
  distNote = `dist ${(total / 1024).toFixed(0)} KiB in ${files.length} files (JS ${(js / 1024).toFixed(0)} KiB), budget 150 MB`;
  if (total > DIST_BUDGET_BYTES) fail(dist, 0, `release is ${total} bytes, over the 150 MB budget`);
}

if (errors.length > 0) {
  console.error(`static audit FAILED (${errors.length})`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`static audit PASS: ${checkedFiles.length} files <= ${MAX_LINES} lines, ${hotCount} @hot functions, `
  + `${loopEntries} loop entr${loopEntries === 1 ? 'y' : 'ies'}; ${distNote}`);
