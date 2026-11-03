import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGitHubPR,compareGitHubReceipt,parseGitHubTarget} from '../lib/index.mjs';

const SHA='0123456789abcdef0123456789abcdef01234567';
const BASE='a'.repeat(40);
const REPO='sample/aiei-test';
const pr = (sha=SHA) => ({
  number:31,state:'open',draft:true,merged_at:null,
  head:{sha,repo:{full_name:REPO}},base:{sha:BASE,repo:{full_name:REPO}}
});
const fixture = () => ({
  pull_request:pr(), pull_request_recheck:pr(),
  check_runs:{total_count:1,check_runs:[{id:101,name:'unit and security',head_sha:SHA,status:'completed',conclusion:'success',app:{slug:'github-actions'}}]},
  commit_status:{sha:SHA,state:'success',total_count:1,statuses:[{context:'sast',state:'success'}]},
  workflow_runs:{total_count:1,workflow_runs:[{id:202,name:'verify',head_sha:SHA,status:'completed',conclusion:'success',event:'pull_request'}]}
});
function simulatedFetch(fixtures=fixture(),{statuses={},links={},calls=[]}={}) {
  let pulls=0;
  return async (url,opts) => {
    calls.push({url,opts});
    assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
    assert.equal(new URL(url).origin,'https://api.github.com');
    const label=url.includes('/check-runs?')?'check_runs':url.includes('/actions/runs?')?'workflow_runs':
      url.includes('/status?')?'commit_status':pulls++===0?'pull_request':'pull_request_recheck';
    const status=statuses[label]??200;
    return new Response(JSON.stringify(fixtures[label]),{status,headers:{'Content-Type':'application/json',...(links[label]?{Link:links[label]}:{})}});
  };
}
const inspect=(options={})=>inspectGitHubPR({repository:REPO,prNumber:31,fetchImpl:simulatedFetch(),...options});
function matchingReceipt(){
  return {
    schema_version:1,repository:REPO,change_id:'PR-31',head_sha:SHA,risk_tier:'R2',owner:'Synthetic Owner',
    status:'VERIFIED',release_decision:'UNDECIDED',
    acceptance_criteria:['It works'],negative_cases:['Wrong principal denied'],open_risks:[],approvals:[],
    checks:[{name:'CI run',result:'pass',evidence:`https://github.com/${REPO}/actions/runs/202`,sha:SHA,kind:'security',environment:'synthetic',covers:['Wrong principal denied'],observed_at:'2026-11-03T00:00:00Z'},
      {name:'Check run',result:'pass',evidence:`https://github.com/${REPO}/runs/101`,sha:SHA,kind:'unit',environment:'synthetic',covers:['It works'],observed_at:'2026-11-03T00:00:00Z'}]
  };
}

test('read-only PR inspection pins head SHA, rechecks it and never declares release approval',async()=>{
  const calls=[];
  const snapshot=await inspect({fetchImpl:simulatedFetch(fixture(),{calls})});
  assert.equal(calls.length,5);
  assert.equal(snapshot.head_sha,SHA);
  assert.equal(snapshot.check_runs.length,1);
  assert.equal(snapshot.commit_status.statuses[0].context,'sast');
  assert.equal(snapshot.summary.all_observed_checks_successful,true);
  assert.equal(snapshot.summary.collection_complete,true);
  assert.equal(snapshot.release_authorized,false);
  assert.equal(snapshot.tests_independently_reproduced,false);
  assert.equal(snapshot.production_verified,false);
  assert(calls.every(c=>!c.opts.headers.Authorization));
});

test('pending workflows and skipped checks are not treated as passing CI',async()=>{
  const f=fixture();f.check_runs.check_runs[0].conclusion='skipped';
  f.workflow_runs.workflow_runs[0].status='queued';f.workflow_runs.workflow_runs[0].conclusion=null;
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  assert.equal(s.summary.all_observed_checks_successful,false);
  assert.equal(s.summary.check_runs.other,1);
  assert.equal(s.summary.workflow_runs.pending,1);
});

test('zero checks never becomes an all-green observation',async()=>{
  const f=fixture();f.check_runs={total_count:0,check_runs:[]};
  f.workflow_runs={total_count:0,workflow_runs:[]};
  f.commit_status={sha:SHA,state:'pending',total_count:0,statuses:[]};
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  assert.equal(s.summary.all_observed_checks_successful,false);
  assert.equal(s.summary.commit_status_count,0);
});

test('large result set or next-page link is explicitly incomplete, not passing',async()=>{
  const f=fixture();f.check_runs.total_count=101;
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  assert.equal(s.summary.collection_complete,false);
  assert.equal(s.summary.all_observed_checks_successful,false);
  const s2=await inspect({fetchImpl:simulatedFetch(fixture(),{links:{workflow_runs:'<https://api.github.com/next>; rel="next"'}})});
  assert.equal(s2.summary.collection_complete,false);
});

test('racing PR head changes fail closed before reporting pinned checks',async()=>{
  const f=fixture();f.pull_request_recheck=pr('b'.repeat(40));
  await assert.rejects(inspect({fetchImpl:simulatedFetch(f)}),/changed during observation/);
});

