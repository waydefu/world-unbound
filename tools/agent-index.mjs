#!/usr/bin/env node
// Read-only, on-demand TypeScript symbol and static dependency explorer.
// Usage: node tools/agent-index.mjs find GrassCells [--file src/world/grassCells.ts] [--json]
//        node tools/agent-index.mjs calls select --file src/world/grassCells.ts
//        node tools/agent-index.mjs impact src/world/grassCells.ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];
const term = args[1];
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};
const json = args.includes('--json');
const limit = Math.min(20, Math.max(1, Number(option('--limit') ?? 8) || 8));
const fileFilter = option('--file');
const norm = (p) => p.split(sep).join('/');
const location = (sf, node) => {
  const loc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${norm(relative(ROOT, sf.fileName))}:${loc.line + 1}:${loc.character + 1}`;
};
const stop = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
if (!['find', 'calls', 'impact'].includes(command) || !term || args.includes('--help')) {
  stop('Usage: node tools/agent-index.mjs find|calls <symbol> [--file path] [--limit 8] [--json]\n       node tools/agent-index.mjs impact <src/path.ts> [--limit 8] [--json]');
}
const conf = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
if (conf.error) stop(ts.flattenDiagnosticMessageText(conf.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(conf.config, ts.sys, ROOT);
if (parsed.errors.length) stop(parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', 'src', 'tests', 'spike'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((p) => /\.tsx?$/.test(p) && !p.endsWith('.d.ts')));
const program = ts.createProgram(parsed.fileNames.filter((p) => tracked.has(norm(relative(ROOT, p)))), parsed.options);
const checker = command === 'impact' ? null : program.getTypeChecker();
const files = program.getSourceFiles().filter((sf) => tracked.has(norm(relative(ROOT, sf.fileName))));
const canonical = (symbol) => symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const defs = [];
const bySymbol = new Map();
const byNode = new Map();
const dependencies = new Map();

for (const sf of files) {
  const file = norm(relative(ROOT, sf.fileName));
  const deps = new Set();
  for (const node of sf.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
    const spec = node.moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
    const target = ts.resolveModuleName(spec.text, sf.fileName, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
    if (target) {
      const found = norm(relative(ROOT, target));
      if (tracked.has(found)) deps.add(found);
    }
  }
  dependencies.set(file, deps);
  const visit = (node) => {
    let kind = null;
    let nameNode = null;
    let signatureNode = node;
    if (ts.isFunctionDeclaration(node)) { kind = 'function'; nameNode = node.name; }
    else if (ts.isClassDeclaration(node)) { kind = 'class'; nameNode = node.name; }
    else if (ts.isMethodDeclaration(node)) { kind = 'method'; nameNode = node.name; }
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      kind = 'function-variable'; nameNode = node.name; signatureNode = node.initializer;
    } else if (ts.isPropertyDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) {
      kind = 'property-function'; nameNode = node.name; signatureNode = node.initializer;
    }
    if (kind && nameNode && ts.isIdentifier(nameNode)) {
      const symbol = canonical(checker.getSymbolAtLocation(nameNode));
      const name = nameNode.text;
      const parentName = ts.isClassLike(node.parent) ? node.parent.name?.getText(sf) : null;
      const qualified = parentName ? `${parentName}.${name}` : name;
      const raw = signatureNode.getText(sf);
      const body = signatureNode.body;
      const end = body ? Math.max(0, body.getStart(sf) - signatureNode.getStart(sf)) : 160;
      const signature = kind === 'class' ? `class ${name}` : raw.slice(0, Math.min(end, 160)).replace(/\s+/g, ' ').trim();
      const data = { name, qualified, kind, file, at: location(sf, nameNode), signature, symbol };
      defs.push(data);
      byNode.set(node, data);
      if (symbol) {
        const group = bySymbol.get(symbol) ?? [];
        group.push(data);
        bySymbol.set(symbol, group);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (command !== 'impact') ts.forEachChild(sf, visit);
}
const publicDef = (x) => ({ name: x.qualified, kind: x.kind, at: x.at, signature: x.signature });
const render = (obj) => {
  if (json) console.log(JSON.stringify(obj));
  else {
    console.log(`${obj.command}: ${obj.query} — ${obj.total ?? obj.count ?? 0} result(s)${obj.truncated ? ', truncated' : ''}`);
    for (const v of obj.results ?? []) {
      if (typeof v === 'string') console.log(`  ${v}`);
      else if (v.at) console.log(`  ${v.at} ${v.name ?? ''} ${v.signature ?? ''}`.trimEnd());
      else console.log(`  ${JSON.stringify(v)}`);
    }
    if (obj.note) console.log(`Note: ${obj.note}`);
  }
};
if (command === 'find') {
  const q = term.toLowerCase();
  const hits = defs.filter((d) => (d.qualified.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
    && (!fileFilter || d.file === fileFilter)).sort((a, b) => a.file.localeCompare(b.file) || a.at.localeCompare(b.at));
  render({ command, query: term, total: hits.length, truncated: hits.length > limit, results: hits.slice(0, limit).map(publicDef), note: 'AST declarations only; inspect bodies before editing.' });
} else if (command === 'calls') {
  const matches = defs.filter((d) => (d.name === term || d.qualified === term)
    && (!fileFilter || d.file === fileFilter));
  if (matches.length > 1 && !fileFilter) {
    render({ command, query: term, total: matches.length, truncated: matches.length > limit,
      results: matches.slice(0, limit).map(publicDef), note: 'Ambiguous symbol; rerun with --file <exact path>.' });
    process.exitCode = 2;
  } else if (matches.length === 0) {
    render({ command, query: term, total: 0, results: [], note: 'No exact function or method definition found.' });
    process.exitCode = 1;
  } else {
    const chosen = matches[0];
    const incoming = [];
    const outgoing = [];
    for (const sf of files) {
      const visit = (node, current) => {
        let parent = current;
        if (byNode.has(node)) parent = byNode.get(node);
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const expr = node.expression;
          const sym = canonical(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr));
          // A resolved call signature is the most reliable declaration link for class methods,
          // including destructured receivers; alias symbols alone can differ across access sites.
          const declaration = checker.getResolvedSignature(node)?.declaration;
          const target = (declaration && byNode.get(declaration)) || bySymbol.get(sym)?.[0];
          const call = { at: location(sf, node), from: parent?.qualified ?? '(top-level)', to: target?.qualified ?? '(external/dynamic)' };
          if (target && target.symbol === chosen.symbol) incoming.push(call);
          if (parent?.symbol && parent.symbol === chosen.symbol && target) outgoing.push(call);
        }
        ts.forEachChild(node, (child) => visit(child, parent));
      };
      ts.forEachChild(sf, (node) => visit(node, null));
    }
    const combined = [
      ...incoming.map((v) => ({ kind: 'incoming', at: v.at, name: v.from })),
      ...outgoing.map((v) => ({ kind: 'outgoing', at: v.at, name: v.to })),
    ];
    render({ command, query: chosen.qualified, at: chosen.at, incomingCount: incoming.length,
      outgoingCount: outgoing.length, total: combined.length, truncated: combined.length > limit,
      results: combined.slice(0, limit).map((v) => ({ ...v, name: `${v.kind}: ${v.name}` })),
      note: 'Static resolved calls only; callbacks, dynamic dispatch and reflected calls may be absent.' });
  }
} else {
  const file = norm(term);
  if (!tracked.has(file) || !existsSync(join(ROOT, file))) stop(`Tracked TypeScript source not found: ${file}`, 1);
  const reverse = new Map();
  for (const [from, imports] of dependencies) for (const dep of imports) {
    const importers = reverse.get(dep) ?? new Set();
    importers.add(from);
    reverse.set(dep, importers);
  }
  const found = new Map([[file, 0]]);
  const queue = [file];
  while (queue.length) {
    const current = queue.shift();
    for (const caller of reverse.get(current) ?? []) {
      if (found.has(caller)) continue;
      found.set(caller, found.get(current) + 1);
      queue.push(caller);
    }
  }
  const results = [...found].filter(([p]) => p !== file)
    .map(([p, hops]) => ({ path: p, hops, test: p.startsWith('tests/') }))
    .sort((a, b) => (b.test - a.test) || a.hops - b.hops || a.path.localeCompare(b.path));
  render({ command, query: file, total: results.length, truncated: results.length > limit,
    results: results.slice(0, limit).map((v) => `${v.test ? 'TEST ' : 'CODE '} ${v.path} (${v.hops} import hop${v.hops > 1 ? 's' : ''})`),
    note: 'Static relative imports/re-exports only; runtime dynamic imports and external asset references not resolved.' });
}
