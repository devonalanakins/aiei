import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {digestJSON} from '../lib/evidence-graph.mjs';
import {POLICY_SIGNATURE_DOMAIN,verifyPinnedPolicySignature} from '../lib/policy-signature.mjs';
import {
  TRUST_REGISTRY_VERSION,validatePolicyTrustRegistry,checkOperatorPolicyRegistry,evaluateWithOperatorRegistry,
} from '../lib/policy-trust.mjs';

const owner=generateKeyPairSync('ed25519');
const successor=generateKeyPairSync('ed25519');
const attacker=generateKeyPairSync('ed25519');
const fingerprint=key=>createHash('sha256').update(
  key.publicKey.export({type:'spki',format:'der'})).digest('hex');
const hex=char=>char.repeat(64);
const source={
  repository:'devonalanakins/rhen',revision:'a'.repeat(40),
  source_sha256:hex('b'),ir_version:'rhen.typed.preview.v0',ir_sha256:hex('c'),
};
const policy={
  schema_version:'merit.policy.v1',claim_id:'safeint-prefix',
  predicate:'SafeInt trace matches independently specified oracle',
  scope:{language:'Rhen',semantics:'rhen.typed.preview.v0',targets:['reference','js','python']},
  subject:source,artifacts:{js:hex('d'),python:hex('e')},
  toolchains:{'rhen-reference':'node-22',js:'node-22',python:'python-3','independent-oracle':'oracle-v1'},
  obligations:[{id:'trace',producers:['rhen-reference','js','python','independent-oracle'],
    expected:{stdout:['7'],trap:'overflow'}}],
};
const baseNow='2026-11-06T19:00:00Z';
const start='2026-11-01T00:00:00Z',end='2026-12-01T00:00:00Z';
const keyRecord=(key,status='active')=>({
  fingerprint:fingerprint(key),status,valid_from:start,valid_until:end,
});
const approval=(key,value=policy)=>({
  digest:digestJSON(value),signer_fingerprint:fingerprint(key),
  valid_from:start,valid_until:end,
});
function registry() {
  return {schema_version:TRUST_REGISTRY_VERSION,epoch:10,
    repository:'devonalanakins/rhen',claim_id:'safeint-prefix',
    keys:[keyRecord(owner)],policies:[approval(owner)]};
}
function envelope(value=policy,key=owner) {
  const policyText=JSON.stringify(value);
  return {
    policyText,
    signatureBase64:sign(null,Buffer.concat([
      POLICY_SIGNATURE_DOMAIN,Buffer.from(policyText,'utf8'),
    ]),key.privateKey).toString('base64'),
    publicKeyPem:key.publicKey.export({type:'spki',format:'pem'}).toString(),
  };
}
function check(registered=registry(),input=envelope(),params={}) {
  return checkOperatorPolicyRegistry({
    ...input,trustRegistryText:JSON.stringify(registered),
    minimumTrustedEpoch:10,observedAt:baseNow,...params,
  });
}
function noAuthority(result) {
  for(const flag of ['independently_verified','provenance_authenticated',
    'policy_origin_independently_authenticated','witness_signatures_verified',
    'human_authorization_verified','release_authorized'])assert.equal(result[flag],false,flag);
}

