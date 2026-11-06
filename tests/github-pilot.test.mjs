import test from 'node:test';
import assert from 'node:assert/strict';
import {advisoryPilotReport} from '../lib/github-pilot.mjs';

const HEAD='0123456789abcdef0123456789abcdef01234567';
function snapshot() {
  return {
    repository:'devonalanakins/merit',number:6,head_sha:HEAD,base_sha:'a'.repeat(40),
    source:'github_rest_read_only',github_metadata_observed:true,
    check_runs:[{id:1,sha:HEAD,status:'completed',conclusion:'success'}],
    workflow_runs:[{id:2,sha:HEAD,status:'completed',conclusion:'success'}],
    commit_status:{combined_state:'success',statuses:[{context:'ci',state:'success'}]},
    summary:{collection_complete:true,all_observed_checks_successful:true,
      check_runs:{observed:1},workflow_runs:{observed:1},commit_status_count:1},
  };
}
function noAuthority(report) {
  for(const key of ['policy_required_checks_verified','witness_provenance_authenticated',
    'tests_independently_reproduced','human_approvals_verified','production_verified','release_authorized'])
    assert.equal(report[key],false,key);
}
test('clean snapshot is advisory only, never release authorization',()=>{
  const report=advisoryPilotReport(snapshot());
  assert.equal(report.observation,'OBSERVED_SUCCESS_ONLY');
  assert.equal(report.collection_complete,true);
  assert.equal(report.pr_number,6);
  noAuthority(report);
});
test('forged passing summary does not hide failed observed run',()=>{
  const s=snapshot();s.workflow_runs[0].conclusion='failure';
  const report=advisoryPilotReport(s);
  assert.equal(report.observation,'OBSERVED_NOT_ALL_SUCCESSFUL');noAuthority(report);
});
test('queued, skipped, pending and wrong-head runs never count as all passed',()=>{
  for(const change of [
    s=>{s.workflow_runs[0].status='queued';s.workflow_runs[0].conclusion=null;},
    s=>{s.check_runs[0].conclusion='skipped';},
    s=>{s.commit_status.statuses[0].state='pending';},
    s=>{s.check_runs[0].sha='f'.repeat(40);},
  ]){
    const s=snapshot();change(s);
    assert.equal(advisoryPilotReport(s).observation,'OBSERVED_NOT_ALL_SUCCESSFUL');
  }
});
test('truncated API evidence and contradictory counts remain incomplete',()=>{
  for(const change of [
    s=>{s.summary.collection_complete=false;},
    s=>{s.summary.check_runs.observed=3;},
    s=>{s.summary.workflow_runs.observed=0;},
    s=>{s.summary.commit_status_count=2;},
    s=>{s.github_metadata_observed=false;},
    s=>{s.head_sha='not-a-sha';},
  ]){
    const s=snapshot();change(s);
    const report=advisoryPilotReport(s);
    assert.equal(report.observation,'INCOMPLETE');noAuthority(report);
  }
});
test('missing or malformed snapshots fail closed',()=>{
  for(const s of [null,{}, {check_runs:[],workflow_runs:[],commit_status:{statuses:[]}}, {...snapshot(),check_runs:null}]){
    const r=advisoryPilotReport(s);
    assert.equal(r.observation,'INCOMPLETE');noAuthority(r);
  }
});
test('zero observed evidence cannot become success despite a passing summary',()=>{
  const s=snapshot();
  s.check_runs=[];s.workflow_runs=[];s.commit_status.statuses=[];
  s.summary.check_runs.observed=0;s.summary.workflow_runs.observed=0;
  s.summary.commit_status_count=0;
  assert.equal(advisoryPilotReport(s).observation,'NO_EVIDENCE');
});
