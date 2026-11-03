/**
 * AIEI v0.1: dependency-free, bounded schema validation.
 * These checks validate assertions about evidence; they do NOT prove evidence is genuine.
 */
export const SCHEMA_VERSION = 1;
export const RISKS = Object.freeze(['R0', 'R1', 'R2', 'R3']);
export const CLASSIFICATIONS = Object.freeze(['public', 'internal', 'restricted', 'regulated']);
export const STATUSES = Object.freeze(['IMPLEMENTED', 'VERIFIED', 'LIVE', 'RELEASE_NO_GO', 'BLOCKED']);
export const DECISIONS = Object.freeze(['GO', 'NO_GO', 'UNDECIDED']);
export const RESULTS = Object.freeze(['pass', 'fail', 'blocked', 'not_run']);
export const CHECK_KINDS = Object.freeze(['unit', 'integration', 'security', 'build', 'browser', 'recovery', 'production', 'review', 'other']);
export const ENVIRONMENTS = Object.freeze(['synthetic', 'local', 'isolated', 'staging', 'production']);
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
function str(errors, obj, field, path, {max = 2000, optional = false} = {}) {
  if (optional && !own(obj, field)) return;
  if (typeof obj[field] !== 'string' || !obj[field].trim() || obj[field].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(obj[field])) errors.push(`${path}.${field}: expected nonempty bounded text`);
}
function fields(errors, obj, path, required, allowed) {
  if (!isObject(obj)) { errors.push(`${path}: expected object`); return false; }
  for (const key of required) if (!own(obj, key)) errors.push(`${path}.${key}: missing required field`);
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) errors.push(`${path}.${key}: unrecognized field (fail closed)`);
  return true;
}
function en(errors, obj, key, path, values) {
  if (!values.includes(obj[key])) errors.push(`${path}.${key}: expected one of ${values.join(', ')}`);
}
function list(errors, obj, key, path, {min = 0, max = 100} = {}) {
  if (!Array.isArray(obj[key]) || obj[key].length < min || obj[key].length > max) {
    errors.push(`${path}.${key}: expected array with ${min}..${max} entries`);
    return [];
  }
  return obj[key];
}
function stringList(errors, obj, key, path, opts) {
  const values = list(errors, obj, key, path, opts);
  const seen = new Set();
  values.forEach((value, index) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) errors.push(`${path}.${key}[${index}]: expected nonempty text`);
    else if (seen.has(value)) errors.push(`${path}.${key}[${index}]: duplicate entry`);
    else seen.add(value);
  });
  return values;
}
function timestamp(errors, obj, key, path) {
  if (typeof obj[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(obj[key]) || Number.isNaN(Date.parse(obj[key]))) errors.push(`${path}.${key}: expected UTC ISO 8601 timestamp`);
}
function sha(errors, obj, key, path, optional = false) {
  if (optional && !own(obj, key)) return;
  if (typeof obj[key] !== 'string' || !SHA.test(obj[key])) errors.push(`${path}.${key}: expected exact 40-hex commit SHA`);
}
const CONTRACT_KEYS = ['schema_version', 'contract_id', 'organization', 'repository', 'change_id', 'owner', 'risk_tier', 'data_classification', 'problem', 'acceptance_criteria', 'negative_cases', 'invariants', 'non_goals', 'target_environments', 'release_authority', 'recovery_plan', 'threat_model', 'base_sha'];
export function validateContract(value) {
  const errors = [];
  if (!fields(errors, value, 'contract', ['schema_version', 'contract_id', 'organization', 'repository', 'change_id', 'owner', 'risk_tier', 'data_classification', 'problem', 'acceptance_criteria', 'negative_cases', 'invariants', 'non_goals', 'target_environments', 'release_authority', 'recovery_plan'], CONTRACT_KEYS)) return {valid:false, errors};
  if (value.schema_version !== SCHEMA_VERSION) errors.push('contract.schema_version: unsupported version');
  for (const key of ['contract_id', 'organization', 'repository', 'change_id', 'owner', 'problem', 'release_authority', 'recovery_plan']) str(errors, value, key, 'contract');
  if (typeof value.contract_id === 'string' && !ID.test(value.contract_id)) errors.push('contract.contract_id: invalid identifier');
  if (typeof value.repository === 'string' && !REPOSITORY.test(value.repository)) errors.push('contract.repository: expected owner/repo');
  en(errors, value, 'risk_tier', 'contract', RISKS);
  en(errors, value, 'data_classification', 'contract', CLASSIFICATIONS);
  stringList(errors, value, 'acceptance_criteria', 'contract', {min:1});
  stringList(errors, value, 'negative_cases', 'contract', {min:['R2', 'R3'].includes(value.risk_tier)?1:0});
  stringList(errors, value, 'invariants', 'contract');
  stringList(errors, value, 'non_goals', 'contract');
  const envs = stringList(errors, value, 'target_environments', 'contract', {min:1});
  envs.forEach((v, i) => {if (!ENVIRONMENTS.includes(v)) errors.push(`contract.target_environments[${i}]: unrecognized environment`);});
  sha(errors, value, 'base_sha', 'contract', true);
  if (value.risk_tier === 'R3') str(errors, value, 'threat_model', 'contract');
  else if (own(value, 'threat_model')) str(errors, value, 'threat_model', 'contract');
  return {valid:errors.length===0, errors};
}
const RECEIPT_KEYS = ['schema_version','contract_id','repository','change_id','head_sha','risk_tier','owner','status','release_decision','acceptance_criteria','negative_cases','checks','open_risks','approvals','production','independent_reviewer','human_comprehension','notes'];
const CHECK_KEYS = ['name','result','evidence','observed_at','sha','environment','kind','covers','synthetic'];
export function validateReceipt(value) {
  const errors = [];
  if (!fields(errors, value, 'receipt', ['schema_version','repository','change_id','head_sha','risk_tier','owner','status','release_decision','acceptance_criteria','negative_cases','checks','open_risks','approvals'], RECEIPT_KEYS)) return {valid:false, errors};
  if (value.schema_version !== SCHEMA_VERSION) errors.push('receipt.schema_version: unsupported version');
  for (const key of ['repository','change_id','owner']) str(errors,value,key,'receipt');
  if (typeof value.repository === 'string' && !REPOSITORY.test(value.repository)) errors.push('receipt.repository: expected owner/repo');
  if (own(value, 'contract_id')) str(errors, value, 'contract_id', 'receipt');
  sha(errors,value,'head_sha','receipt');
  en(errors,value,'risk_tier','receipt',RISKS);
  en(errors,value,'status','receipt',STATUSES);
  en(errors,value,'release_decision','receipt',DECISIONS);
  stringList(errors,value,'acceptance_criteria','receipt',{min:1});
  stringList(errors,value,'negative_cases','receipt');
  stringList(errors,value,'open_risks','receipt');
  if (own(value,'notes')) str(errors,value,'notes','receipt',{max:10000});
  if (own(value,'independent_reviewer')) str(errors,value,'independent_reviewer','receipt');
  const checks = list(errors,value,'checks','receipt',{min:1,max:200});
  checks.forEach((c,i) => {
    const p=`receipt.checks[${i}]`;
    if (!fields(errors,c,p,['name','result','evidence'],CHECK_KEYS)) return;
    str(errors,c,'name',p,{max:250});
    en(errors,c,'result',p,RESULTS);
    str(errors,c,'evidence',p,{max:3000});
    if (own(c,'observed_at')) timestamp(errors,c,'observed_at',p);
    if (own(c,'sha')) sha(errors,c,'sha',p);
    if (own(c,'environment')) en(errors,c,'environment',p,ENVIRONMENTS);
    if (own(c,'kind')) en(errors,c,'kind',p,CHECK_KINDS);
    if (own(c,'synthetic') && typeof c.synthetic!=='boolean') errors.push(`${p}.synthetic: expected boolean`);
    if (own(c,'covers')) stringList(errors,c,'covers',p,{min:1});
  });
  const approvals = list(errors,value,'approvals','receipt',{max:30});
  approvals.forEach((a,i)=>{
    const p=`receipt.approvals[${i}]`;
    if (!fields(errors,a,p,['name','role','decision','evidence','observed_at'],['name','role','decision','evidence','observed_at'])) return;
    for(const k of ['name','role','evidence']) str(errors,a,k,p);
    if (a.decision!=='approved')errors.push(`${p}.decision: must be approved (denials are open risks)`);
    timestamp(errors,a,'observed_at',p);
  });
  if (own(value,'production')) {
    const p='receipt.production',o=value.production;
    if (fields(errors,o,p,['environment','outcome','observed_at','evidence','deployed_sha'],['environment','outcome','observed_at','evidence','deployed_sha','journey'])) {
      str(errors,o,'environment',p);
      if(o.outcome!=='pass'&&o.outcome!=='fail')errors.push(`${p}.outcome: expected pass or fail`);
      timestamp(errors,o,'observed_at',p);
      str(errors,o,'evidence',p);
      sha(errors,o,'deployed_sha',p);
      if (own(o,'journey')) str(errors,o,'journey',p);
    }
  }
  if (own(value,'human_comprehension')) {
    const p='receipt.human_comprehension',o=value.human_comprehension;
    if (fields(errors,o,p,['reviewer','evidence','demonstrated'],['reviewer','evidence','demonstrated'])) {
      str(errors,o,'reviewer',p);str(errors,o,'evidence',p);
      if(typeof o.demonstrated!=='boolean')errors.push(`${p}.demonstrated: expected boolean`);
    }
  }
  return {valid:errors.length===0, errors};
}
