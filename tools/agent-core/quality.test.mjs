// Focused regression tests: no remote network, no secrets, no persistent index.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { inside, realInside, classifySnapshot } from './handoff-utils.mjs';
import { rankMatch, page } from './ts-project.mjs';

test('POSIX path boundary accepts same tree, denies sibling prefix and parent escape', () => {
  assert.equal(inside('/tmp/world', '/tmp/world/docs/a.md', path.posix), true);
  assert.equal(inside('/tmp/world', '/tmp/world', path.posix), true);
  assert.equal(inside('/tmp/world', '/tmp/world-old/x', path.posix), false);
  assert.equal(inside('/tmp/world', '/tmp/world/../secret', path.posix), false);
});
test('Windows drive and UNC paths respect separators and case', () => {
  assert.equal(inside('C:\\world', 'C:\\world\\docs\\a.md', path.win32), true);
  assert.equal(inside('C:\\world', 'C:\\world-old\\secret', path.win32), false);
  assert.equal(inside('C:\\world', 'D:\\world\\docs\\a.md', path.win32), false);
  assert.equal(inside('\\\\server\\share\\world', '\\\\server\\share\\world\\docs', path.win32), true);
  assert.equal(inside('\\\\server\\share\\world', '\\\\server\\other\\world', path.win32), false);
});
test('symlink escape is not treated as a safe local document', (t) => {
  const dir=mkdtempSync(path.join(tmpdir(),'wu-path-'));
  try {
    mkdirSync(path.join(dir,'repo'));
    mkdirSync(path.join(dir,'outside'));
    writeFileSync(path.join(dir,'outside','private.md'),'not public');
    try {
      symlinkSync(path.join(dir,'outside','private.md'),path.join(dir,'repo','linked.md'));
    } catch (e) {
      // On Windows, creating symlinks may require Developer Mode or elevated privileges.
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(e?.code)) {
        t.skip('Native Windows symlink permission unavailable; path.win32 boundary tests still run');
        return;
      }
      throw e;
    }
    assert.equal(inside(path.join(dir,'repo'),path.join(dir,'repo','linked.md')),true);
    assert.equal(realInside(path.join(dir,'repo'),path.join(dir,'repo','linked.md')),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('snapshot states distinguish actual runtime changes from documentation commits', () => {
  const a='a'.repeat(40),b='b'.repeat(40);
  assert.equal(classifySnapshot({recorded:a,current:a,ancestor:true}).state,'at-base');
  assert.equal(classifySnapshot({recorded:a,current:b,ancestor:true,files:['docs/HANDOFF.md','tools/agent-index.mjs']}).state,'advanced-docs-only');
  assert.equal(classifySnapshot({recorded:a,current:b,ancestor:true,files:['src/render/grass.ts']}).state,'review-required');
  assert.equal(classifySnapshot({recorded:a,current:b,ancestor:false}).state,'diverged');
  assert.equal(classifySnapshot({recorded:a,current:b,ancestor:false,reverseAncestor:true}).state,'recorded-ahead');
  assert.equal(classifySnapshot({recorded:a,current:null,ancestor:null}).state,'unknown');
});
test('Git common ancestor does not masquerade as current main', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'wu-git-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  try {
    git('init','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','Test');
    writeFileSync(path.join(dir,'one'),'a');git('add','one');git('commit','-m','base');
    const baseline=git('rev-parse','HEAD');
    git('checkout','-b','feature');
    git('checkout','main');writeFileSync(path.join(dir,'two'),'b');git('add','two');git('commit','-m','main moves');
    const head=git('rev-parse','main');
    git('checkout','feature');
    assert.equal(git('merge-base','HEAD','main'),baseline);
    assert.notEqual(head,baseline);
    const changed=git('diff','--name-only',baseline,head).split('\n');
    assert.equal(changed.includes('two'),true);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('exact symbol ranking and independent page windows are deterministic', () => {
  assert.equal(rankMatch({name:'GrassCells',qualified:'GrassCells'},'GrassCells'),0);
  assert.equal(rankMatch({name:'GrassCellsLong',qualified:'GrassCellsLong'},'GrassCells'),1);
  assert.equal(rankMatch({name:'OtherGrassCells',qualified:'OtherGrassCells'},'GrassCells'),2);
  const incoming=page(['a','b','c'],1,0),outgoing=page(['x','y'],1,0);
  assert.deepEqual(incoming.items,['a']);assert.deepEqual(outgoing.items,['x']);
  assert.equal(incoming.truncated,true);assert.equal(outgoing.truncated,true);
});
test('CLI keeps incoming and outgoing independently when both exceed one item', () => {
  const r=spawnSync(process.execPath,['tools/agent-index.mjs','calls','step','--file','tests/agent-fixtures/calls.ts','--limit','1','--json'],
    {cwd:process.cwd(),encoding:'utf8',timeout:60_000});
  assert.equal(r.status,0,r.stderr);
  const x=JSON.parse(r.stdout);
  assert.equal(x.status,'ok');
  assert.ok(x.incomingCount>=2,'must resolve multiple incoming references');
  assert.ok(x.outgoingCount>=1,'must resolve outgoing leaf call');
  assert.equal(x.incoming.length,1);assert.equal(x.outgoing.length,1);
  assert.equal(x.limits.incoming.truncated,true);
  assert.ok(x.results.some(t=>t.name.startsWith('incoming:')));
  assert.ok(x.results.some(t=>t.name.startsWith('outgoing:')));
  // A renamed imported type still resolves as a caller in another source file.
  const all=spawnSync(process.execPath,['tools/agent-index.mjs','calls','CallFixture.step','--file','tests/agent-fixtures/calls.ts','--limit','20','--json'],
    {cwd:process.cwd(),encoding:'utf8',timeout:60_000});
  assert.equal(all.status,0,all.stderr);
  const y=JSON.parse(all.stdout);
  assert.ok(y.incoming.some(z=>z.at.startsWith('tests/agent-fixtures/external.ts:')),'renamed cross-file caller must resolve');
});
test('ambiguous symbols are never silently coerced into a single target', () => {
  const r=spawnSync(process.execPath,['tools/agent-index.mjs','calls','select','--json'],
    {cwd:process.cwd(),encoding:'utf8',timeout:60_000});
  assert.equal(r.status,2,r.stderr);
  const x=JSON.parse(r.stdout);
  assert.equal(x.status,'ambiguous');assert.ok(x.candidates.length>=2);
});
