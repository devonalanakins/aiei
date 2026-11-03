import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assess,validateContract,validateReceipt} from '../lib/index.mjs';
const src = file => JSON.parse(readFileSync(new URL(file, import.meta.url),'utf8'));
const contract = () => src('../examples/contract.json');
const receipt = () => src('../examples/receipt.json');
const clean = () => {
  const c=contract(),r=receipt();
  r.status='VERIFIED';r.release_decision='UNDECIDED';r.open_risks=[];
  r.human_comprehension={reviewer:'Example Maintainer',demonstrated:true,evidence:'synthetic exercise; human evaluation still required'};
  return {c,r};
};

test('synthetic example validates structurally and deliberately returns NO_GO',()=>{
  const c=contract(),r=receipt();
  assert.deepEqual(validateContract(c),{valid:true,errors:[]});
  assert.deepEqual(validateReceipt(r),{valid:true,errors:[]});
  const result=assess(c,r);
  assert.equal(result.valid,true);
  assert.equal(result.ready_for_human_review,false);
  assert(result.blockers.some(x=>x.includes('NO_GO')));
  assert.equal(result.independently_verified,false);
});

test('structural validation rejects unknown typo, missing field and duplicate criteria',()=>{
  const c=contract();c.recovery_plna='typo';delete c.recovery_plan;
  const v=validateContract(c);
  assert.equal(v.valid,false);
  assert(v.errors.some(x=>x.includes('recovery_plan: missing')));
  assert(v.errors.some(x=>x.includes('recovery_plna: unrecognized')));
  const c2=contract();c2.acceptance_criteria.push(c2.acceptance_criteria[0]);
  assert(validateContract(c2).errors.some(x=>x.includes('duplicate')));
});

test('malformed receipt and forged shortcut labels cannot pass validation',()=>{
  const r=receipt();r.checks[0].result='succeeded';r.head_sha='latest';
  const v=validateReceipt(r);
  assert.equal(v.valid,false);
  assert(v.errors.some(x=>x.includes('commit SHA')));
  assert(v.errors.some(x=>x.includes('expected one of')));
});

test('contract alteration invalidates original frozen acceptance and negative cases',()=>{
  const {c,r}=clean();c.negative_cases[0]='Only a subset of requests must be denied';
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('Negative cases changed')));
});

test('head SHA mismatch blocks even when check is marked passing',()=>{
  const {c,r}=clean();r.checks[0].sha='f'.repeat(40);
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('different commit SHA')));
  assert(a.blockers.some(x=>x.includes('No exact-head passing check')));
});

test('a passing test that covers no original negative case does not qualify',()=>{
  const {c,r}=clean();r.checks[1].covers=['An authorized user can save a draft within their own workspace'];
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes("different authenticated user")));
});

test('unknown acceptance references are blocked',()=>{
  const {c,r}=clean();r.checks[1].covers.push('Arbitrary new claim');
  assert(assess(c,r).blockers.some(x=>x.includes('unknown or obsolete claim')));
});

test('passing synthetic R2 checks with no human comprehension cannot pass',()=>{
  const {c,r}=clean();delete r.human_comprehension;
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('understanding')));
});

test('failed, blocked or unrun evidence cannot become a GO by self-declaration',()=>{
  for(const result of ['fail','blocked','not_run']){
    const {c,r}=clean();r.status='VERIFIED';r.release_decision='GO';
    r.approvals=[{name:'Example Maintainer',role:'owner',decision:'approved',evidence:'example',observed_at:'2026-11-03T12:00:00Z'}];
    r.checks[0].result=result;
    assert.equal(assess(c,r).ready_for_human_review,false);
  }
});

test('LIVE cannot be declared from synthetic tests or absent deployment observation',()=>{
  const {c,r}=clean();r.status='LIVE';
  assert(assess(c,r).blockers.some(x=>x.includes('production journey')));
  r.approvals=[{name:'Example Maintainer',role:'owner',decision:'approved',evidence:'example',observed_at:'2026-11-03T12:00:00Z'}];
  r.production={environment:'production',outcome:'pass',observed_at:'2026-11-03T12:00:00Z',evidence:'example',deployed_sha:r.head_sha};
  r.checks.push({name:'Synthetic-only pretend production',result:'pass',evidence:'example',kind:'production',environment:'production',synthetic:true,sha:r.head_sha,observed_at:'2026-11-03T12:00:00Z',covers:[c.acceptance_criteria[0]]});
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('synthetic evidence mislabeled')));
  assert(a.blockers.some(x=>x.includes('non-synthetic production check')));
});

test('R3 requires threat model, recovery verification and separate human reviewer',()=>{
  const {c,r}=clean();c.risk_tier='R3';r.risk_tier='R3';
  assert(validateContract(c).errors.some(x=>x.includes('threat_model')));
  c.threat_model='Threat surfaces include authorization, durability and recovery';
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('recovery evidence')));
  assert(a.blockers.some(x=>x.includes('independent qualified reviewer')));
  assert(a.blockers.some(x=>x.includes('release authority approval')));
});

test('policy-complete synthetic evidence is eligible only for human review, not verification',()=>{
  const {c,r}=clean();
  const result=assess(c,r);
  assert.equal(result.valid,true);
  assert.equal(result.ready_for_human_review,true);
  assert.equal(result.independently_verified,false);
  assert(result.warnings.some(x=>x.includes('independently authenticated')));
});

test('cross-repository and owner mismatch cannot be silently accepted',()=>{
  const {c,r}=clean();r.repository='other/repo';r.owner='Different Owner';
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('repository')));
  assert(a.blockers.some(x=>x.includes('owner')));
});

test('production deployed SHA must match the reviewed source',()=>{
  const {c,r}=clean();r.production={environment:'production',outcome:'pass',observed_at:'2026-11-03T12:00:00Z',evidence:'example',deployed_sha:'f'.repeat(40)};
  assert(assess(c,r).blockers.some(x=>x.includes('Production deployed SHA')));
});

test('R2 missing security verification remains blocked',()=>{
  const {c,r}=clean();r.checks[1].kind='unit';
  assert(assess(c,r).blockers.some(x=>x.includes('security checks')));
});


test('release GO is blocked for source-only implementation status even with passing synthetic checks',()=>{
  const {c,r}=clean();r.release_decision='GO';r.status='IMPLEMENTED';
  r.approvals=[{name:'Example Maintainer',role:'owner',decision:'approved',evidence:'example',observed_at:'2026-11-03T12:00:00Z'}];
  const a=assess(c,r);
  assert(a.blockers.some(x=>x.includes('source-only IMPLEMENTED')));
});


test('LIVE production observation must name production, not staging',()=>{
  const {c,r}=clean();r.status='LIVE';
  r.approvals=[{name:'Example Maintainer',role:'owner',decision:'approved',evidence:'example',observed_at:'2026-11-03T12:00:00Z'}];
  r.production={environment:'staging',outcome:'pass',observed_at:'2026-11-03T12:00:00Z',evidence:'example',deployed_sha:r.head_sha};
  r.checks.push({name:'Production-labelled check',result:'pass',evidence:'example',kind:'production',environment:'production',synthetic:false,sha:r.head_sha,observed_at:'2026-11-03T12:00:00Z',covers:[c.acceptance_criteria[0]]});
  assert(assess(c,r).blockers.some(x=>x.includes('in production')));
});