test('mismatched or invalid API identities fail closed',async()=>{
  const bad=fixture();bad.pull_request.base.repo.full_name='another/repo';
  await assert.rejects(inspect({fetchImpl:simulatedFetch(bad)}),/invalid identity/);
  const f=fixture();f.check_runs.check_runs[0].head_sha='f'.repeat(40);
  await assert.rejects(inspect({fetchImpl:simulatedFetch(f)}),/unrelated check/);
  const b=fixture();b.workflow_runs.workflow_runs[0].head_sha='f'.repeat(40);
  await assert.rejects(inspect({fetchImpl:simulatedFetch(b)}),/unrelated workflow/);
});

test('invalid or oversized API response is rejected without repeating sensitive content',async()=>{
  await assert.rejects(inspect({fetchImpl:async()=>new Response('not json')}),/invalid JSON/);
  await assert.rejects(inspect({fetchImpl:async()=>new Response('X'.repeat(2*1024*1024+1))}),/safe size/);
  await assert.rejects(inspect({fetchImpl:simulatedFetch(fixture(),{statuses:{workflow_runs:403}})}),/HTTP 403/);
});

test('restricts target paths and performs no requests for invalid repository or PR',async()=>{
  let n=0;const fetchImpl=async()=>{n++;throw Error('should not fetch')};
  for(const target of ['some/../repo','some/..','https://evil.test/repo','owner/repo/x','some/repo?foo=bar'])
    await assert.rejects(inspectGitHubPR({repository:target,prNumber:12,fetchImpl}),/Invalid owner\/repository/);
  await assert.rejects(inspectGitHubPR({repository:REPO,prNumber:'0',fetchImpl}),/Invalid PR number/);
  await assert.rejects(inspectGitHubPR({repository:REPO,prNumber:'1?ignored=1',fetchImpl}),/Invalid PR number/);
  assert.equal(n,0);
  assert.deepEqual(parseGitHubTarget('Some/Test-name','12'),{repository:'Some/Test-name',number:12});
});

test('token stays inside Authorization header and never leaks in exceptions or snapshot',async()=>{
  const token='ghp_test_key_123456789abcdef';
  const calls=[];
  const snapshot=await inspect({token,fetchImpl:simulatedFetch(fixture(),{calls})});
  assert(calls.every(c=>c.opts.headers.Authorization===`Bearer ${token}`));
  assert(!JSON.stringify(snapshot).includes(token));
  await assert.rejects(inspect({token,fetchImpl:async()=>{throw Error(`token ${token}`)}}),e=>!e.message.includes(token));
});

test('corroborates only canonical exact-head GitHub check and workflow links',async()=>{
  const s=await inspect();const receipt=matchingReceipt();
  const result=compareGitHubReceipt(s,receipt);
  assert.equal(result.valid,true);
  assert.equal(result.matched.length,2);
  assert.equal(result.acceptance_behavior_verified,false);
  assert.equal(result.release_authorized,false);
});

test('receipt misattribution, stale source and fabricated run URLs block corroboration',async()=>{
  const s=await inspect();
  for(const mutate of [r=>r.head_sha='f'.repeat(40),r=>r.repository='other/repo',
    r=>r.change_id='PR-99',r=>r.checks[0].evidence='https://evil.test/pretend',
    r=>r.checks[0].evidence=`https://github.com/${REPO}/actions/runs/9999`,
    r=>r.checks[0].sha='f'.repeat(40)]) {
    const r=matchingReceipt();mutate(r);
    assert.equal(compareGitHubReceipt(s,r).valid,false);
  }
});

test('pending remote runs and false passing claims cannot be corroborated',async()=>{
  const f=fixture();f.workflow_runs.workflow_runs[0].status='queued';f.workflow_runs.workflow_runs[0].conclusion=null;
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  const r=matchingReceipt();
  assert.equal(compareGitHubReceipt(s,r).valid,false);
});

test('malformed receipt cannot receive GitHub provenance',async()=>{
  const s=await inspect();const r=matchingReceipt();delete r.head_sha;
  assert.equal(compareGitHubReceipt(s,r).valid,false);
});
test('malformed workflow state and poisoned conclusion cannot become successful observation',async()=>{
  const invalid=fixture();invalid.workflow_runs.workflow_runs[0].status='completed but not really';
  await assert.rejects(inspect({fetchImpl:simulatedFetch(invalid)}),/invalid or unrelated workflow/);
  const poisoned=fixture();poisoned.check_runs.check_runs[0].conclusion='success\0';
  await assert.rejects(inspect({fetchImpl:simulatedFetch(poisoned)}),/invalid or unrelated check/);
});

test('a terminal GitHub failure can corroborate an explicitly failing check, but never a passed one',async()=>{
  const f=fixture();f.workflow_runs.workflow_runs[0].conclusion='failure';
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  const r=matchingReceipt();r.checks[0].result='fail';
  const comparison=compareGitHubReceipt(s,r);
  assert.equal(comparison.valid,true);
  assert.equal(comparison.release_authorized,false);
  assert.equal(s.summary.all_observed_checks_successful,false);
  r.checks[0].result='blocked';
  assert.equal(compareGitHubReceipt(s,r).valid,false);
});
