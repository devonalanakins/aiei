import {validateContract,validateReceipt} from './validate.mjs';

const equalLists = (a,b) => Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const uniq = list => [...new Set(list)];
/**
 * Structural policy assessment, NEVER proof that claimed evidence or approvers are genuine.
 * Deliberately returns a human-review readiness assessment, not an autonomous GO.
 */
export function assess(contract, receipt) {
  const contractValidation=validateContract(contract);
  const receiptValidation=validateReceipt(receipt);
  const errors=[...contractValidation.errors,...receiptValidation.errors];
  if (errors.length) return {valid:false, errors, blockers:['Malformed input cannot satisfy any release gate'], warnings:[], ready_for_human_review:false, independently_verified:false};
  const blockers=[],warnings=[];
  if (receipt.contract_id!==contract.contract_id) blockers.push('Receipt does not identify the exact contract');
  for(const field of ['repository','change_id','owner','risk_tier'])if(contract[field]!==receipt[field])blockers.push(`Receipt ${field} does not match frozen contract`);
  if(!equalLists(contract.acceptance_criteria,receipt.acceptance_criteria))blockers.push('Acceptance criteria changed or were reordered after contract freeze');
  if(!equalLists(contract.negative_cases,receipt.negative_cases))blockers.push('Negative cases changed or were reordered after contract freeze');
  if(receipt.release_decision==='NO_GO')blockers.push('Human-recorded release decision is NO_GO');
  if(receipt.status==='BLOCKED'||receipt.status==='RELEASE_NO_GO')blockers.push(`Receipt status is ${receipt.status}`);
  for(const risk of receipt.open_risks)blockers.push(`Unresolved risk: ${risk}`);
  for(const check of receipt.checks) {
    if(check.result!=='pass')blockers.push(`Check ${check.name}: ${check.result}`);
    if(check.result==='pass' && check.sha?.toLowerCase()!==receipt.head_sha.toLowerCase())blockers.push(`Check ${check.name}: missing or different commit SHA`);
    if(check.result==='pass' && (!check.observed_at||!check.environment||!check.kind||!check.covers))blockers.push(`Check ${check.name}: missing mandatory AIEI provenance`);
    if(check.environment==='production'&&check.synthetic===true)blockers.push(`Check ${check.name}: synthetic evidence mislabeled production`);
    if(check.result==='pass'&&check.kind==='production'&&check.environment!=='production')blockers.push(`Check ${check.name}: production claim from nonproduction environment`);
  }
  const criteria=[...contract.acceptance_criteria,...contract.negative_cases];
  for(const claim of criteria){
    if(!receipt.checks.some(c=>c.result==='pass'&&c.covers?.includes(claim)&&c.sha?.toLowerCase()===receipt.head_sha.toLowerCase()))blockers.push(`No exact-head passing check covers: ${claim}`);
  }
  const coverage=new Set(criteria);
  for(const check of receipt.checks)for(const claim of check.covers??[])if(!coverage.has(claim))blockers.push(`Check ${check.name}: cites unknown or obsolete claim`);
  if(['R2','R3'].includes(contract.risk_tier)) {
    if(!receipt.checks.some(c=>c.kind==='security'&&c.result==='pass'&&c.sha?.toLowerCase()===receipt.head_sha.toLowerCase()))blockers.push('Stateful/high-risk work requires exact-head security checks');
    if(!receipt.human_comprehension?.demonstrated||!receipt.human_comprehension?.evidence)blockers.push('Human understanding demonstration not recorded');
  }
  if(contract.risk_tier==='R3'){
    if(!receipt.checks.some(c=>c.kind==='recovery'&&c.result==='pass'&&c.sha?.toLowerCase()===receipt.head_sha.toLowerCase()))blockers.push('High-risk work requires exact-head recovery evidence');
    if(!receipt.independent_reviewer||receipt.independent_reviewer===contract.owner)blockers.push('High-risk change requires a different named independent qualified reviewer');
    if(!receipt.approvals.some(a=>a.name===contract.release_authority))blockers.push('Required release authority approval missing');
  }
  if(receipt.release_decision==='GO' && receipt.approvals.length===0)blockers.push('Declared GO has no human approval record');
  if(receipt.release_decision==='GO' && !['VERIFIED','LIVE'].includes(receipt.status))blockers.push('Declared GO requires a VERIFIED or LIVE status, not source-only IMPLEMENTED');
  if(receipt.status==='VERIFIED'&&!receipt.checks.some(c=>c.result==='pass'))blockers.push('VERIFIED requires passing check');
  if(receipt.status==='LIVE') {
    if(!receipt.production || receipt.production.environment!=='production'||receipt.production.outcome!=='pass'||receipt.production.deployed_sha?.toLowerCase()!==receipt.head_sha.toLowerCase())blockers.push('LIVE requires observed passing production journey for exact deployed SHA in production');
    if(!receipt.checks.some(c=>c.kind==='production'&&c.environment==='production'&&c.result==='pass'&&c.sha?.toLowerCase()===receipt.head_sha.toLowerCase()&&c.synthetic!==true))blockers.push('LIVE requires exact-head non-synthetic production check');
    if(receipt.approvals.length===0)blockers.push('LIVE requires human approval record');
  }
  if(receipt.production && receipt.production.deployed_sha?.toLowerCase()!==receipt.head_sha.toLowerCase())blockers.push('Production deployed SHA does not match receipt SHA');
  if(receipt.production?.outcome==='fail')blockers.push('Production observation failed');
  warnings.push('No evidence URLs, test results, signatures, reviewer credentials, or provider states were independently authenticated by this offline tool.');
  warnings.push('A policy-complete receipt still requires human review and any externally mandated specialist approval.');
  return {
    valid:true,
    errors:[],
    blockers:uniq(blockers),
    warnings,
    ready_for_human_review:blockers.length===0,
    independently_verified:false,
    declared_release_decision:receipt.release_decision,
    declared_status:receipt.status,
    contract_id:contract.contract_id,
    repository:contract.repository,
    head_sha:receipt.head_sha,
    risk_tier:contract.risk_tier
  };
}
