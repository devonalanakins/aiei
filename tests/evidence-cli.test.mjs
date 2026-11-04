import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../bin/merit-evidence.mjs',import.meta.url).pathname;
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:3000});
test('new CLI exposes offline interface without altering original aiei CLI',()=>{
 const h=run('--help');assert.equal(h.status,0);assert.match(h.stdout,/packet.json/);
 const original=spawnSync(process.execPath,[new URL('../bin/aiei.mjs',import.meta.url).pathname,'--help'],{encoding:'utf8',timeout:3000});
 assert.equal(original.status,0);assert.match(original.stdout,/assess/);
});
test('new CLI reports malformed input distinctly and refuses unsupported schema',()=>{
 const dir=mkdtempSync(join(tmpdir(),'merit-cli-'));
 try{
  const packet=join(dir,'packet.json'),policy=join(dir,'policy.json');
  writeFileSync(packet,'{"broken":');writeFileSync(policy,'{}');
  const invalid=run(packet,policy);assert.equal(invalid.status,2);assert.match(invalid.stderr,/Merit evidence/);
  writeFileSync(packet,'{}');
  const insufficient=run(packet,policy);assert.equal(insufficient.status,1);
  const data=JSON.parse(insufficient.stdout);
  assert.equal(data.verdict,'INSUFFICIENT');assert.equal(data.release_authorized,false);
  assert.equal(run(packet).status,2);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
