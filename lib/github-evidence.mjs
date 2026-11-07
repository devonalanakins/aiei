/**
 * AIEI v0.3.1: bounded, read-only GitHub PR evidence inspection.
 * Observes GitHub API metadata only. Never authenticates human approvals,
 * verifies test semantics, authorizes a release, or accesses runtime providers.
 */
import {validateReceipt} from './validate.mjs';

const API = 'https://api.github.com';
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const NAME = /^[a-z0-9_.-]{1,100}$/i;
const SHA = /^[a-f0-9]{40}$/i;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const API_VERSION = '2026-03-10';
const RUN_STATES = new Set(['queued','in_progress','completed','waiting','pending','requested','action_required']);
const safeString = (value,max=200) => typeof value==='string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,max) : '';
const isObject = value => value!==null && typeof value==='object' && !Array.isArray(value);
// Evidence names are identities: never strip or truncate a malformed name and
// still present a passing GitHub observation or caller-supplied receipt.
const validEvidenceName = value => typeof value==='string' && value.length<=200 &&
  value.trim().length>0 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const normalizedSha = value => typeof value==='string'&&SHA.test(value) ? value.toLowerCase() : null;
const equalRepo = (a,b) => typeof a==='string' && a.toLowerCase()===b.toLowerCase();

export function parseGitHubTarget(repository, prNumber) {
  if(typeof repository!=='string' || repository.length>140) throw Error('Invalid owner/repository');
  const parts=repository.split('/');
  if(parts.length!==2 || !OWNER.test(parts[0]) || !NAME.test(parts[1]) || ['.','..'].includes(parts[1]))
    throw Error('Invalid owner/repository');
  const n=String(prNumber);
  if(!/^[1-9][0-9]{0,6}$/.test(n) || Number(n)>9999999)throw Error('Invalid PR number');
  return {repository:parts.join('/'), number:Number(n)};
}

async function readBoundedJson(response, label) {
  if(!response || typeof response.status!=='number') throw Error(`GitHub ${label}: invalid API response`);
  if(!response.ok)throw Error(`GitHub ${label}: HTTP ${response.status}; no evidence was collected`);
  if(Number(response.headers?.get?.('content-length'))>MAX_RESPONSE_BYTES)
    throw Error(`GitHub ${label}: response exceeds safe size`);
  if(!response.body || typeof response.body.getReader!=='function')throw Error(`GitHub ${label}: missing response body`);
  const reader=response.body.getReader();
  let size=0;const chunks=[];
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw Error(`GitHub ${label}: response exceeds safe size`);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let off=0;
  for(const chunk of chunks){bytes.set(chunk,off);off+=chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw Error(`GitHub ${label}: invalid JSON response`);}
}