test('approved signer, digest, epoch, and bounded validity window match only advisory registry',()=>{
  const result=check();
  assert.equal(result.status,'OPERATOR_REGISTRY_MATCH');
  assert.equal(result.signature_valid,true);
  assert.equal(result.operator_registry_match,true);
  assert.equal(result.policy_digest,digestJSON(policy));
  assert.equal(result.registry_epoch,10);
  assert.deepEqual(result.policy,policy);
  noAuthority(result);
});
test('no independently maintained epoch makes registry comparison fail closed',()=>{
  for(const minimumTrustedEpoch of [undefined,null,0,-1,1.5,'10']){
    const result=check(registry(),envelope(),{minimumTrustedEpoch});
    assert.equal(result.status,'BLOCKED');
    noAuthority(result);
  }
});
test('older registry revisions are blocked even when the signature was previously valid',()=>{
  const stale=registry();stale.epoch=9;
  const result=check(stale);
  assert.equal(result.status,'BLOCKED');
  assert.match(result.reason,/rollback/i);
  noAuthority(result);
});
test('revoked or expired signing key blocks even a valid detached signature',()=>{
  for(const mutate of [
    r=>{r.keys[0].status='revoked';},
    r=>{r.keys[0].valid_until='2026-11-06T19:00:00Z';},
    r=>{r.keys[0].valid_from='2026-11-06T19:00:01Z';},
  ]){
    const r=registry();mutate(r);
    const result=check(r);
    assert.equal(result.status,'BLOCKED');noAuthority(result);
  }
});
test('policy approval expiry, future approvals and unlisted policy digests block',()=>{
  for(const mutate of [
    r=>{r.policies[0].valid_until=baseNow;},
    r=>{r.policies[0].valid_from='2026-11-06T19:00:01Z';},
    r=>{r.policies[0].digest='f'.repeat(64);},
    r=>{r.policies=[];},
  ]){
    const r=registry();mutate(r);
    const result=check(r);
    assert.equal(result.status,'BLOCKED');noAuthority(result);
  }
});
test('cross-repository or claim-relabelled signed policies are not approved',()=>{
  for(const field of ['repository','claim_id']){
    const altered=structuredClone(policy);
    if(field==='repository')altered.subject.repository='different/repo';
    else altered.claim_id='unrelated-claim';
    const r=registry();r.policies=[approval(owner,altered)];
    assert.equal(check(r,envelope(altered)).status,'BLOCKED');
  }
});
test('unknown signer and attacker-controlled registry never establish authority',()=>{
  const input=envelope(policy,attacker);
  const result=check(registry(),input);
  assert.equal(result.status,'BLOCKED');noAuthority(result);
  const malicious=registry();malicious.keys=[keyRecord(attacker)];
  malicious.policies=[approval(attacker)];
  const selfSigned=check(malicious,input);
  assert.equal(selfSigned.status,'OPERATOR_REGISTRY_MATCH');
  assert.equal(selfSigned.policy_origin_independently_authenticated,false);
  noAuthority(selfSigned);
});
test('approved rotation to a second key can be represented without accepting a revoked original',()=>{
  const rotated=registry();
  rotated.epoch=11;
  rotated.keys=[keyRecord(owner,'revoked'),keyRecord(successor)];
  rotated.policies=[approval(owner),approval(successor)];
  assert.equal(check(rotated,envelope(policy,owner),{minimumTrustedEpoch:11}).status,'BLOCKED');
  const accepted=check(rotated,envelope(policy,successor),{minimumTrustedEpoch:11});
  assert.equal(accepted.status,'OPERATOR_REGISTRY_MATCH');
  noAuthority(accepted);
});
test('malformed duplicate JSON and ambiguous registry records fail validation',()=>{
  const base=registry();
  const malformed=[
    {...base,keys:[base.keys[0],base.keys[0]]},
    {...base,policies:[base.policies[0],base.policies[0]]},
    {...base,unknown:'extra'},
    {...base,keys:[]},
    {...base,keys:base.keys.map(k=>({...k,status:'pending'}))},
    {...base,policies:[{...base.policies[0],signer_fingerprint:'f'.repeat(64)}]},
    {...base,epoch:0},
    {...base,claim_id:'\nmalformed'},
    {...base,keys:base.keys.map(k=>({...k,valid_until:start}))},
    {...base,keys:base.keys.map(k=>({...k,valid_from:'2026-02-31T00:00:00Z'}))},
  ];
  for(const r of malformed){
    assert.equal(validatePolicyTrustRegistry(r).valid,false);
    const result=check(r);
    assert.equal(result.status,'BLOCKED');noAuthority(result);
  }
  const encoded=JSON.stringify(base).replace('"epoch":10','"epoch":10,"epoch":10');
  const result=check(base,envelope(),{trustRegistryText:encoded});
  assert.equal(result.status,'BLOCKED');noAuthority(result);
});
test('policy tampering and malformed signature remain blocked by the cryptographic preflight',()=>{
  const input=envelope();
  const tampered={...input,policyText:input.policyText.replace('SafeInt','AllInt')};
  assert.equal(check(registry(),tampered).status,'BLOCKED');
  assert.equal(check(registry(),{...input,signatureBase64:'not a signature'}).status,'BLOCKED');
});
test('time boundaries and malformed caller clock are rejected deterministically',()=>{
  const r=registry();
  assert.equal(check(r,envelope(),{observedAt:start}).status,'OPERATOR_REGISTRY_MATCH');
  assert.equal(check(r,envelope(),{observedAt:end}).status,'BLOCKED');
  for(const observedAt of [
    '2026-11-06T19:00:00.000Z','2026-02-31T00:00:00Z',
    '2026-11-06T19:00:00-05:00','tomorrow',
  ]) {
    const res=check(r,envelope(),{observedAt});
    assert.equal(res.status,'BLOCKED');
    noAuthority(res);
  }
});
test('registry parser limits and no registry input cannot manufacture trust',()=>{
  for(const trustRegistryText of [
    undefined,'{}','{',' '.repeat(1_048_577),
  ]) {
    const r=check(registry(),envelope(),{trustRegistryText});
    assert.equal(r.status,'BLOCKED');noAuthority(r);
  }
});


