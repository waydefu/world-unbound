// On-demand TypeScript navigation. Cheap AST paths never instantiate a semantic program.
// Language Service call hierarchy and static imports are the only reported edges.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import ts from 'typescript';

const slash = (p) => p.split(sep).join('/');
const locate = (sf, start, root) => {
  const pos = sf.getLineAndCharacterOfPosition(start);
  return `${slash(relative(root, sf.fileName))}:${pos.line + 1}:${pos.character + 1}`;
};
export const rankMatch = (entry, query) => {
  const q = query.toLowerCase();
  const name = entry.name.toLowerCase();
  const qualified = entry.qualified.toLowerCase();
  if (qualified === q || name === q) return 0;
  if (qualified.startsWith(q) || name.startsWith(q)) return 1;
  if (qualified.includes(q) || name.includes(q)) return 2;
  return 3;
};
export const page = (items, limit, offset = 0) => ({
  total: items.length, offset, limit, truncated: offset + limit < items.length,
  items: items.slice(offset, offset + limit),
});
export const project = (root) => {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw Error(parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
  const git = execFileSync('git', ['ls-files', '-z', '--', 'src', 'tests', 'spike'], { cwd: root, encoding: 'utf8' });
  const tracked = new Set(git.split('\0').filter(p => /\.tsx?$/.test(p) && !p.endsWith('.d.ts')).map(p=>p.replaceAll('\\', '/')));
  const sources = parsed.fileNames.filter(p=>tracked.has(slash(relative(root,p))));
  return { root, parsed, tracked, sources, options:parsed.options };
};
const readSymbols = (p) => {
  const defs=[];
  for (const abs of p.sources) {
    const content = ts.sys.readFile(abs);
    if (content === undefined) continue;
    const sf = ts.createSourceFile(abs, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const file = slash(relative(p.root, abs));
    const walk = node => {
      let kind=null, name=null, signatureNode=node;
      if (ts.isClassDeclaration(node)) { kind='class'; name=node.name; }
      else if (ts.isInterfaceDeclaration(node)) { kind='interface'; name=node.name; }
      else if (ts.isTypeAliasDeclaration(node)) { kind='type'; name=node.name; }
      else if (ts.isEnumDeclaration(node)) { kind='enum'; name=node.name; }
      else if (ts.isFunctionDeclaration(node)) { kind='function'; name=node.name; }
      else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) { kind='method'; name=node.name; }
      else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) { kind='accessor'; name=node.name; }
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        kind='function-variable'; name=node.name; signatureNode=node.initializer;
      } else if (ts.isPropertyDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)) {
        kind='property-function'; name=node.name; signatureNode=node.initializer;
      } else if (ts.isConstructorDeclaration(node)) {
        kind='constructor'; name=node; // constructor has no separate name node
      }
      if (kind && name && (ts.isIdentifier(name) || kind === 'constructor')) {
        const unqualified=kind==='constructor'?'constructor':name.text;
        const cl=ts.isClassLike(node.parent) || ts.isInterfaceDeclaration(node.parent) ? node.parent : null;
        const owner=cl?.name?.getText(sf);
        const qualified=owner?`${owner}.${unqualified}`:unqualified;
        const pos=kind==='constructor'?node.getStart(sf):name.getStart(sf);
        const body=signatureNode.body;
        const end=body?Math.max(0,body.getStart(sf)-signatureNode.getStart(sf)):190;
        const signature=kind==='class' || kind==='interface'||kind==='enum'?
          `${kind} ${unqualified}`:signatureNode.getText(sf).slice(0,Math.min(end,190)).replace(/\s+/g,' ').trim();
        defs.push({name:unqualified,qualified,kind,file,at:locate(sf,pos,p.root),start:pos,signature});
      }
      ts.forEachChild(node,walk);
    };
    ts.forEachChild(sf,walk);
  }
  return defs;
};
export const find = (p, term, { file=null, kind=null, limit=8, offset=0 }={}) => {
  const list=readSymbols(p).filter(d=>rankMatch(d,term)<3&&(!file||file===d.file)&&(!kind||d.kind===kind));
  list.sort((a,b)=>rankMatch(a,term)-rankMatch(b,term)||a.file.localeCompare(b.file)||a.start-b.start||a.qualified.localeCompare(b.qualified));
  const pg=page(list,limit,offset);
  return { command:'find',query:term,total:pg.total,offset,limit,truncated:pg.truncated,results:pg.items.map(({name,qualified,kind,at,signature})=>({name:qualified,kind,at,signature})),
    provenance:'typescript-ast',completeness:'syntax-only',note:'Definitions and signatures only; verify implementations and runtime guards.' };
};
const getService = p => {
  const all = [...p.sources, ...p.parsed.fileNames.filter(f => f.endsWith('.d.ts') && !p.sources.includes(f))];
  const host = {
    getCompilationSettings: () => p.options,
    getScriptFileNames: () => all,
    getScriptVersion: () => '0',
    getScriptSnapshot: f => { const x=ts.sys.readFile(f); return x===undefined?undefined:ts.ScriptSnapshot.fromString(x); },
    getCurrentDirectory: () => p.root,
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    fileExists:ts.sys.fileExists,readFile:ts.sys.readFile,readDirectory:ts.sys.readDirectory,
    directoryExists:ts.sys.directoryExists,getDirectories:ts.sys.getDirectories,
    realpath:ts.sys.realpath,
  };
  return ts.createLanguageService(host,ts.createDocumentRegistry());
};
const formatCall = (p, item, offset, dir) => {
  const file=slash(relative(p.root,item.file));
  const sf=ts.createSourceFile(item.file,ts.sys.readFile(item.file)||'',ts.ScriptTarget.Latest,true);
  const at=locate(sf,offset,p.root);
  return { name:`${dir}: ${item.containerName?item.containerName+'.':''}${item.name}`,
    at,kind:dir,from:dir==='incoming'?file:null,to:dir==='outgoing'?file:null,
    provenance:'typescript-language-service',confidence:'resolved-static' };
};
export const calls = (p, symbol, { file=null, line=null, limit=8, inOffset=0, outOffset=0 }={}) => {
  const defs=readSymbols(p).filter(d=>(d.name===symbol||d.qualified===symbol)&&(!file||d.file===file)&&
    (!line||Number(d.at.split(':').at(-2))===line));
  if (defs.length!==1) return { command:'calls',query:symbol,total:defs.length,status:defs.length?'ambiguous':'not-found',
    candidates:defs.slice(0,20).map(x=>({name:x.qualified,at:x.at,kind:x.kind})),
    results:[],incoming:[],outgoing:[],incomingCount:0,outgoingCount:0,
    note:defs.length?'Pass --file and if needed --line to disambiguate.':'No exact declaration found.' };
  const d=defs[0];
  const filename=resolve(p.root,d.file);
  const ls=getService(p);
  let inc, out, hierarchy;
  try {
    hierarchy=ls.prepareCallHierarchy(filename,d.start);
    if(!hierarchy) return {command:'calls',query:d.qualified,at:d.at,status:'unsupported',results:[],incoming:[],outgoing:[],incomingCount:0,outgoingCount:0,
      note:'TypeScript Language Service does not support call hierarchy for this declaration.'};
    inc=ls.provideCallHierarchyIncomingCalls(filename,d.start);
    out=ls.provideCallHierarchyOutgoingCalls(filename,d.start);
  } finally {ls.dispose();}
  const incoming = inc.flatMap(c=>c.fromSpans.map(span=>formatCall(p,c.from,span.start,'incoming')));
  const outgoing = out.flatMap(c=>c.fromSpans.map(span=>formatCall(p,c.to,span.start,'outgoing')));
  // Incoming span is a call site in the caller. Outgoing span is a call site in the selected method.
  // Correct the location for outgoing using the selected file rather than the callee file.
  for(let i=0;i<outgoing.length;i++){
    const call=out.flatMap(c=>c.fromSpans.map(span=>({span,to:c.to})))[i];
    const sf=ts.createSourceFile(filename,ts.sys.readFile(filename)||'',ts.ScriptTarget.Latest,true);
    outgoing[i].at=locate(sf,call.span.start,p.root);
  }
  incoming.sort((a,b)=>a.at.localeCompare(b.at)||a.name.localeCompare(b.name));
  outgoing.sort((a,b)=>a.at.localeCompare(b.at)||a.name.localeCompare(b.name));
  const pi=page(incoming,limit,inOffset),po=page(outgoing,limit,outOffset);
  return {command:'calls',query:d.qualified,at:d.at,status:'ok',incomingCount:incoming.length,outgoingCount:outgoing.length,
    incoming:pi.items,outgoing:po.items,limits:{incoming:{offset:inOffset,limit,truncated:pi.truncated},outgoing:{offset:outOffset,limit,truncated:po.truncated}},
    total:incoming.length+outgoing.length,truncated:pi.truncated||po.truncated,results:[...pi.items,...po.items],
    provenance:'typescript-language-service',completeness:'static-only',
    note:'TypeScript call hierarchy: dynamic dispatch, callbacks, computed properties and runtime dependencies may be omitted.'};
};
export const impact = (p,file,{limit=8,offset=0}={}) => {
  if (!p.tracked.has(file) || !p.sources.some(x=>slash(relative(p.root,x))===file))
    throw Error(`Tracked TypeScript file not found: ${file}`);
  const reverse=new Map(), flags=new Map();
  const sourceSet=new Set(p.sources.map(x=>slash(relative(p.root,x))));
  for(const abs of p.sources){
    const from=slash(relative(p.root,abs));
    const code=readFileSync(abs,'utf8');
    const sf=ts.createSourceFile(abs,code,ts.ScriptTarget.Latest,true);
    const deps=new Set(),unknown=new Set();
    const visit=node=>{
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
        const mod=node.moduleSpecifier.text;
        if(mod.startsWith('.')){
          const to=ts.resolveModuleName(mod,abs,p.options,ts.sys).resolvedModule?.resolvedFileName;
          const target=to&&slash(relative(p.root,to));
          if(target&&sourceSet.has(target))deps.add(target);
        }
      }else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
        unknown.add('dynamic import');
      }else if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Worker'){
        unknown.add('Worker entrypoint');
      }
      ts.forEachChild(node,visit);
    };
    ts.forEachChild(sf,visit);
    flags.set(from,[...unknown]);
    for(const dep of deps){
      const set=reverse.get(dep)||new Set();
      set.add(from);reverse.set(dep,set);
    }
  }
  const distances=new Map([[file,0]]),queue=[file];
  while(queue.length){
    const current=queue.shift();
    for(const next of reverse.get(current)||[]){
      if(distances.has(next))continue;
      distances.set(next,distances.get(current)+1);queue.push(next);
    }
  }
  const list=[...distances].filter(([f])=>f!==file)
    .map(([path,hops])=>({path,hops,test:path.startsWith('tests/'),classification:hops===1?'resolved-direct-import':'candidate-transitive-import'}))
    .sort((a,b)=>Number(b.test)-Number(a.test)||a.hops-b.hops||a.path.localeCompare(b.path));
  const pg=page(list,limit,offset);
  const risks=[...new Set([...distances.keys()].flatMap(f=>flags.get(f)||[]))].sort();
  return {command:'impact',query:file,total:pg.total,limit,offset,truncated:pg.truncated,
    results:pg.items.map(x=>`${x.test?'TEST':'CODE'} ${x.path} (${x.hops} import hop${x.hops===1?'':'s'})`),
    details:pg.items,unknown:risks,provenance:'typescript-ast-static-imports',completeness:'incomplete-runtime',
    note:'Import reachability only. Workers, runtime imports, shader/assets, contract coupling and callbacks require explicit review.'};
};
