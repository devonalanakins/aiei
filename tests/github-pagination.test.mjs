import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGitHubPR,compareGitHubReceipt} from '../lib/index.mjs';

const SHA='1234567890abcdef1234567890abcdef12345678';
const BASE='a'.repeat(40);
const REPO='sample/aiei-pagination';
const makePR=()=>({number:42,state:'open',draft:true,merged_at:null,
  head:{sha:SHA,repo:{full_name:REPO}},base:{sha:BASE,repo:{full_name:REPO}}});
const makeCheck=id=>({id,name:`check-${id}`,head_sha:SHA,status:'completed',conclusion:'success',app:{slug:'github-actions'}});
const makeWorkflow=id=>({id,name:`workflow-${id}`,head_sha:SHA,status:'completed',conclusion:'success',event:'pull_request'});
const makeStatus=id=>({id,context:`status-${id}`,state:'success'});
const fixtures=(count=101)=>({
  check_runs:Array.from({length:count},(_,i)=>makeCheck(1000+i)),
  workflow_runs:Array.from({length:count},(_,i)=>makeWorkflow(2000+i)),
  statuses:Array.from({length:count},(_,i)=>makeStatus(3000+i))
});
function buildPagedFetch(data, {calls=[],override=()=>null,linkOrigin='https://attacker.invalid'}={}){
  let pulls=0;
  return async (raw,opts)=>{
    const url=new URL(raw);
    calls.push(url);
    assert.equal(url.origin,'https://api.github.com');
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    const kind=url.pathname.includes('/check-runs')?'check_runs':
      url.pathname.includes('/actions/runs')?'workflow_runs':
      url.pathname.includes('/status')?'statuses':'pr';
    let body,headers={};
    if(kind==='pr'){
      body=makePR();
      if(pulls++>0 && data.racingPR)body.head.sha='f'.repeat(40);
    }else{
      const page=Number(url.searchParams.get('page'));
      assert(Number.isInteger(page)&&page>=1&&page<=10);
      assert.equal(url.searchParams.get('per_page'),'100');
      const rows=data[kind];
      const total=rows.length;
      const chunk=rows.slice((page-1)*100,page*100);
      const key=kind==='statuses'?'statuses':kind;
      body=kind==='statuses'?{sha:SHA,state:rows.every(s=>s.state==='success')?'success':'failure',total_count:total,statuses:chunk}:
        {total_count:total,[key]:chunk};
      if(page*100<total){
        // The inspector must NEVER fetch this user-controlled Link destination.
        headers.Link=`<${linkOrigin}/steal?token=malicious&page=${page+1}>; rel="next"`;
      }
      const change=override(kind,page,body);
      if(change)body=change;
    }
    return new Response(JSON.stringify(body),{status:200,headers});
  };
}
const inspect=(data,opts={})=>inspectGitHubPR({repository:REPO,prNumber:42,fetchImpl:buildPagedFetch(data,opts)});

test('paginates all three collections and follows only internally constructed GitHub URLs',async()=>{
  const calls=[];
  const report=await inspect(fixtures(),{calls});
  assert.equal(report.summary.collection_complete,true);
  assert.equal(report.summary.all_observed_checks_successful,true);
  assert.deepEqual(report.summary.pages_fetched,{check_runs:2,workflow_runs:2,commit_status:2});
  assert.equal(report.summary.check_runs.observed,101);
  assert.equal(report.summary.workflow_runs.observed,101);
  assert.equal(report.summary.commit_status_count,101);
  assert.equal(calls.length,8);
  assert(calls.every(url=>url.origin==='https://api.github.com'));
  assert.equal(report.release_authorized,false);
});

test('failure hidden on second page cannot yield passing evidence',async()=>{
  const data=fixtures();
  data.check_runs[100].conclusion='failure';
  data.workflow_runs[100].status='queued';
  data.workflow_runs[100].conclusion=null;
  data.statuses[100].state='failure';
  const result=await inspect(data);
  assert.equal(result.summary.collection_complete,true);
  assert.equal(result.summary.all_observed_checks_successful,false);
  assert.equal(result.summary.check_runs.other,1);
  assert.equal(result.summary.workflow_runs.pending,1);
  assert.equal(result.commit_status.combined_state,'failure');
});

test('1,001 checks exceed explicit maximum and always report incomplete rather than green',async()=>{
  const data=fixtures(1);
  data.check_runs=Array.from({length:1001},(_,i)=>makeCheck(i+1));
  const result=await inspect(data);
  assert.equal(result.summary.check_runs.observed,1000);
  assert.equal(result.summary.pages_fetched.check_runs,10);
  assert.equal(result.summary.collection_complete,false);
  assert.equal(result.summary.all_observed_checks_successful,false);
  assert.equal(result.summary.limits.max_items_per_collection,1000);
});

test('changes in total counts or combined status across pages fail closed',async()=>{
  const data=fixtures();
  await assert.rejects(inspect(data,{override:(kind,page,body)=>{
    if(kind==='workflow_runs'&&page===2)return {...body,total_count:102};
    return null;
  }}),/changed during pagination/);
  await assert.rejects(inspect(data,{override:(kind,page,body)=>{
    if(kind==='statuses'&&page===2)return {...body,state:'pending'};
    return null;
  }}),/inconsistent identity or combined status/);
});

test('duplicated run IDs across pages fail closed and cannot hide an omitted failed check',async()=>{
  const data=fixtures();data.check_runs[100].id=data.check_runs[0].id;
  await assert.rejects(inspect(data),/duplicate run ID/);
});

test('short first page and missing second page are not silently considered complete',async()=>{
  const data=fixtures();
  const short=await inspect(data,{override:(kind,page,body)=>{
    if(kind==='check_runs'&&page===1)return {...body,check_runs:body.check_runs.slice(0,99)};
    return null;
  }});
  assert.equal(short.summary.collection_complete,false);
  assert.equal(short.summary.check_runs.observed,99);
  const empty=await inspect(data,{override:(kind,page,body)=>{
    if(kind==='check_runs'&&page===2)return {...body,check_runs:[]};
    return null;
  }});
  assert.equal(empty.summary.collection_complete,false);
  assert.equal(empty.summary.check_runs.observed,100);
});

test('changed PR head after multi-page collection still invalidates the observation',async()=>{
  const data=fixtures();data.racingPR=true;
  await assert.rejects(inspect(data),/changed during observation/);
});

test('corroboration refuses incomplete collections even when a matching run exists',async()=>{
  const data=fixtures();data.check_runs=Array.from({length:1001},(_,i)=>makeCheck(i+1));
  const s=await inspect(data);
  const receipt={schema_version:1,repository:REPO,change_id:'PR-42',head_sha:SHA,risk_tier:'R1',owner:'Synthetic',
    status:'VERIFIED',release_decision:'UNDECIDED',acceptance_criteria:['sample'],negative_cases:[],open_risks:[],approvals:[],
    checks:[{name:'one run',result:'pass',evidence:`https://github.com/${REPO}/runs/1`,sha:SHA}]};
  assert.equal(compareGitHubReceipt(s,receipt).valid,false);
});