test('registry-gated evaluation cannot imply authenticated execution or human release',()=>{
  const witnesses=['rhen-reference','js','python','independent-oracle'].map((producer,i)=>({
    id:'w'+i,obligation:'trace',producer,run_id:'run-'+i,attempt:1,
    revision:source.revision,source_sha256:source.source_sha256,ir_sha256:source.ir_sha256,
    ...(producer==='js'||producer==='python'?{artifact_sha256:policy.artifacts[producer]}:{}),
    toolchain:policy.toolchains[producer],observed_at:baseNow,
    outcome:{stdout:['7'],trap:'overflow'},depends_on:[],
  }));
  const packet={
    schema_version:'merit.evidence.v1',claim_id:policy.claim_id,subject:source,
    predicate:policy.predicate,scope:structuredClone(policy.scope),
    assumptions:['synthetic controlled evaluation only'],
    policy_digest:digestJSON(policy),artifacts:structuredClone(policy.artifacts),
    witnesses,unsupported:[],open_obligations:[],verification_method:'synthetic test witnesses',
  };
  const args={...envelope(),trustRegistryText:JSON.stringify(registry()),
    minimumTrustedEpoch:10,observedAt:baseNow};
  const result=evaluateWithOperatorRegistry(packet,args);
  assert.equal(result.verdict,'SUPPORTED_WITH_SCOPE');
  assert.equal(result.operator_registry_match,true);
  assert.equal(result.policy_signature_verified,true);
  noAuthority(result);
  const revoked=registry();revoked.keys[0].status='revoked';
  const blocked=evaluateWithOperatorRegistry(packet,{
    ...args,trustRegistryText:JSON.stringify(revoked),
  });
  assert.equal(blocked.verdict,'POLICY_BLOCKED');
  assert.equal(blocked.operator_registry_match,false);
  noAuthority(blocked);
  const altered=structuredClone(packet);
  altered.predicate='All of production has been verified';
  const changed=evaluateWithOperatorRegistry(altered,args);
  assert.equal(changed.verdict,'POLICY_BLOCKED');
  noAuthority(changed);
});

test('null caller inputs fail closed rather than raising uncaught exceptions',()=>{
  const missingRegistry=checkOperatorPolicyRegistry(null);
  assert.equal(missingRegistry.status,'BLOCKED');
  noAuthority(missingRegistry);
  const missingSignature=verifyPinnedPolicySignature(null);
  assert.equal(missingSignature.status,'BLOCKED');
  noAuthority(missingSignature);
  const result=evaluateWithOperatorRegistry(null,null);
  assert.equal(result.verdict,'POLICY_BLOCKED');
  noAuthority(result);
});
