#!/usr/bin/env node
// Read-only, bounded navigation: L1 syntax find, L2 language-service calls, L3 static impact.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project,find,calls,impact } from './agent-core/ts-project.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const [cmd,term]=args;
const get=opt=>{const i=args.indexOf(opt);return i<0?null:args[i+1];};
const json=args.includes('--json');
const number=(opt,fallback,cap=100000)=>{const raw=get(opt);if(raw===null)return fallback;const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<0||n>cap)throw Error(`Invalid ${opt}: expected 0..${cap}`);return n;};
const print=obj=>{
  if(json)console.log(JSON.stringify(obj));
  else{
    console.log(`${obj.command}: ${obj.query} (${obj.total??0} results)${obj.truncated?' [more]':''}`);
    if(obj.status&&obj.status!=='ok')console.log('Status: '+obj.status);
    for(const e of obj.results??[])console.log(typeof e==='string'?'  '+e:`  ${e.at} ${e.name}${e.signature?' '+e.signature:''}`);
    if(obj.candidates?.length)for(const e of obj.candidates)console.log(`  candidate ${e.at} ${e.name}`);
    if(obj.note)console.log('Note: '+obj.note);
  }
};
const usage='Usage: node tools/agent-index.mjs find <name> [--file p] [--kind k] [--limit n] [--offset n] [--json]\n' +
'       node tools/agent-index.mjs calls <symbol> [--file p] [--line n] [--limit n] [--in-offset n] [--out-offset n] [--json]\n'+
'       node tools/agent-index.mjs impact <src/path.ts> [--limit n] [--offset n] [--json]';
if(args.includes('--help')){console.log(usage);process.exit(0);}
if(!['find','calls','impact'].includes(cmd)||!term){console.error(usage);process.exit(2);}
try{
  const limit=Math.max(1,number('--limit',8,20));
  const offset=number('--offset',0);
  const p=project(ROOT);
  const file=get('--file')?.replaceAll('\\','/')??null;
  let result;
  if(cmd==='find')result=find(p,term,{file,kind:get('--kind'),limit,offset});
  if(cmd==='calls')result=calls(p,term,{file,line:number('--line',0),limit,
    inOffset:number('--in-offset',offset),outOffset:number('--out-offset',offset)});
  if(cmd==='impact')result=impact(p,term.replaceAll('\\','/'),{limit,offset});
  print(result);
  if(result.status==='ambiguous')process.exitCode=2;
  else if(result.status==='not-found'||result.status==='unsupported')process.exitCode=1;
}catch(e){console.error(`agent-index: ${e.message}`);process.exitCode=2;}
