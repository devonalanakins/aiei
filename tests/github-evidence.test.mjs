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
    checks:[{name:'verify',result:'pass',evidence:`https://github.com/${REPO}/actions/runs/202`,sha:SHA,kind:'security',environment:'synthetic',covers:['Wrong principal denied'],observed_at:'2026-11-03T00:00:00Z'},
      {name:'unit and security',result:'pass',evidence:`https://github.com/${REPO}/runs/101`,sha:SHA,kind:'unit',environment:'synthetic',covers:['It works'],observed_at:'2026-11-03T00:00:00Z'}]
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
  assert.equal(comparison.valid,false);
  assert.equal(comparison.matched.length,2); // Failure evidence remains correlated, but does not make the PR snapshot successful.
  assert.equal(comparison.release_authorized,false);
  assert.equal(s.summary.all_observed_checks_successful,false);
  r.checks[0].result='blocked';
  assert.equal(compareGitHubReceipt(s,r).valid,false);
});


test('a passing lint workflow cannot be relabeled as a security proof',async()=>{
  const s=await inspect();
  const receipt=matchingReceipt();
  receipt.checks[0].name='security penetration test';
  const result=compareGitHubReceipt(s,receipt);
  assert.equal(result.valid,false);
  assert.equal(result.release_authorized,false);
  assert(result.blockers.some(x=>/name|identity/i.test(x)));
});

test('a passing GitHub run cannot corroborate two different receipt checks',async()=>{
  const s=await inspect();
  const receipt=matchingReceipt();
  receipt.checks.push({...receipt.checks[0], covers:['Second unrelated claim']});
  const result=compareGitHubReceipt(s,receipt);
  assert.equal(result.valid,false);
  assert.equal(result.release_authorized,false);
  assert(result.blockers.some(x=>/duplicate|reuse/i.test(x)));
});

test('check-run names must match canonical observed identity exactly',async()=>{
  const s=await inspect();
  const receipt=matchingReceipt();
  receipt.checks[1].name='Unit and Security';
  assert.equal(compareGitHubReceipt(s,receipt).valid,false);
});

test('unrelated failed check cannot be hidden behind corroborated passing receipt checks',async()=>{
  const f=fixture();
  f.check_runs.total_count=2;
  f.check_runs.check_runs.push({id:102,name:'required security scan',head_sha:SHA,status:'completed',conclusion:'failure',app:{slug:'github-actions'}});
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  const result=compareGitHubReceipt(s,matchingReceipt());
  assert.equal(result.matched.length,2);
  assert.equal(s.summary.all_observed_checks_successful,false);
  assert.equal(result.valid,false);
  assert(result.blockers.some(reason=>/snapshot|observed|successful|fail/i.test(reason)));
});

test('unrelated pending workflow cannot be hidden behind passing receipt checks',async()=>{
  const f=fixture();
  f.workflow_runs.total_count=2;
  f.workflow_runs.workflow_runs.push({id:203,name:'deployment guard',head_sha:SHA,status:'queued',conclusion:null,event:'pull_request'});
  const s=await inspect({fetchImpl:simulatedFetch(f)});
  const result=compareGitHubReceipt(s,matchingReceipt());
  assert.equal(result.matched.length,2);
  assert.equal(s.summary.all_observed_checks_successful,false);
  assert.equal(result.valid,false);
});

test('skipped checks never substantiate an all-successful observation',async()=>{
  const f=fixture();
  f.check_runs.total_count=2;
  f.check_runs.check_runs.push({id:103,name:'security negative cases',head_sha:SHA,status:'completed',conclusion:'skipped',app:{slug:'github-actions'}});
  const result=compareGitHubReceipt(await inspect({fetchImpl:simulatedFetch(f)}),matchingReceipt());
  assert.equal(result.valid,false);
});

test('a forged green summary cannot hide a failed observed run',async()=>{
  const s=await inspect();
  s.check_runs[0].conclusion='failure';
  s.summary.all_observed_checks_successful=true;
  const result=compareGitHubReceipt(s,matchingReceipt());
  assert.equal(result.valid,false);
});

test('contradictory or missing snapshots cannot be interpreted as clean evidence',async()=>{
  const s=await inspect();
  s.summary.all_observed_checks_successful=false;
  assert.equal(compareGitHubReceipt(s,matchingReceipt()).valid,false);
  assert.equal(compareGitHubReceipt(null,matchingReceipt()).valid,false);
});