function makeReader(fetchImpl, token) {
  if(typeof fetchImpl!=='function')throw Error('A fetch implementation is required');
  if(token!==null && (typeof token!=='string'||!/^[!-~]{1,4096}$/.test(token)))throw Error('Invalid GitHub token format');
  const headers={
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':API_VERSION,
    'User-Agent':'aiei-readonly-evidence-inspector/0.3'
  };
  if(token)headers.Authorization=`Bearer ${token}`;
  return async (route, label) => {
    if(!/^\/repos\/[a-z0-9_.\/-]+(?:\?[a-z0-9_=&%-]+)?$/i.test(route))
      throw Error('Unsafe GitHub route');
    let response;
    try {
      response=await fetchImpl(`${API}${route}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(12000)});
    } catch {throw Error(`GitHub ${label}: request failed; no evidence was collected`);}
    const data=await readBoundedJson(response,label);
    return {data,more:/rel="next"/.test(response.headers?.get?.('link')??'')};
  };
}

function prRecord(data, expectedRepo, number) {
  if(!isObject(data) || data.number!==number || !equalRepo(data.base?.repo?.full_name,expectedRepo) ||
     !normalizedSha(data.head?.sha) || !normalizedSha(data.base?.sha) ||
     !['open','closed'].includes(data.state) || typeof data.draft!=='boolean')
    throw Error('GitHub pull request: invalid identity or revision metadata');
  return {
    repository:expectedRepo,
    number,
    head_sha:data.head.sha.toLowerCase(),
    base_sha:data.base.sha.toLowerCase(),
    head_repository:safeString(data.head.repo?.full_name,140)||null,
    state:data.state,
    draft:data.draft,
    merged:data.merged_at!==null && data.merged_at!==undefined
  };
}

function boundedCollection(data,arrayName,label) {
  if(!isObject(data)||!Array.isArray(data[arrayName])||data[arrayName].length>100 ||
    !Number.isSafeInteger(data.total_count)||data.total_count<0 || data.total_count<data[arrayName].length)
    throw Error(`GitHub ${label}: invalid result collection`);
  return {items:data[arrayName],total_count:data.total_count};
}

/**
 * Iterate only our own fixed GitHub routes, never Link-provided URLs. A missing,
 * contradictory or truncated page remains explicitly incomplete (never green).
 * The 1,000 item ceiling also covers GitHub's capped search/check endpoints.
 */
async function collectPages(read, route, label, arrayName, validatePage = () => {}) {
  const items=[];
  let total=null, pages=0, initialMetadata=null;
  for(let page=1;page<=MAX_PAGES;page++) {
    const {data,more}=await read(`${route}${route.includes('?')?'&':'?'}per_page=${PAGE_SIZE}&page=${page}`,`${label}_page_${page}`);
    const chunk=boundedCollection(data,arrayName,label);
    validatePage(data,initialMetadata);
    if(page===1) {total=chunk.total_count;initialMetadata=data;}
    else if(total!==chunk.total_count)throw Error(`GitHub ${label}: result count changed during pagination; retry`);
    if(items.length+chunk.items.length>total)throw Error(`GitHub ${label}: pages exceed reported total`);
    if(chunk.items.length===0 && items.length<total)
      return {items,total_count:total,pages:page,state:initialMetadata?.state,complete:false};
    // Requesting page N+1 when page N was short would skip unseen records.
    if(chunk.items.length<PAGE_SIZE && items.length+chunk.items.length<total)
      return {items:[...items,...chunk.items],total_count:total,pages:page,state:initialMetadata?.state,complete:false};
    items.push(...chunk.items);
    pages=page;
    if(items.length===total)
      return {items,total_count:total,pages,state:initialMetadata?.state,complete:!more};
  }
  return {items,total_count:total,pages,state:initialMetadata?.state,complete:false};
}

const summaryOf = rows => ({
  observed:rows.length,
  successful:rows.filter(x=>x.status==='completed'&&x.conclusion==='success').length,
  pending:rows.filter(x=>x.status!=='completed').length,
  other:rows.filter(x=>x.status==='completed'&&x.conclusion!=='success').length
});

/**
 * Fetch bounded, pinned, read-only GitHub REST resources. No state mutation.
 * An API observation is not an assertion that CI covered required behavior.
 */
export async function inspectGitHubPR({repository,prNumber,token=null,fetchImpl=fetch}={}) {
  const target=parseGitHubTarget(repository,prNumber);
  const ownerRepo=target.repository.split('/').map(encodeURIComponent).join('/');
  const root=`/repos/${ownerRepo}`;
  const read=makeReader(fetchImpl,token);
  const {data:first}=await read(`${root}/pulls/${target.number}`,'pull_request');
  const pr=prRecord(first,target.repository,target.number);
  const sha=pr.head_sha;
  const [checks,statusCollection,runs]=await Promise.all([
    collectPages(read,`${root}/commits/${sha}/check-runs`,'check_runs','check_runs'),
    collectPages(read,`${root}/commits/${sha}/status`,'commit_status','statuses',(data,initial)=>{
      if(!['success','failure','pending','error'].includes(data.state) ||
        (data.sha && normalizedSha(data.sha)!==sha) ||
        (initial && data.state!==initial.state))
        throw Error('GitHub commit_status: inconsistent identity or combined status during pagination');
    }),
    collectPages(read,`${root}/actions/runs?head_sha=${sha}`,'workflow_runs','workflow_runs')
  ]);
  const collectionIncomplete=!checks.complete||!runs.complete||!statusCollection.complete;
  const checkRuns=checks.items.map(item=>{
    if(!isObject(item)||!Number.isSafeInteger(item.id)||item.id<1 || normalizedSha(item.head_sha)!==sha ||
       !RUN_STATES.has(item.status) || !validEvidenceName(item.name) ||
       (item.conclusion!==null && item.conclusion!==undefined && (typeof item.conclusion!=='string' || /[\x00-\x1f\x7f]/.test(item.conclusion))))
      throw Error('GitHub check_runs: invalid or unrelated check');
    return {id:item.id,name:safeString(item.name),status:item.status,conclusion:safeString(item.conclusion,50)||null,
      sha,app:safeString(item.app?.slug,90)||null};
  });
  const workflows=runs.items.map(item=>{
    if(!isObject(item)||!Number.isSafeInteger(item.id)||item.id<1||normalizedSha(item.head_sha)!==sha||
      !RUN_STATES.has(item.status) || !validEvidenceName(item.name) ||
      (item.conclusion!==null && item.conclusion!==undefined && (typeof item.conclusion!=='string'||/[\x00-\x1f\x7f]/.test(item.conclusion))))
      throw Error('GitHub workflow_runs: invalid or unrelated workflow');
    return {id:item.id,name:safeString(item.name),status:safeString(item.status,40),
      conclusion:safeString(item.conclusion,50)||null,sha,event:safeString(item.event,50)};
  });
  const statuses=statusCollection.items.map(item=>{
    if(!isObject(item)||!validEvidenceName(item.context)||!['success','failure','pending','error'].includes(item.state))
      throw Error('GitHub commit_status: invalid status context');
    return {context:safeString(item.context),state:item.state};
  });
  if(new Set(checkRuns.map(x=>x.id)).size!==checkRuns.length ||
     new Set(workflows.map(x=>x.id)).size!==workflows.length)
    throw Error('GitHub result collection: duplicate run ID across pages');
  const {data:second}=await read(`${root}/pulls/${target.number}`,'pull_request_recheck');
  const finalPR=prRecord(second,target.repository,target.number);
  if(pr.head_sha!==finalPR.head_sha||pr.base_sha!==finalPR.base_sha||pr.state!==finalPR.state||
     pr.draft!==finalPR.draft||pr.merged!==finalPR.merged)
    throw Error('GitHub PR changed during observation; rerun against the new head');
  const checksSummary=summaryOf(checkRuns), workflowsSummary=summaryOf(workflows);
  const anyChecks=checkRuns.length+workflows.length+statuses.length>0;
  const allSuccess=anyChecks&&!collectionIncomplete&&checksSummary.pending===0&&checksSummary.other===0&&
    workflowsSummary.pending===0&&workflowsSummary.other===0&&
    statuses.every(s=>s.state==='success') &&
    (statusCollection.total_count>0?statusCollection.state==='success':true);
  return {
    schema_version:1,
    source:'github_rest_read_only',
    api_origin:API,
    github_metadata_observed:true,
    tests_independently_reproduced:false,
    human_approvals_verified:false,
    production_verified:false,
    release_authorized:false,
    observed_at:new Date().toISOString(),
    ...pr,
    check_runs:checkRuns,
    workflow_runs:workflows,
    commit_status:{combined_state:statusCollection.state,statuses},
    summary:{check_runs:checksSummary,workflow_runs:workflowsSummary,commit_status_count:statuses.length,
      pages_fetched:{check_runs:checks.pages,workflow_runs:runs.pages,commit_status:statusCollection.pages},
      limits:{per_page:PAGE_SIZE,max_pages:MAX_PAGES,max_items_per_collection:PAGE_SIZE*MAX_PAGES},
      collection_complete:!collectionIncomplete,all_observed_checks_successful:allSuccess},
    limitations:[
      'GitHub API data was observed, not test assertions independently reproduced.',
      'Observed checks may omit repository-required branch protection, code review, or upstream stacked PR gates.',
      'No deployment version, target environment, user journey, reviewer identity or production state was validated.'
    ]
  };
}

/**
 * A complete observation is necessary but not sufficient for policy approval.
 * Recompute observed results instead of trusting a mutable snapshot summary.
 * This conservative comparator treats every exact-head observed failure or
 * pending run as a blocker until a separately trusted required-check policy
 * can distinguish relevant evidence from optional/historical observations.
 * This does not authenticate a caller-provided snapshot or prove test semantics.
 */
function observedSnapshotClean(snapshot) {
  if(!Array.isArray(snapshot?.check_runs) ||
     !Array.isArray(snapshot?.workflow_runs) ||
     !Array.isArray(snapshot?.commit_status?.statuses) ||
     snapshot.source!=='github_rest_read_only' ||
     snapshot.github_metadata_observed!==true ||
     !normalizedSha(snapshot.head_sha) ||
     snapshot.summary?.collection_complete!==true ||
     snapshot.summary?.all_observed_checks_successful!==true)
    return false;
  const checks=snapshot.check_runs,workflows=snapshot.workflow_runs;
  const runs=[...checks,...workflows],statuses=snapshot.commit_status.statuses;
  if(runs.length===0 && statuses.length===0)return false;
  if(!runs.every(run=>validEvidenceName(run?.name)) ||
     !statuses.every(status=>validEvidenceName(status?.context)))return false;
  // The caller can alter a snapshot after inspection. Recompute the counts and
  // reject duplicate identities rather than accepting a forged green summary.
  const countsAgree=(rows,reported)=>{
    if(!isObject(reported))return false;
    const actual=summaryOf(rows);
    return Object.entries(actual).every(([key,value])=>reported[key]===value);
  };
  const uniqueRuns=rows=>rows.every(run=>Number.isSafeInteger(run?.id)&&run.id>0) &&
    new Set(rows.map(run=>run.id)).size===rows.length;
  if(!countsAgree(checks,snapshot.summary.check_runs) ||
     !countsAgree(workflows,snapshot.summary.workflow_runs) ||
     snapshot.summary.commit_status_count!==statuses.length ||
     !uniqueRuns(checks) || !uniqueRuns(workflows))return false;
  if(runs.some(run=>run?.status!=='completed' ||
     run.conclusion!=='success' || run.sha!==snapshot.head_sha))return false;
  if(statuses.some(status=>status?.state!=='success'))return false;
  if(statuses.length>0 && snapshot.commit_status.combined_state!=='success')return false;
  return true;
}

/** Cross-check the *identity and linked CI records* of a receipt. Cannot validate
 * arbitrary screenshots, external test claims, or acceptance-case coverage. */
export function compareGitHubReceipt(snapshot,receipt){
  const validation=validateReceipt(receipt);
  if(!validation.valid)return {valid:false,blockers:validation.errors,matched:[],unmatched:[],release_authorized:false};
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
     !Array.isArray(snapshot.check_runs) || !Array.isArray(snapshot.workflow_runs) ||
     !Array.isArray(snapshot.commit_status?.statuses))
    return {valid:false,blockers:['Missing or malformed GitHub observation snapshot'],matched:[],unmatched:[],release_authorized:false};
  const blockers=[];
  const matched=[],unmatched=[];
  const consumedRunLinks=new Set();
  if(!observedSnapshotClean(snapshot))blockers.push('GitHub observation is not a complete all-successful exact-head snapshot');
  if(!equalRepo(snapshot.repository,receipt.repository))blockers.push('Receipt repository differs from GitHub PR');
  if(snapshot.head_sha!==receipt.head_sha.toLowerCase())blockers.push('Receipt SHA is not current PR head');
  if(![String(snapshot.number),`#${snapshot.number}`,`PR-${snapshot.number}`].includes(receipt.change_id))
    blockers.push('Receipt change_id does not identify this PR');
  if(snapshot.source!=='github_rest_read_only'||snapshot.github_metadata_observed!==true)blockers.push('No GitHub API observation attached');
  if(snapshot.summary?.collection_complete!==true)blockers.push('GitHub check collections were incomplete');
  const apiChecks=new Map();
  for(const run of snapshot.check_runs??[])apiChecks.set(`https://github.com/${snapshot.repository}/runs/${run.id}`,run);
  for(const run of snapshot.workflow_runs??[])apiChecks.set(`https://github.com/${snapshot.repository}/actions/runs/${run.id}`,run);
  for(const check of receipt.checks){
    // Cross-source evidence only: no approval is inferred from synthetic or local assertions.
    const remote=apiChecks.get(check.evidence);
    if(!remote){unmatched.push({name:check.name,reason:'No canonical exact-head GitHub run link matched'});continue;}
    if(consumedRunLinks.has(check.evidence)){
      blockers.push(`Receipt check ${check.name} reuses a GitHub run linked to another check`);
      unmatched.push({name:check.name,reason:'Duplicate GitHub run evidence link'});
      continue;
    }
    consumedRunLinks.add(check.evidence);
    if(check.name!==remote.name){
      blockers.push(`Receipt check ${check.name} does not match the observed GitHub run name`);
      unmatched.push({name:check.name,reason:'GitHub run identity or name mismatch'});
      continue;
    }
    const succeeded=remote.status==='completed'&&remote.conclusion==='success';
    const failed=remote.status==='completed'&&['failure','timed_out'].includes(remote.conclusion);
    const agrees=(check.result==='pass'&&succeeded)||(check.result==='fail'&&failed);
    if(!agrees || !check.sha || check.sha.toLowerCase()!==snapshot.head_sha) {
      blockers.push(`Receipt check ${check.name} contradicts the observed GitHub run or commit`);
      unmatched.push({name:check.name,reason:'Result or SHA mismatch'});
    } else matched.push({name:check.name,source:check.evidence,remote_conclusion:remote.conclusion,sha:remote.sha});
  }
  if(unmatched.length)blockers.push('Some receipt evidence could not be corroborated against the GitHub PR');
  return {valid:blockers.length===0,blockers,matched,unmatched,
    github_run_metadata_corroborated:blockers.length===0&&matched.length>0,
    acceptance_behavior_verified:false,human_approvals_verified:false,release_authorized:false};
}
