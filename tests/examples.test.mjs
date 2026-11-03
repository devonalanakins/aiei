import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateContract,validateReceipt,assess} from '../lib/index.mjs';
const c=JSON.parse(readFileSync(new URL('../examples/contract.json',import.meta.url),'utf8'));
const r=JSON.parse(readFileSync(new URL('../examples/receipt.json',import.meta.url),'utf8'));
test('published fictional examples remain valid, explicitly NO_GO and not independently verified',()=>{
  assert.equal(validateContract(c).valid,true);
  assert.equal(validateReceipt(r).valid,true);
  const a=assess(c,r);
  assert.equal(a.valid,true);
  assert.equal(a.ready_for_human_review,false);
  assert.equal(a.declared_release_decision,'NO_GO');
  assert.equal(a.independently_verified,false);
});