test('malformed or incomplete observation collections fail closed without throwing',async()=>{
  const s=await inspect();
  s.workflow_runs=null;
  assert.equal(compareGitHubReceipt(s,matchingReceipt()).valid,false);
  const t=await inspect();
  t.summary.collection_complete=false;
  assert.equal(compareGitHubReceipt(t,matchingReceipt()).valid,false);
});

test('recorded run SHA mismatch cannot be hidden by a clean summary',async()=>{
  const s=await inspect();
  s.workflow_runs[0].sha='f'.repeat(40);
  assert.equal(s.summary.all_observed_checks_successful,true);
  assert.equal(compareGitHubReceipt(s,matchingReceipt()).valid,false);
});

test('pending commit status cannot be laundered by passing check runs',async()=>{
  const s=await inspect();
  s.commit_status.statuses[0].state='pending';
  s.commit_status.combined_state='pending';
  assert.equal(compareGitHubReceipt(s,matchingReceipt()).valid,false);
});


test('receipt comparator rejects forged all-green aggregate counts',async()=>{
  const original=await inspect();
  assert.equal(compareGitHubReceipt(original,matchingReceipt()).valid,true);
  for(const mutate of [
    s=>{s.summary.check_runs.successful=0;s.summary.check_runs.other=1;},
    s=>{s.summary.check_runs.pending=1;},
    s=>{s.summary.workflow_runs.observed=0;},
    s=>{s.summary.workflow_runs.successful=2;},
    s=>{s.summary.commit_status_count=0;},
  ]){
    const s=structuredClone(original);mutate(s);
    const result=compareGitHubReceipt(s,matchingReceipt());
    assert.equal(result.valid,false,'inconsistent snapshot must not corroborate a receipt');
    assert.equal(result.release_authorized,false);
    assert(result.blockers.some(x=>/observation|snapshot/i.test(x)));
  }
});

test('receipt comparator rejects repeated and malformed check identities',async()=>{
  const original=await inspect();
  for(const mutate of [
    s=>{s.check_runs.push({...s.check_runs[0]});s.summary.check_runs.observed=2;s.summary.check_runs.successful=2;},
    s=>{s.workflow_runs.push({...s.workflow_runs[0]});s.summary.workflow_runs.observed=2;s.summary.workflow_runs.successful=2;},
    s=>{s.check_runs[0].id='101';},
    s=>{s.workflow_runs[0].id='202';},
  ]){
    const s=structuredClone(original);mutate(s);
    const result=compareGitHubReceipt(s,matchingReceipt());
    assert.equal(result.valid,false,'duplicate or nonnumeric run identity must not corroborate a receipt');
    assert.equal(result.release_authorized,false);
  }
});

test('consistent multiple successful checks preserve narrowly scoped corroboration',async()=>{
  const s=await inspect();
  s.check_runs.push({...s.check_runs[0],id:102,name:'optional check'});
  s.summary.check_runs.observed=2;
  s.summary.check_runs.successful=2;
  const result=compareGitHubReceipt(s,matchingReceipt());
  assert.equal(result.valid,true);
  assert.equal(result.matched.length,2);
  assert.equal(result.release_authorized,false);
  assert.equal(result.acceptance_behavior_verified,false);
});


test('comparator refuses a forged successful status lacking a meaningful context',async()=>{
  const original=await inspect();
  for(const invalidContext of ['', '   ', null, '\u0000']) {
    const s=structuredClone(original);
    s.commit_status.statuses[0].context=invalidContext;
    const comparison=compareGitHubReceipt(s,matchingReceipt());
    assert.equal(comparison.valid,false,'status context must identify a real status');
    assert.equal(comparison.release_authorized,false);
  }
});

test('unreferenced successful runs still require a meaningful observed name',async()=>{
  const original=await inspect();
  const s=structuredClone(original);
  s.check_runs.push({...s.check_runs[0],id:102,name:' '});
  s.summary.check_runs.observed=2;
  s.summary.check_runs.successful=2;
  const result=compareGitHubReceipt(s,matchingReceipt());
  assert.equal(result.valid,false,'an extra nameless check cannot count as a clean observation');
  assert.equal(result.release_authorized,false);
});

test('inspector rejects blank run names and status contexts received from the API',async()=>{
  for(const makeBad of [
    f=>{f.check_runs.check_runs[0].name=' ';},
    f=>{f.workflow_runs.workflow_runs[0].name='';},
    f=>{f.commit_status.statuses[0].context=' ';},
  ]) {
    const f=fixture();
    makeBad(f);
    await assert.rejects(
      inspect({fetchImpl:simulatedFetch(f)}),
      /invalid|unrelated|context|identity/i,
    );
  }
});
