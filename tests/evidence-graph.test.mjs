import test from 'node:test';
import assert from 'node:assert/strict';
import {digestJSON,parseEvidenceJSON,validateEvidencePacket,evaluateEvidenceGraph} from '../lib/evidence-graph.mjs';

const hash=c=>c.repeat(64);
const subject={repository:'devonalanakins/rhen',revision:'a'.repeat(40),
  source_sha256:hash('b'),ir_version:'rhen.typed.preview.v0',ir_sha256:hash('c')};
const expected={stdout:['7'],trap:'overflow'};
const policy={schema_version:'merit.policy.v1',claim_id:'safeint-prefix',subject,
  obligations:[{id:'trace',producers:['rhen-reference','js','python','independent-oracle'],expected}],
  artifacts:{js:hash('d'),python:hash('e')},
  toolchains:{'rhen-reference':'node-22',js:'node-22',python:'python-3','independent-oracle':'oracle-v1'}};
function witness(producer,i) {
  return {id:'w'+i,obligation:'trace',producer,run_id:'run-'+i,attempt:1,
    revision:subject.revision,source_sha256:subject.source_sha256,ir_sha256:subject.ir_sha256,
    ...(producer==='js'||producer==='python'?{artifact_sha256:policy.artifacts[producer]}:{}),
    toolchain:policy.toolchains[producer],observed_at:'2026-11-04T21:00:00Z',
    outcome:structuredClone(expected),depends_on:[]};
}
function packet() {
  return {schema_version:'merit.evidence.v1',claim_id:'safeint-prefix',subject,
    predicate:'SafeInt trace matches independently specified oracle',
    scope:{language:'Rhen',semantics:'rhen.typed.preview.v0',targets:['reference','js','python']},
    assumptions:['synthetic isolation'],policy_digest:digestJSON(policy),
    artifacts:{...policy.artifacts},
    witnesses:['rhen-reference','js','python','independent-oracle'].map(witness),
    unsupported:[],open_obligations:[],verification_method:'synthetic controlled witnesses'};
}
const evaluate=mutate=>{const x=structuredClone(packet());mutate?.(x);return evaluateEvidenceGraph(x,policy);};
test('bounded structural support never implies independent authentication or release',()=>{
  const v=evaluate();assert.equal(v.verdict,'SUPPORTED_WITH_SCOPE');assert.equal(v.valid,true);
  assert.equal(v.independently_verified,false);assert.equal(v.provenance_authenticated,false);
  assert.equal(v.release_authorized,false);
});
test('missing oracle is INSUFFICIENT',()=>{
  const v=evaluate(p=>p.witnesses.pop());
  assert.equal(v.verdict,'INSUFFICIENT');
  assert.deepEqual(v.missing_obligations,['trace/independent-oracle']);
});
test('stale commit invalidates the claim',()=>assert.equal(
  evaluate(p=>{p.subject.revision='f'.repeat(40)}).verdict,'STALE'));
test('IR identity must match policy',()=>assert.equal(
  evaluate(p=>{p.subject.ir_sha256=hash('f')}).verdict,'UNTRUSTED_SOURCE'));
test('changed policy digest is blocked',()=>{
  const changed=structuredClone(policy);changed.obligations[0].expected.stdout[0]='8';
  assert.equal(evaluateEvidenceGraph(packet(),changed).verdict,'POLICY_BLOCKED');
});
test('hidden backend failure explicitly REFUTES the claim',()=>assert.equal(
  evaluate(p=>{p.witnesses[1].outcome.trap='none'}).verdict,'REFUTED'));
test('run evidence cannot be reused under a different producer',()=>assert.equal(
  evaluate(p=>{p.witnesses[1].run_id=p.witnesses[0].run_id}).verdict,'UNTRUSTED_SOURCE'));
test('duplicate coverage cannot amplify apparent confidence',()=>assert.equal(
  evaluate(p=>{p.witnesses[1].producer='rhen-reference'}).verdict,'UNTRUSTED_SOURCE'));
