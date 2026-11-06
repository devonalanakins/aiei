import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {digestJSON} from '../lib/evidence-graph.mjs';
import {POLICY_SIGNATURE_DOMAIN,verifyPinnedPolicySignature,evaluateWithPinnedPolicy} from '../lib/policy-signature.mjs';

// Synthetic ephemeral Ed25519 keys only; no persistent signing authority or credentials.
const keyPair=generateKeyPairSync('ed25519');
const impostor=generateKeyPairSync('ed25519');
const pem=keyPair.publicKey.export({type:'spki',format:'pem'}).toString();
const spkiDigest=key=>createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
const trustedPin=spkiDigest(keyPair.publicKey);
const hex=value=>value.repeat(64);
const subject={
  repository:'devonalanakins/rhen',revision:'a'.repeat(40),
  source_sha256:hex('b'),ir_version:'rhen.typed.preview.v0',ir_sha256:hex('c'),
};
const expected={stdout:['7'],trap:'overflow'};
const policy={
  schema_version:'merit.policy.v1',
  claim_id:'safeint-prefix',
  predicate:'Rhen SafeInt trace matches independently specified oracle',
  subject,
  scope:{language:'Rhen',semantics:'rhen.typed.preview.v0',targets:['reference','js','python']},
  artifacts:{js:hex('d'),python:hex('e')},
  toolchains:{'rhen-reference':'node-22',js:'node-22',python:'python-3','independent-oracle':'oracle-v1'},
  obligations:[{id:'trace',producers:['rhen-reference','js','python','independent-oracle'],expected}],
};
function signedPolicy(value=policy,privateKey=keyPair.privateKey) {
  const policyText=typeof value==='string'?value:JSON.stringify(value);
  const signed=sign(null,Buffer.concat([POLICY_SIGNATURE_DOMAIN,Buffer.from(policyText,'utf8')]),privateKey);
  return {policyText,signatureBase64:signed.toString('base64'),publicKeyPem:pem,trustedKeySha256:trustedPin};
}
function packet() {
  const producers=['rhen-reference','js','python','independent-oracle'];
  return {
    schema_version:'merit.evidence.v1',claim_id:policy.claim_id,subject,
    predicate:policy.predicate,scope:structuredClone(policy.scope),
    assumptions:['synthetic test; no authenticated witness execution'],
    policy_digest:digestJSON(policy),artifacts:structuredClone(policy.artifacts),
    witnesses:producers.map((producer,i)=>({
      id:'w'+i,obligation:'trace',producer,run_id:'run-'+i,attempt:1,
      revision:subject.revision,source_sha256:subject.source_sha256,ir_sha256:subject.ir_sha256,
      ...(producer==='js'||producer==='python'?{artifact_sha256:policy.artifacts[producer]}:{}),
      toolchain:policy.toolchains[producer],
      observed_at:'2026-11-04T21:00:00Z',outcome:structuredClone(expected),depends_on:[],
    })),
    unsupported:[],open_obligations:[],verification_method:'synthetic controlled witnesses',
  };
}
function noRelease(result) {
  assert.equal(result.release_authorized,false);
  assert.equal(result.provenance_authenticated,false);
  assert.equal(result.witness_signatures_verified,false);
  assert.equal(result.human_authorization_verified,false);
}

