#!/usr/bin/env node
// Public-repository, read-only probe. No token, changes, or release decisions.
import {inspectGitHubPR} from '../lib/github-evidence.mjs';
import {advisoryPilotReport} from '../lib/github-pilot.mjs';

async function main() {
  const [repository,prNumber,...extra] = process.argv.slice(2);
  if(!repository || !prNumber || extra.length)
    throw Error('Expected <owner/repo> <pr-number>');
  const snapshot=await inspectGitHubPR({repository,prNumber,token:null});
  const report=advisoryPilotReport(snapshot);
  if(report.repository?.toLowerCase()!==repository.toLowerCase() || report.pr_number!==Number(prNumber))
    throw Error('Unexpected GitHub PR identity');
  console.log(JSON.stringify(report,null,2));
  return report.observation==='INCOMPLETE' ? 1 : 0;
}
main().then(code=>{process.exitCode=code;}).catch(()=>{
  console.error('Merit pilot: read-only GitHub observation failed; no approval was issued.');
  process.exitCode=2;
});
