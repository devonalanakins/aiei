// Experimental, advisory-only Ed25519 policy signature preflight.
// The trusted SPKI SHA-256 pin MUST come from the operator's independent trust store.
// This never verifies witness execution or grants human/release authority.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {digestJSON,parseEvidenceJSON,validateEvidencePolicy,evaluateEvidenceGraph} from './evidence-graph.mjs';

export const POLICY_SIGNATURE_DOMAIN=Buffer.from('Merit.policy.signature.v1\0','utf8');
const FINGERPRINT=/^[a-f0-9]{64}$/;
const PEM=/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+?\r?\n-----END PUBLIC KEY-----\r?\n?$/;

function denied(reason,extra={}) {
  return {
    schema_version:'merit.policy-signature-check.v1',
    status:'BLOCKED',
    reason,
    key_pin_matched:false,
    signature_valid:false,
    policy_schema_valid:false,
    policy_digest:null,
    policy:null,
    policy_origin_independently_authenticated:false,
    independently_verified:false,
    provenance_authenticated:false,
    witness_signatures_verified:false,
    human_authorization_verified:false,
    release_authorized:false,
    ...extra,
  };
}

/**
 * Only an offline preflight. "signature_valid" is a cryptographic fact about
 * bytes and the pinned key, not proof that the pin was selected independently.
 * The signed bytes are the exact UTF-8 JSON text after domain separation.
 * There is deliberately no canonical-JSON or network trust discovery.
 */
export function verifyPinnedPolicySignature(input={}) {
  const {policyText,signatureBase64,publicKeyPem,trustedKeySha256}=input??{};
  if(typeof policyText!=='string' || Buffer.byteLength(policyText,'utf8')>1_048_576)
    return denied('Missing or oversized policy bytes');
  if(typeof trustedKeySha256!=='string'||!FINGERPRINT.test(trustedKeySha256))
    return denied('Missing or invalid independently supplied key fingerprint');
  if(typeof publicKeyPem!=='string'||publicKeyPem.length>4096||!PEM.test(publicKeyPem))
    return denied('A bounded PEM public key is required');
  let key,fingerprint;
  try {
    key=createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=='ed25519')return denied('Only Ed25519 policy public keys are allowed');
    const bytes=key.export({format:'der',type:'spki'});
    fingerprint=createHash('sha256').update(bytes).digest('hex');
  } catch {
    return denied('Invalid policy public key');
  }
  if(fingerprint!==trustedKeySha256)
    return denied('Policy signer does not match the independently supplied pin');
  const pinned={key_pin_matched:true};
  if(typeof signatureBase64!=='string'||signatureBase64.length!==88||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64))
    return denied('Invalid detached Ed25519 signature encoding',pinned);
  const signature=Buffer.from(signatureBase64,'base64');
  if(signature.length!==64||signature.toString('base64')!==signatureBase64)
    return denied('Noncanonical detached signature encoding',pinned);
  let policy;
  try {
    policy=parseEvidenceJSON(policyText);
    if(!validateEvidencePolicy(policy).valid)
      return denied('The signed policy fails the Merit policy schema',pinned);
  } catch {
    return denied('Malformed or ambiguous policy JSON',pinned);
  }
  const formatted={...pinned,policy_schema_valid:true};
  const message=Buffer.concat([POLICY_SIGNATURE_DOMAIN,Buffer.from(policyText,'utf8')]);
  let signed=false;
  try {signed=verify(null,message,key,signature);}catch{return denied('Cryptographic signature verification failed',formatted);}
  if(!signed)return denied('Detached signature does not match the policy bytes',formatted);
  return {
    ...denied(null),
    status:'PINNED_SIGNATURE_VALID',
    reason:null,
    key_pin_matched:true,
    signature_valid:true,
    policy_schema_valid:true,
    policy_digest:digestJSON(policy),
    policy,
  };
}


/**
 * A caller must supply a trusted SPKI pin via an independent, approved channel.
 * Only policy authenticity against THAT pin is checked. Witness observations,
 * tests, human approvals and production deployments are NOT authenticated.
 */
export function evaluateWithPinnedPolicy(packet,signatureInputs) {
  const verified=verifyPinnedPolicySignature(signatureInputs);
  if(verified.status!=='PINNED_SIGNATURE_VALID') {
    return {
      schema_version:'merit.evidence.v1',
      claim_id:null,
      valid:false,
      verdict:'POLICY_BLOCKED',
      reasons:['Signed policy preflight failed: '+verified.reason],
      missing_obligations:[],
      supported_scope:null,
      policy_signature_verified:false,
      policy_key_pin_matched:verified.key_pin_matched,
      independently_verified:false,
      provenance_authenticated:false,
      witness_signatures_verified:false,
      human_authorization_verified:false,
      release_authorized:false,
    };
  }
  const evaluated=evaluateEvidenceGraph(packet,verified.policy);
  return {
    ...evaluated,
    policy_signature_verified:true,
    policy_key_pin_matched:true,
    policy_origin_independently_authenticated:false,
    witness_signatures_verified:false,
    human_authorization_verified:false,
    independently_verified:false,
    provenance_authenticated:false,
    release_authorized:false,
  };
}
