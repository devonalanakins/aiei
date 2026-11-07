// Experimental OFFLINE, source-only owner-configured policy trust lifecycle.
// A caller-provided registry and minimum epoch are NOT proof of owner authority.
import {parseEvidenceJSON,evaluateEvidenceGraph} from './evidence-graph.mjs';
import {verifyPinnedPolicySignature} from './policy-signature.mjs';

export const TRUST_REGISTRY_VERSION='merit.policy-trust-registry.v1';
const DIGEST=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const own=(obj,key)=>Object.hasOwn(obj,key);
const shape=(v,keys)=>v!==null && typeof v==='object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v)===Object.prototype &&
  Object.keys(v).every(k=>keys.includes(k)) &&
  keys.every(k=>own(v,k));
const timestamp=v=>{
  if(typeof v!=='string'||!(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)))return null;
  const ms=Date.parse(v);
  return Number.isFinite(ms)&&new Date(ms).toISOString()===v.replace(/Z$/,'.000Z')?ms:null;
};
const windowOK=(v)=>timestamp(v.valid_from)!==null &&
  timestamp(v.valid_until)!==null &&
  timestamp(v.valid_from)<timestamp(v.valid_until);
const inWindow=(v,now)=>timestamp(v.valid_from)<=now && now<timestamp(v.valid_until);
const blocked=(reason,extra={})=>({
  status:'BLOCKED',
  reason,
  schema_version:TRUST_REGISTRY_VERSION,
  registry_epoch:null,
  operator_registry_match:false,
  signature_valid:false,
  policy_digest:null,
  policy:null,
  independently_verified:false,
  provenance_authenticated:false,
  policy_origin_independently_authenticated:false,
  witness_signatures_verified:false,
  human_authorization_verified:false,
  release_authorized:false,
  ...extra,
});

export function validatePolicyTrustRegistry(value) {
  const errors=[];
  if(!shape(value,['schema_version','epoch','repository','claim_id','keys','policies']))
    return {valid:false,errors:['Expected only the six required registry fields']};
  if(value.schema_version!==TRUST_REGISTRY_VERSION)errors.push('Unsupported trust registry schema');
  if(!Number.isSafeInteger(value.epoch)||value.epoch<1)errors.push('Invalid monotonic epoch');
  if(typeof value.repository!=='string'||!REPO.test(value.repository))errors.push('Invalid repository');
  if(typeof value.claim_id!=='string'||!ID.test(value.claim_id))errors.push('Invalid claim ID');
  if(!Array.isArray(value.keys)||value.keys.length<1||value.keys.length>16)
    errors.push('Keys must be 1-16 entries');
  else {
    const seen=new Set();
    for(const key of value.keys){
      if(!shape(key,['fingerprint','status','valid_from','valid_until'])||
         typeof key.fingerprint!=='string'||!DIGEST.test(key.fingerprint)||
         !['active','revoked'].includes(key.status)||!windowOK(key)) {
        errors.push('Invalid key record');continue;
      }
      if(seen.has(key.fingerprint))errors.push('Duplicate key fingerprint');
      seen.add(key.fingerprint);
    }
  }
  if(!Array.isArray(value.policies)||value.policies.length<1||value.policies.length>64)
    errors.push('Approved policy digests must be 1-64 entries');
  else {
    const seen=new Set();
    for(const approved of value.policies){
      if(!shape(approved,['digest','signer_fingerprint','valid_from','valid_until'])||
         typeof approved.digest!=='string'||!DIGEST.test(approved.digest)||
         typeof approved.signer_fingerprint!=='string'||!DIGEST.test(approved.signer_fingerprint)||
         !windowOK(approved)) {
        errors.push('Invalid approved policy record');continue;
      }
      const pair=approved.digest+'/'+approved.signer_fingerprint;
      if(seen.has(pair))errors.push('Duplicate approval record');
      seen.add(pair);
      if(Array.isArray(value.keys)&&
         !value.keys.some(key=>key?.fingerprint===approved.signer_fingerprint))
        errors.push('Approved policy has no registered signer');
    }
  }
  return {valid:errors.length===0,errors};
}

