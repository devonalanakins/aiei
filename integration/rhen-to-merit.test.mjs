import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {exportTypedSemanticEvidence} from '../rhen-checkout/src/semantic-evidence.mjs';
import {compileTypedPreview} from '../rhen-checkout/src/typed-preview.mjs';
import {evaluateEvidenceGraph,digestJSON} from '../lib/evidence-graph.mjs';

// Pre-specified independently of the evaluator and emitted code.
// This case checks ordered stdout prefix and checked SafeInt overflow.
// The assertion does not establish correctness for all possible programs.
const source=readFileSync(new URL('../rhen-checkout/examples/merit-safeint-boundary.rn',import.meta.url),'utf8');
const expected={stdout:['7','9007199254740991'],trap:'overflow'};
const revision='827d5640da195d06f88321a7e0c5d386845027cc';
const observedAt='2026-11-04T21:00:00Z';
const reference=exportTypedSemanticEvidence(source,{
  repository:'devonalanakins/rhen',revision,claim_id:'safeint-boundary-v1',
  policy_digest:'a'.repeat(64),run_id:'rhen-reference-run',observed_at:observedAt,
  predicate:'A bounded pure SafeInt program preserves ordered stdout prefix then traps on overflow',
});
function run(cmd,args,code) {
  const r=spawnSync(cmd,args,{input:code,encoding:'utf8',timeout:3000,maxBuffer:128*1024});
  assert.equal(r.error,undefined, String(r.error));
  return {stdout:r.stdout.trimEnd().split('\n').filter(Boolean),
    trap:/SafeInt overflow/.test(r.stderr)?'overflow':r.status===0?'none':'error'};
}
function witness(producer,runId,outcome,toolchain,artifact_sha256) {
  return {id:runId,obligation:'program-trace',producer,run_id:runId,attempt:1,
    revision,source_sha256:reference.subject.source_sha256,ir_sha256:reference.subject.ir_sha256,
    ...(artifact_sha256?{artifact_sha256}:{}),
    toolchain,observed_at:observedAt,outcome,depends_on:[]};
}
const nodeToolchain='node-'+process.versions.node;
const pythonVersion=spawnSync('python3',['--version'],{encoding:'utf8'});
assert.equal(pythonVersion.status,0,'Python is required for the integration experiment');
const pythonToolchain=pythonVersion.stdout.trim();
const oracle={...expected};
const policy={
  schema_version:'merit.policy.v1',claim_id:reference.claim_id,subject:reference.subject,
  predicate:reference.predicate,scope:structuredClone(reference.scope),
  artifacts:reference.artifacts,
  toolchains:{'rhen-reference':nodeToolchain,js:nodeToolchain,
    python:pythonToolchain,'independent-oracle':'fixed-oracle-safeint-v1'},
  obligations:[{id:'program-trace',
    producers:['rhen-reference','js','python','independent-oracle'],expected:oracle}],
};
const packet={
  ...reference,policy_digest:digestJSON(policy),open_obligations:[],
  assumptions:[...reference.assumptions,'Independent expected trace authored before observing target execution'],
  witnesses:[
    reference.witnesses[0],
    witness('js','js-exec-1',run(process.execPath,['--input-type=commonjs'],
      compileTypedPreview(source,'js')),nodeToolchain,reference.artifacts.js),
    witness('python','python-exec-1',run('python3',['-'],
      compileTypedPreview(source,'python')),pythonToolchain,reference.artifacts.python),
    witness('independent-oracle','fixed-oracle-1',oracle,'fixed-oracle-safeint-v1'),
  ],
};
const assess=fn=>{const p=structuredClone(packet);fn?.(p);return evaluateEvidenceGraph(p,policy);};

test('Rhen reference, JS, Python and independently specified oracle agree on precise bounded overflow trace',()=>{
  for(const w of packet.witnesses)assert.deepEqual(w.outcome,oracle,w.producer);
  const a=assess();
  assert.equal(a.verdict,'SUPPORTED_WITH_SCOPE',JSON.stringify(a));
  assert.equal(a.provenance_authenticated,false);
  assert.equal(a.release_authorized,false);
});
test('Merit rejects missing independent oracle',()=>{
  const a=assess(p=>p.witnesses.pop());
  assert.equal(a.verdict,'INSUFFICIENT');
  assert.deepEqual(a.missing_obligations,['program-trace/independent-oracle']);
});
test('Merit rejects source revision corruption',()=>{
  assert.equal(assess(p=>{p.subject.revision='f'.repeat(40)}).verdict,'STALE');
});
test('Merit rejects backend artifact substitution',()=>{
  assert.equal(assess(p=>{p.witnesses[1].artifact_sha256='f'.repeat(64)}).verdict,'UNTRUSTED_SOURCE');
});
test('Merit rejects reused execution receipts',()=>{
  assert.equal(assess(p=>{p.witnesses[2].run_id=p.witnesses[1].run_id}).verdict,'UNTRUSTED_SOURCE');
});
test('Merit refuses to conceal failing target observations',()=>{
  assert.equal(assess(p=>{p.witnesses[2].outcome.trap='none'}).verdict,'REFUTED');
});
test('Merit refuses unsupported semantics and outstanding obligations',()=>{
  assert.equal(assess(p=>p.unsupported.push('external I/O')).verdict,'OUT_OF_SCOPE');
  assert.equal(assess(p=>p.open_obligations.push('additional-case')).verdict,'INSUFFICIENT');
});
test('altering the separately pinned policy blocks the claim',()=>{
  const changed=structuredClone(policy);changed.obligations[0].expected.trap='none';
  assert.equal(evaluateEvidenceGraph(packet,changed).verdict,'POLICY_BLOCKED');
});

test('Merit blocks broadening the Rhen boundary claim without a policy amendment',()=>{
  const changed=assess(p=>{p.predicate='All Rhen programs have been formally verified';});
  assert.equal(changed.verdict,'POLICY_BLOCKED');
  assert.equal(changed.release_authorized,false);
});
test('Merit blocks widening Rhen target coverage while preserving pinned traces',()=>{
  const changed=assess(p=>{p.scope.targets.push('production-runtime');});
  assert.equal(changed.verdict,'POLICY_BLOCKED');
  assert.equal(changed.provenance_authenticated,false);
});
