// End-to-end handoff CLI against an isolated scratch Git repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const source=resolve('tools');
const file=(base,path,value)=>{mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),value);};
test('handoff checker distinguishes main progression, squash merge, offline and escaped paths',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wu-handoff-e2e-'));
 const today=new Date().toISOString().slice(0,10); // avoid a test that expires 14 days after it is written
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 const run=(...args)=>{
  const x=spawnSync(process.execPath,['tools/handoff-check.mjs',...args,'--json'],{cwd:dir,encoding:'utf8',timeout:15_000});
  return {exit:x.status,data:JSON.parse(x.stdout),err:x.stderr};
 };
 try{
  file(dir,'tools/handoff-check.mjs','');
  copyFileSync(join(source,'handoff-check.mjs'),join(dir,'tools/handoff-check.mjs'));
  file(dir,'tools/agent-core/handoff-utils.mjs','');
  copyFileSync(join(source,'agent-core/handoff-utils.mjs'),join(dir,'tools/agent-core/handoff-utils.mjs'));
  for(const d of ['docs/INDEX.md','docs/process/agent-workflow.md','docs/architecture/CODE-MAP.md','docs/process/index-benchmark.md','CLAUDE.md','GEMINI.md'])file(dir,d,'# fixture\n');
  file(dir,'docs/HANDOFF.md','# Handoff\n\nSnapshot: '+today+'\n\nBase main: '+'0'.repeat(40)+'\n');
  git('init','-b','main');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  git('add','.');git('commit','-m','initial');
  const base=git('rev-parse','HEAD');
  git('checkout','-b','feature');
  file(dir,'docs/HANDOFF.md','# Handoff\n\nSnapshot: '+today+'\n\nBase main: '+base+'\n');
  git('add','docs/HANDOFF.md');git('commit','-m','snapshot');
  git('checkout','main');file(dir,'src/render/new.ts','export const changed = true;\n');
  git('add','src/render/new.ts');git('commit','-m','runtime change');
  git('update-ref','refs/remotes/origin/main',git('rev-parse','main'));
  git('checkout','feature');
  let r=run();
  assert.equal(r.exit,0,r.err);
  assert.equal(r.data.observedSource.startsWith('origin/main'),true);
  assert.equal(r.data.drift.state,'review-required');
  assert.equal(r.data.drift.relevant.includes('src/render/new.ts'),true);
  assert.equal(run('--strict').exit,1);
  git('checkout','main');git('reset','--hard',base);
  git('merge','--squash','feature');git('commit','-m','squashed handoff only');
  git('update-ref','refs/remotes/origin/main',git('rev-parse','main'));
  git('checkout','feature');
  r=run('--strict');
  assert.equal(r.exit,0,r.err+' '+JSON.stringify(r.data));
  assert.equal(r.data.drift.state,'advanced-docs-only');
  file(dir,'docs/INDEX.md','[escape](%2E%2E/%2E%2E/private.md)\n');
  r=run('--links-only');
  assert.equal(r.data.status,'invalid');
  assert.ok(r.data.problems.some(x=>x.includes('escaping')));
  file(dir,'docs/INDEX.md','```md\n[fake](not-exist.md)\n```\n[Valid](INDEX.md "Index Title")\n');
  r=run('--links-only');
  assert.equal(r.data.status,'ok',JSON.stringify(r.data));
  git('checkout','--','docs/INDEX.md');
  git('update-ref','-d','refs/remotes/origin/main');
  r=run('--strict');
  assert.equal(r.exit,1);
  assert.ok(r.data.warnings.some(x=>x.includes('No origin/main')));
  git('branch','-D','main');
  r=run('--strict');
  assert.equal(r.exit,1);
  assert.equal(r.data.observedMain,null);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