/**
 * No I/O or trust bootstrap: registryText and minimumTrustedEpoch MUST be
 * obtained from separate owner-controlled channels. The observedAt override
 * is for deterministic tests; a caller-chosen clock is not a security oracle.
 * Replayed registries are rejected ONLY when a trusted minimum epoch is
 * independently maintained and provided.
 */
export function checkOperatorPolicyRegistry(input={}) {
  const {
    policyText,signatureBase64,publicKeyPem,trustRegistryText,
    minimumTrustedEpoch,observedAt=new Date().toISOString().slice(0,19)+'Z',
  }=input??{};
  if(typeof trustRegistryText!=='string')
    return blocked('Missing independently provisioned registry JSON bytes');
  if(!Number.isSafeInteger(minimumTrustedEpoch)||minimumTrustedEpoch<1)
    return blocked('Missing independently maintained minimum trust epoch');
  const now=timestamp(observedAt);
  if(now===null)return blocked('Invalid or untrusted evaluation timestamp format');
  let registry;
  try {registry=parseEvidenceJSON(trustRegistryText);}
  catch{return blocked('Invalid or ambiguous registry JSON');}
  const valid=validatePolicyTrustRegistry(registry);
  if(!valid.valid)return blocked('Invalid trust registry: '+valid.errors.join('; '));
  if(registry.epoch<minimumTrustedEpoch)
    return blocked('Trust registry rollback below independent epoch high-water mark');
  const extra={registry_epoch:registry.epoch};
  // Extract fingerprint from a real Ed25519 public key ONLY after the existing
  // signature preflight validates its encoding and cryptographic relationship.
  // Try active/registered pins; never accept a key based solely on its own claim.
  for(const key of registry.keys){
    if(key.status!=='active')continue;
    const verified=verifyPinnedPolicySignature({
      policyText,signatureBase64,publicKeyPem,trustedKeySha256:key.fingerprint,
    });
    if(verified.status!=='PINNED_SIGNATURE_VALID')continue;
    if(!inWindow(key,now))return blocked('Signer is outside its authorized time window',extra);
    if(verified.policy.subject.repository!==registry.repository ||
       verified.policy.claim_id!==registry.claim_id)
      return blocked('Signed policy is outside registry repository or claim scope',extra);
    const found=registry.policies.find(p=>p.digest===verified.policy_digest &&
      p.signer_fingerprint===key.fingerprint);
    if(!found)return blocked('Signed policy digest is not explicitly approved in this registry',extra);
    if(!inWindow(found,now))return blocked('Signed policy approval is not currently valid',extra);
    return {
      ...blocked(null,extra),
      status:'OPERATOR_REGISTRY_MATCH',
      reason:null,
      operator_registry_match:true,
      signature_valid:true,
      policy_digest:verified.policy_digest,
      policy:verified.policy,
    };
  }
  return blocked('No active registered key validates this signature',extra);
}


/** Evaluate only after the *caller-provisioned* registry checks succeed.
 * Never elevate this to independent provenance or actual release permission.
 */
export function evaluateWithOperatorRegistry(packet,options) {
  const match=checkOperatorPolicyRegistry(options);
  if(match.status!=='OPERATOR_REGISTRY_MATCH') {
    return {
      schema_version:'merit.evidence.v1',
      claim_id:null,
      valid:false,
      verdict:'POLICY_BLOCKED',
      reasons:['Operator registry preflight failed: '+match.reason],
      missing_obligations:[],
      supported_scope:null,
      operator_registry_match:false,
      independently_verified:false,
      provenance_authenticated:false,
      policy_origin_independently_authenticated:false,
      witness_signatures_verified:false,
      human_authorization_verified:false,
      release_authorized:false,
    };
  }
  return {
    ...evaluateEvidenceGraph(packet,match.policy),
    operator_registry_match:true,
    policy_signature_verified:true,
    independently_verified:false,
    provenance_authenticated:false,
    policy_origin_independently_authenticated:false,
    witness_signatures_verified:false,
    human_authorization_verified:false,
    release_authorized:false,
  };
}
