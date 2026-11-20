#!/usr/bin/env node
// Read-only CLI performance proxy. This does not measure language-model Tokens.
import { execFileSync, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const ri=args.indexOf('--runs');
const runs=ri<0?3:Number(args[ri+1]);
if(!Number.isSafeInteger(runs)||runs<1||runs>12){console.error('--runs must be 1..12');process.exit(2);}
const tasks=[
  ['find',['find','GrassCells','--limit','5']],
  ['calls',['calls','select','--file','src/world/grassCells.ts','--limit','5']],
  ['impact',['impact','src/world/grassCells.ts','--limit','5']],
];
const pct=(v,q)=>[...v].sort((a,b)=>a-b)[Math.max(0,Math.ceil(v.length*q)-1)];
const report={
 kind:'CLI_EXECUTION_PROXY_NOT_LLM_TOKENS',
 repoSha:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
 node:process.version,platform:process.platform,architecture:process.arch,runs,tasks:[],
};
for(const [name,query] of tasks){
 const ms=[],bytes=[],rss=[];
 for(let k=0;k<runs;k++){
  const start=performance.now();
  const result=spawnSync(process.execPath,['tools/agent-index.mjs',...query,'--profile','--json'],
    {cwd:ROOT,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  if(result.status!==0){
   console.error('Benchmark '+name+' failed, status '+result.status+': '+result.stderr);
   process.exit(result.status||1);
  }
  const data=JSON.parse(result.stdout);
  ms.push(performance.now()-start);bytes.push(Buffer.byteLength(result.stdout,'utf8'));
  if(typeof data.metrics?.maxRssKiB==='number')rss.push(data.metrics.maxRssKiB);
 }
 report.tasks.push({id:name,p50WallMs:Math.round(pct(ms,0.5)),p95WallMs:Math.round(pct(ms,0.95)),
  medianOutputBytes:pct(bytes,0.5),maxRssKiB:rss.length?Math.max(...rss):null});
}
if(args.includes('--json'))console.log(JSON.stringify(report));
else{
 console.log('CLI performance proxy, NOT LLM Tokens. SHA '+report.repoSha);
 for(const row of report.tasks){
  console.log(row.id+': p50='+row.p50WallMs+'ms p95='+row.p95WallMs+
   'ms output='+row.medianOutputBytes+'B peakRSS='+row.maxRssKiB+'KiB');
 }
}