test('known-key Ed25519 signature verifies only the exact policy bytes',()=>{
  const result=verifyPinnedPolicySignature(signedPolicy());
  assert.equal(result.status,'PINNED_SIGNATURE_VALID');
  assert.equal(result.key_pin_matched,true);
  assert.equal(result.signature_valid,true);
  assert.equal(result.policy_schema_valid,true);
  assert.equal(result.policy_digest,digestJSON(policy));
  assert.deepEqual(result.policy,policy);
  assert.equal(result.policy_origin_independently_authenticated,false);
  noRelease(result);
});
test('verified policy preflight gates graph but cannot authenticate witnesses',()=>{
  const result=evaluateWithPinnedPolicy(packet(),signedPolicy());
  assert.equal(result.verdict,'SUPPORTED_WITH_SCOPE');
  assert.equal(result.policy_signature_verified,true);
  assert.equal(result.policy_key_pin_matched,true);
  assert.equal(result.independently_verified,false);
  noRelease(result);
  const altered=packet();altered.predicate='Every production release was independently verified';
  const blocked=evaluateWithPinnedPolicy(altered,signedPolicy());
  assert.equal(blocked.verdict,'POLICY_BLOCKED');
  assert.equal(blocked.policy_signature_verified,true);
  noRelease(blocked);
});
test('no out-of-band trust pin means no policy trust',()=>{
  for(const args of [
    {...signedPolicy(),trustedKeySha256:null},
    {...signedPolicy(),trustedKeySha256:'0'.repeat(64)},
    {...signedPolicy(),trustedKeySha256:trustedPin.toUpperCase()},
    {...signedPolicy(),publicKeyPem:impostor.publicKey.export({format:'pem',type:'spki'}).toString()},
  ]) {
    const result=verifyPinnedPolicySignature(args);
    assert.equal(result.status,'BLOCKED');assert.equal(result.signature_valid,false);noRelease(result);
    assert.equal(evaluateWithPinnedPolicy(packet(),args).verdict,'POLICY_BLOCKED');
  }
});
test('a matching signature from a different key cannot impersonate the pinned signer',()=>{
  const args=signedPolicy(policy,impostor.privateKey);
  const result=verifyPinnedPolicySignature(args);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.key_pin_matched,true);
  assert.equal(result.signature_valid,false);
  noRelease(result);
});
test('changing signed bytes, whitespace, or detached signature fails closed',()=>{
  const original=signedPolicy();
  const inputs=[
    {...original,policyText:original.policyText.replace('SafeInt','SafeInt++')},
    {...original,policyText:original.policyText+'\n'},
    {...original,signatureBase64:Buffer.alloc(64,11).toString('base64')},
    {...original,signatureBase64:original.signatureBase64.slice(0,-1)},
  ];
  for(const args of inputs) {
    const result=verifyPinnedPolicySignature(args);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.release_authorized,false);
    assert.equal(evaluateWithPinnedPolicy(packet(),args).verdict,'POLICY_BLOCKED');
  }
});
test('domain-separated signatures reject a policy signature for a different protocol',()=>{
  const original=signedPolicy();
  const noDomain=sign(null,Buffer.from(original.policyText,'utf8'),keyPair.privateKey);
  const result=verifyPinnedPolicySignature({...original,signatureBase64:noDomain.toString('base64')});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.signature_valid,false);
});
test('validly signed malformed or ambiguous policy is still blocked',()=>{
  const raw=JSON.stringify(policy);
  const ambiguous=raw.replace('"claim_id":"safeint-prefix"','"claim_id":"safeint-prefix","claim_id":"safeint-prefix"');
  const unscoped=structuredClone(policy);delete unscoped.scope;
  const changed=structuredClone(policy);changed.scope.targets.push('js');
  for(const value of [ambiguous,unscoped,changed,'{}','{']) {
    const result=verifyPinnedPolicySignature(signedPolicy(value));
    assert.equal(result.status,'BLOCKED');assert.equal(result.policy_schema_valid,false);noRelease(result);
  }
});
test('oversized, invalid encoding and invalid key material cannot verify',()=>{
  const original=signedPolicy();
  for(const args of [
    {...original,policyText:' '.repeat(1_048_577)},
    {...original,publicKeyPem:'not a PEM'},
    {...original,signatureBase64:'%%%'},
    {...original,signatureBase64:undefined},
    {},
  ]) {
    const result=verifyPinnedPolicySignature(args);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.release_authorized,false);
  }
});
test('replayed signed but outdated policy does not validate a modified packet digest',()=>{
  const outdated=signedPolicy();
  const changed=packet();changed.policy_digest='f'.repeat(64);
  const result=evaluateWithPinnedPolicy(changed,outdated);
  assert.equal(result.verdict,'POLICY_BLOCKED');
  assert.equal(result.policy_signature_verified,true);
  noRelease(result);
});