test('witness identity must match exact source',()=>assert.equal(
  evaluate(p=>{p.witnesses[0].source_sha256=hash('f')}).verdict,'UNTRUSTED_SOURCE'));
test('backend artifacts and toolchain are independently bound',()=>{
  assert.equal(evaluate(p=>{p.artifacts.js=hash('f')}).verdict,'STALE');
  assert.equal(evaluate(p=>{p.witnesses[1].artifact_sha256=hash('f')}).verdict,'UNTRUSTED_SOURCE');
  assert.equal(evaluate(p=>{p.witnesses[1].toolchain='node-other'}).verdict,'UNTRUSTED_SOURCE');
});
test('self-certification is rejected',()=>assert.equal(
  evaluate(p=>{p.witnesses[0].depends_on=['claim:safeint-prefix']}).verdict,'UNTRUSTED_SOURCE'));
test('unsupported semantics and open obligations are never marked supported',()=>{
  assert.equal(evaluate(p=>{p.unsupported=['external-effects']}).verdict,'OUT_OF_SCOPE');
  assert.equal(evaluate(p=>{p.open_obligations=['external-witness']}).verdict,'INSUFFICIENT');
});
test('unexpected keys fail schema and unknown evidence cannot satisfy proof',()=>{
  const x=packet();x.fake_authorization=true;
  assert.equal(validateEvidencePacket(x).valid,false);
  assert.equal(evaluateEvidenceGraph(x,policy).verdict,'INSUFFICIENT');
});
test('strict JSON ingress rejects duplicate keys, escaped duplicates, tails and oversized packets',()=>{
  assert.throws(()=>parseEvidenceJSON('{"a":1,"a":2}'),/duplicate/);
  assert.throws(()=>parseEvidenceJSON('{"a":1,"\\u0061":2}'),/duplicate/);
  assert.throws(()=>parseEvidenceJSON('{}{}'),/trailing/);
  assert.throws(()=>parseEvidenceJSON(' '.repeat(1_048_577)),/1 MiB/);
  assert.deepEqual(parseEvidenceJSON('{"a":1}'),{a:1});
});
test('policy must have required independent obligations',()=>{
  const x=structuredClone(policy);x.obligations=[];
  assert.equal(evaluateEvidenceGraph(packet(),x).verdict,'INSUFFICIENT');
});

test('direct and multi-hop witness cycles cannot substantiate claims',()=>{
  assert.equal(evaluate(p=>{p.witnesses[0].depends_on=['w0']}).verdict,'UNTRUSTED_SOURCE');
  assert.equal(evaluate(p=>{
    p.witnesses[0].depends_on=['w1'];
    p.witnesses[1].depends_on=['w2'];
    p.witnesses[2].depends_on=['w0'];
  }).verdict,'UNTRUSTED_SOURCE');
});
test('dangling witness dependencies reject rather than silently disappear',()=>{
  assert.equal(evaluate(p=>{p.witnesses[0].depends_on=['missing-proof']}).verdict,'UNTRUSTED_SOURCE');
});


test('rejects a packet that substitutes a broader or unrelated claim predicate',()=>{
  const result=evaluate(p=>{
    p.predicate='All production programs and security boundaries are formally verified';
  });
  assert.equal(result.verdict,'POLICY_BLOCKED');
  assert.equal(result.release_authorized,false);
});
test('rejects a packet that expands the claimed semantic scope or targets',()=>{
  for(const mutate of [
    p=>{p.scope.language='TypeScript';},
    p=>{p.scope.semantics='unbounded-production-semantics';},
    p=>{p.scope.targets.push('wasm');},
    p=>{p.scope.targets=['js'];},
  ]){
    const result=evaluate(mutate);
    assert.equal(result.verdict,'POLICY_BLOCKED');
    assert.equal(result.supported_scope,null);
    assert.equal(result.release_authorized,false);
  }
});
