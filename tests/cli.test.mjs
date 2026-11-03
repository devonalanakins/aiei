import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../bin/aiei.mjs',import.meta.url).pathname;
const root=new URL('../',import.meta.url).pathname;
function run(...args){return spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});}
test('CLI presents accurate help and validates sample files',()=>{
  const help=run('--help');assert.equal(help.status,0);assert.match(help.stdout,/offline/);
  const c=run('validate','contract','examples/contract.json');assert.equal(c.status,0);assert.match(c.stdout,/does not verify/);
  const r=run('validate','receipt','examples/receipt.json');assert.equal(r.status,0);
});
test('CLI returns distinct blocked exit code and structured JSON for example NO_GO',()=>{
  const r=run('assess','examples/contract.json','examples/receipt.json','--json');
  assert.equal(r.status,1);
  const v=JSON.parse(r.stdout);
  assert.equal(v.valid,true);
  assert.equal(v.ready_for_human_review,false);
  assert.equal(v.independently_verified,false);
});
test('CLI rejects malformed JSON and unsupported arguments without execution',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aiei-test-'));
  try{
    const path=join(dir,'bad.json');writeFileSync(path,'{"bad":');
    const r=run('validate','contract',path);
    assert.equal(r.status,2);assert.match(r.stderr,/AIEI:/);
    assert.equal(run('deploy','production').status,2);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('CLI refuses input files larger than 1 MiB',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aiei-test-'));
  try{
    const path=join(dir,'large.json');writeFileSync(path,' '.repeat(1_048_577));
    const r=run('validate','receipt',path);
    assert.equal(r.status,2);assert.match(r.stderr,/regular JSON file/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('GitHub inspect CLI rejects malformed targets without any network request',()=>{
  const bad=run('inspect','github','https://evil.test/repo','1','--json');
  assert.equal(bad.status,2);
  assert.match(bad.stderr,/Invalid owner\/repository/);
  const invalid=run('inspect','github','owner/repo','1','--receipt');
  assert.equal(invalid.status,2);
  assert.match(invalid.stderr,/Usage/);
});
