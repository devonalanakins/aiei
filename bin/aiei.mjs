#!/usr/bin/env node
import {readFile, stat} from 'node:fs/promises';
import {validateContract,validateReceipt,assess,inspectGitHubPR,compareGitHubReceipt} from '../lib/index.mjs';

const MAX_BYTES=1_048_576;
function usage() {
  return 'AIEI 0.3.0 (offline contract checking + bounded read-only GitHub observation)\nUsage:\n  aiei validate contract <path> [--json]\n  aiei validate receipt <path> [--json]\n  aiei assess <contract.json> <receipt.json> [--json]\n  aiei inspect github <owner/repo> <pr-number> [--receipt <receipt.json>] [--json]\n';
}
async function readJSON(file) {
  const info=await stat(file);
  if(!info.isFile()||info.size>MAX_BYTES)throw Error(`Input must be a regular JSON file <= ${MAX_BYTES} bytes`);
  const contents=await readFile(file,'utf8');
  return JSON.parse(contents);
}
async function main() {
  const args=process.argv.slice(2);
  const json=args.includes('--json');
  const positional=args.filter(a=>a!=='--json');
  if (positional.length===1 && ['--help','-h','help'].includes(positional[0])) {console.log(usage());return 0;}
  let output,mode='validation';
  if(positional[0]==='validate' && positional.length===3) {
    const kind=positional[1];if(!['contract','receipt'].includes(kind))throw Error(usage());
    const value=await readJSON(positional[2]);
    output=kind==='contract'?validateContract(value):validateReceipt(value);
    output={kind, ...output, independently_verified:false};
  } else if(positional[0]==='assess' && positional.length===3) {
    mode='assessment';
    output=assess(await readJSON(positional[1]),await readJSON(positional[2]));
  } else if(positional[0]==='inspect' && positional[1]==='github') {
    mode='github';
    const receiptIndex=positional.indexOf('--receipt');
    let receiptPath=null;
    if(receiptIndex!==-1){
      if(receiptIndex!==4||positional.length!==6||!positional[5]||positional[5].startsWith('--'))throw Error(usage());
      receiptPath=positional[5];
      positional.splice(receiptIndex,2);
    }
    if(positional.length!==4)throw Error(usage());
    const snapshot=await inspectGitHubPR({repository:positional[2],prNumber:positional[3],token:process.env.AIEI_GITHUB_TOKEN||null});
    output=receiptPath?{snapshot,receipt_comparison:compareGitHubReceipt(snapshot,await readJSON(receiptPath))}:snapshot;
  } else throw Error(usage());
  if(json)console.log(JSON.stringify(output,null,2));
  else if(mode==='github'){
    const s=output.snapshot??output;
    console.log(`GitHub PR: ${s.repository} #${s.number}, ${s.draft?'draft':'reviewable'} (${s.state})`);
    console.log(`Current head: ${s.head_sha}`);
    console.log(`Check runs: ${s.summary.check_runs.successful}/${s.summary.check_runs.observed} succeeded`);
    console.log(`Workflow runs: ${s.summary.workflow_runs.successful}/${s.summary.workflow_runs.observed} succeeded`);
    console.log(`Commit status contexts: ${s.summary.commit_status_count} (${s.commit_status.combined_state})`);
    console.log(`Pages: checks ${s.summary.pages_fetched.check_runs}, workflows ${s.summary.pages_fetched.workflow_runs}, statuses ${s.summary.pages_fetched.commit_status}`);
    console.log(`Observed metadata complete: ${s.summary.collection_complete?'YES':'NO'}`);
    console.log(`All OBSERVED checks successful: ${s.summary.all_observed_checks_successful?'YES':'NO'}`);
    if(output.receipt_comparison){
      console.log(`Receipt run links corroborated: ${output.receipt_comparison.matched.length}; unmatched: ${output.receipt_comparison.unmatched.length}`);
      for(const error of output.receipt_comparison.blockers)console.log(`BLOCKED: ${error}`);
    }
    console.log('NOT a release approval: GitHub API metadata does not prove test coverage, human signoff or production behavior.');
  } else {
    console.log(`${mode==='assessment'?'Policy assessment':'Schema validation'}: ${output.valid?'VALID':'INVALID'}`);
    for (const error of output.errors??[])console.log(`ERROR: ${error}`);
    for (const blocker of output.blockers??[])console.log(`BLOCKED: ${blocker}`);
    for (const warning of output.warnings??[])console.log(`NOTE: ${warning}`);
    if(mode==='assessment')console.log(`Ready for human review: ${output.ready_for_human_review?'YES (not a release approval)':'NO'}`);
    else console.log('Schema validation does not verify the truth of submitted claims.');
  }
  if(mode==='github'){
    const s=output.snapshot??output;
    return s.summary.collection_complete&&s.summary.all_observed_checks_successful&&
      (!output.receipt_comparison || output.receipt_comparison.valid)?0:1;
  }
  return !output.valid||Boolean(output.blockers?.length)?1:0;
}
main().then(code=>{process.exitCode=code}).catch(err=>{console.error(`AIEI: ${err.message}`);process.exitCode=2});
