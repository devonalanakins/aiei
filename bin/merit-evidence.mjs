#!/usr/bin/env node
// Offline-only, bounded, read-only graph evaluation. No repository or network access.
import {readFile,stat} from 'node:fs/promises';
import {parseEvidenceJSON,evaluateEvidenceGraph} from '../lib/evidence-graph.mjs';
const LIMIT=1_048_576;
async function load(path) {
  const info=await stat(path);
  if(!info.isFile()||info.size>LIMIT)throw new TypeError('Expected a regular JSON input <= 1 MiB');
  return parseEvidenceJSON(await readFile(path,'utf8'));
}
async function main(args) {
  if(args.length===1&&['--help','-h'].includes(args[0])) {
    console.log('Usage: node bin/merit-evidence.mjs <packet.json> <trusted-policy.json>');
    return 0;
  }
  if(args.length!==2)throw new TypeError('Expected an evidence packet and separately supplied policy JSON file');
  const result=evaluateEvidenceGraph(await load(args[0]),await load(args[1]));
  console.log(JSON.stringify(result,null,2));
  return result.verdict==='SUPPORTED_WITH_SCOPE'?0:1;
}
main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(err=>{
  console.error('Merit evidence: '+err.message);process.exitCode=2;
});
