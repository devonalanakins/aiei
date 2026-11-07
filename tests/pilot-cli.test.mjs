import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Exercises the actual CLI process via a synthetic, GET-only GitHub REST stub.
// Never contacts the network or needs secrets; the live public pilot runs separately.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const HEAD='57a7a593c72bd1ea2c0e806b387bfacc9f4b749f';
const BASE='72c78f4fec74423d48df2f4f766cd11da895d446';
const REPO='devonalanakins/merit';
const pr={number:6,state:'open',draft:true,merged_at:null,
  head:{sha:HEAD,repo:{full_name:REPO}},
  base:{sha:BASE,repo:{full_name:REPO}}};

function runPilot(outcome) {
  const directory=mkdtempSync(join(tmpdir(),'merit-pilot-cli-'));
  const loader=join(directory,'preload.mjs');
  const pending=outcome==='queued';
  const failure=outcome==='failure';
  const payload={
    pull:pr,
    check_runs:{total_count:1,check_runs:[{
      id:101,name:'core',head_sha:HEAD,status:'completed',
      conclusion:'success',app:{slug:'github-actions'},
    }]},
    commit_status:{sha:HEAD,state:'success',total_count:1,
      statuses:[{context:'ci',state:'success'}]},
    workflow_runs:{total_count:1,workflow_runs:[{
      id:202,name:'semantic-evidence',head_sha:HEAD,
      status:pending?'queued':'completed',
      conclusion:pending?null:failure?'failure':'success',
      event:'pull_request',
    }]},
  };
  const source=[
    'const payload='+JSON.stringify(payload)+';',
    'globalThis.fetch=async (url,opts)=>{',
    "  if(opts?.method!=='GET'||opts.headers?.Authorization) throw Error('unexpected HTTP request');",
    "  const route=new URL(url);",
    "  if(route.origin!=='https://api.github.com') throw Error('unexpected origin');",
    "  const path=route.pathname;",
    "  let value;",
    "  if(path.endsWith('/pulls/6'))value=payload.pull;",
    "  else if(path.endsWith('/check-runs'))value=payload.check_runs;",
    "  else if(path.endsWith('/status'))value=payload.commit_status;",
    "  else if(path.endsWith('/actions/runs'))value=payload.workflow_runs;",
    "  else throw Error('unexpected route');",
    "  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});",
    '};',
  ].join('\n');
  try {
    writeFileSync(loader,source);
    return spawnSync(process.execPath,
      ['--import',loader,'bin/merit-pilot.mjs',REPO,'6'],{
        cwd:ROOT,encoding:'utf8',timeout:10000,
        env:{PATH:process.env.PATH??''},
      });
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
}

test('public read-only CLI exit status distinguishes passing, failed and queued observations',()=>{
  for(const [scenario,expectedCode,expectedObservation] of [
    ['success',0,'OBSERVED_SUCCESS_ONLY'],
    ['failure',1,'OBSERVED_NOT_ALL_SUCCESSFUL'],
    ['queued',1,'OBSERVED_NOT_ALL_SUCCESSFUL'],
  ]) {
    const result=runPilot(scenario);
    assert.equal(result.error,undefined,'CLI process should execute');
    assert.equal(result.signal,null,'CLI must not time out');
    assert.doesNotMatch(result.stdout,/Bearer |gh[pousr]_/);
    assert.equal(result.status,expectedCode,
      'CLI must return a nonzero status for '+scenario+' observed GitHub checks');
    const report=JSON.parse(result.stdout);
    assert.equal(report.observation,expectedObservation);
    assert.equal(report.release_authorized,false);
    assert.equal(report.policy_required_checks_verified,false);
  }
});
