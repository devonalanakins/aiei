// Merit offline evidence evaluation v1: structural, NOT provenance authentication.
import {createHash} from 'node:crypto';
export const EVIDENCE_VERSION='merit.evidence.v1';
export const POLICY_VERSION='merit.policy.v1';
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const digestJSON=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(errors,path,msg)=>errors.push(path+': '+msg);
const check=(v,e,p,m)=>{if(!v)fail(e,p,m);};
const text=(x,n=1000)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\x00-\x1f\x7f]/.test(x);
function record(x,keys,required,errors,path){
  if(x===null||typeof x!=='object'||Array.isArray(x)||![Object.prototype,null].includes(Object.getPrototypeOf(x))) {
    fail(errors,path,'expected plain object');return false;
  }
  for(const k of Object.keys(x))if(!keys.includes(k))fail(errors,path+'.'+k,'unexpected key');
  for(const k of required)if(!Object.hasOwn(x,k))fail(errors,path+'.'+k,'missing');
  return true;
}
function list(x,errors,path,max=128){
  if(!Array.isArray(x)||x.length>max){fail(errors,path,'expected bounded array');return [];}
  return x;
}
function strings(x,errors,path,max=32) {
  const a=list(x,errors,path,max);
  for(const [i,v] of a.entries())check(text(v),errors,path+'['+i+']','invalid text');
  if(new Set(a).size!==a.length)fail(errors,path,'duplicate values');
  return a;
}
function subject(x,e,p) {
  if(!record(x,['repository','revision','source_sha256','ir_version','ir_sha256'],
    ['repository','revision','source_sha256','ir_version','ir_sha256'],e,p))return;
  check(REPO.test(x.repository),e,p+'.repository','invalid repository');
  check(SHA.test(x.revision),e,p+'.revision','invalid commit');
  check(HASH.test(x.source_sha256),e,p+'.source_sha256','invalid digest');
  check(text(x.ir_version,100),e,p+'.ir_version','invalid version');
  check(HASH.test(x.ir_sha256),e,p+'.ir_sha256','invalid digest');
}
function outcome(x,e,p){
  if(!record(x,['stdout','trap'],['stdout','trap'],e,p))return;
  strings(x.stdout,e,p+'.stdout',512);
  check(['none','overflow','budget','error'].includes(x.trap),e,p+'.trap','unknown trap');
}
function scope(x,e,p) {
  if(!record(x,['language','semantics','targets'],['language','semantics','targets'],e,p))return;
  check(text(x.language,100),e,p+'.language','invalid language');
  check(text(x.semantics,100),e,p+'.semantics','invalid semantics');
  strings(x.targets,e,p+'.targets',8);
}

function artifacts(x,e,p) {
  if(!record(x,['js','python'],['js','python'],e,p))return;
  for(const t of ['js','python'])check(HASH.test(x[t]),e,p+'.'+t,'invalid digest');
}
// Duplicate JSON members must be rejected before JSON.parse can overwrite them.
export function parseEvidenceJSON(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>1_048_576)throw new RangeError('Evidence JSON must be <=1 MiB');
  let i=0;
  const error=m=>{throw new SyntaxError('Evidence JSON at '+i+': '+m);};
  const ws=()=>{while(/[ \t\n\r]/.test(raw[i]??'\0'))i++;};
  const quoted=decode=>{
    if(raw[i]!=='"')error('expected string');
    const start=i++;
    while(i<raw.length){
      const c=raw[i++];
      if(c==='\\')i++;
      else if(c==='"')return decode?JSON.parse(raw.slice(start,i)):undefined;
    }
    error('unterminated string');
  };
  const value=depth=>{
    if(depth>64)error('depth limit');
    ws();const c=raw[i];
    if(c==='"')return quoted(false);
    if(c==='{'){
      i++;ws();const seen=new Set();
      if(raw[i]==='}'){i++;return;}
      while(i<raw.length){
        ws();const k=quoted(true);
        if(seen.has(k))error('duplicate member '+k);
        seen.add(k);ws();if(raw[i++]!==':')error('expected colon');
        value(depth+1);ws();const separator=raw[i++];
        if(separator==='}')return;
        if(separator!==',')error('expected object separator');
      }
      error('unterminated object');
    }
    if(c==='['){
      i++;ws();if(raw[i]===']'){i++;return;}
      while(i<raw.length){
        value(depth+1);ws();const separator=raw[i++];
        if(separator===']')return;
        if(separator!==',')error('expected array separator');
      }
      error('unterminated array');
    }
    if(c==='-'||(c>='0'&&c<='9')){
      i++;while(/[0-9.eE+\-]/.test(raw[i]??'\0'))i++;return;
    }
    for(const k of ['true','false','null'])if(raw.startsWith(k,i)){i+=k.length;return;}
    error('unexpected token');
  };
  value(0);ws();if(i!==raw.length)error('trailing content');
  return JSON.parse(raw);
}
export function validateEvidencePacket(x){
  const e=[];
  if(!record(x,['schema_version','claim_id','subject','predicate','scope','assumptions','policy_digest','artifacts','witnesses','unsupported','open_obligations','verification_method'],
    ['schema_version','claim_id','subject','predicate','scope','assumptions','policy_digest','artifacts','witnesses','unsupported','open_obligations','verification_method'],e,'packet'))return {valid:false,errors:e};
  check(x.schema_version===EVIDENCE_VERSION,e,'packet.schema_version','unsupported');
  check(ID.test(x.claim_id),e,'packet.claim_id','invalid ID');
  subject(x.subject,e,'packet.subject');
  check(text(x.predicate),e,'packet.predicate','invalid predicate');
  scope(x.scope,e,'packet.scope');
  strings(x.assumptions,e,'packet.assumptions');
  check(HASH.test(x.policy_digest),e,'packet.policy_digest','invalid digest');
  artifacts(x.artifacts,e,'packet.artifacts');
  strings(x.unsupported,e,'packet.unsupported');
  strings(x.open_obligations,e,'packet.open_obligations');
  check(text(x.verification_method,250),e,'packet.verification_method','invalid method');
  list(x.witnesses,e,'packet.witnesses').forEach((w,i)=>{
    const p='packet.witnesses['+i+']';
    if(!record(w,['id','obligation','producer','run_id','attempt','revision','source_sha256','ir_sha256','artifact_sha256','toolchain','observed_at','outcome','depends_on'],
      ['id','obligation','producer','run_id','attempt','revision','source_sha256','ir_sha256','toolchain','observed_at','outcome','depends_on'],e,p))return;
    for(const k of ['id','obligation','producer','run_id'])check(ID.test(w[k]),e,p+'.'+k,'invalid ID');
    check(Number.isSafeInteger(w.attempt)&&w.attempt>=1&&w.attempt<=1_000_000,e,p+'.attempt','invalid attempt');
    check(SHA.test(w.revision),e,p+'.revision','invalid commit');
    check(HASH.test(w.source_sha256),e,p+'.source_sha256','invalid digest');
    check(HASH.test(w.ir_sha256),e,p+'.ir_sha256','invalid digest');
    if(Object.hasOwn(w,'artifact_sha256'))check(HASH.test(w.artifact_sha256),e,p+'.artifact_sha256','invalid digest');
    check(text(w.toolchain,150),e,p+'.toolchain','invalid toolchain');
    check(typeof w.observed_at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(w.observed_at)&&!Number.isNaN(Date.parse(w.observed_at)),e,p+'.observed_at','invalid timestamp');
    outcome(w.outcome,e,p+'.outcome');
    strings(w.depends_on,e,p+'.depends_on');
  });
  return {valid:e.length===0,errors:e};
}
export function validateEvidencePolicy(x){
  const e=[];
  if(!record(x,['schema_version','claim_id','subject','predicate','scope','obligations','artifacts','toolchains','not_before'],
    ['schema_version','claim_id','subject','predicate','scope','obligations','artifacts','toolchains'],e,'policy'))return {valid:false,errors:e};
  check(x.schema_version===POLICY_VERSION,e,'policy.schema_version','unsupported');
  check(ID.test(x.claim_id),e,'policy.claim_id','invalid ID');
  subject(x.subject,e,'policy.subject');
  check(text(x.predicate),e,'policy.predicate','invalid predicate');
  scope(x.scope,e,'policy.scope');
  artifacts(x.artifacts,e,'policy.artifacts');
  if(record(x.toolchains,['rhen-reference','js','python','independent-oracle'],[],e,'policy.toolchains'))
    for(const [k,v] of Object.entries(x.toolchains))check(text(v,150),e,'policy.toolchains.'+k,'invalid identity');
  if(Object.hasOwn(x,'not_before'))check(typeof x.not_before==='string'&&!Number.isNaN(Date.parse(x.not_before)),e,'policy.not_before','invalid timestamp');
  const os=list(x.obligations,e,'policy.obligations',64);
  for(const [i,o] of os.entries()){
    const p='policy.obligations['+i+']';
    if(!record(o,['id','producers','expected'],['id','producers','expected'],e,p))continue;
    check(ID.test(o.id),e,p+'.id','invalid ID');
    const producers=strings(o.producers,e,p+'.producers',16);
    check(producers.length>0,e,p+'.producers','empty');
    outcome(o.expected,e,p+'.expected');
  }
  check(os.length>0,e,'policy.obligations','missing obligations');
  check(new Set(os.map(o=>o?.id)).size===os.length,e,'policy.obligations','duplicate IDs');
  return {valid:e.length===0,errors:e};
}
/** No release authorization, no cryptographic attestation: policy and evidence are caller supplied. */
export function evaluateEvidenceGraph(packet,policy){
  const v1=validateEvidencePacket(packet),v2=validateEvidencePolicy(policy),errors=[...v1.errors,...v2.errors];
  const result=(verdict,reasons=[],missing=[])=>({
    schema_version:EVIDENCE_VERSION,claim_id:packet?.claim_id??null,valid:!errors.length,
    verdict,reasons:[...new Set([...errors,...reasons])].sort(),missing_obligations:[...new Set(missing)].sort(),
    supported_scope:verdict==='SUPPORTED_WITH_SCOPE'?packet.scope:null,
    independently_verified:false,provenance_authenticated:false,release_authorized:false,
  });
  if(errors.length)return result('INSUFFICIENT');
  if(packet.policy_digest!==digestJSON(policy)||packet.claim_id!==policy.claim_id)
    return result('POLICY_BLOCKED',['Trusted policy digest or claim binding changed']);
  // Claim wording and declared semantic coverage are policy inputs, not
  // untrusted packet assertions. Binding the full ordered target list is
  // deliberately strict for this draft schema; policy provenance is not authenticated.
  if(packet.predicate!==policy.predicate||
     packet.scope.language!==policy.scope.language||
     packet.scope.semantics!==policy.scope.semantics||
     packet.scope.targets.length!==policy.scope.targets.length||
     !packet.scope.targets.every((target,i)=>target===policy.scope.targets[i]))
    return result('POLICY_BLOCKED',['Claim predicate or declared semantic scope differs from separately supplied policy']);
  const a=packet.subject,b=policy.subject;
  if(a.repository!==b.repository||a.revision!==b.revision)return result('STALE',['Repository or revision differs']);
  if(a.source_sha256!==b.source_sha256||a.ir_version!==b.ir_version||a.ir_sha256!==b.ir_sha256)
    return result('UNTRUSTED_SOURCE',['Source or validated IR identity differs']);
  for(const k of ['js','python'])if(packet.artifacts[k]!==policy.artifacts[k])
    return result('STALE',[k+' artifact changed']);
  const ids=new Set(),runs=new Set(),covered=new Set(),reasons=[],contradictions=[];
  const required=new Map(policy.obligations.map(o=>[o.id,o]));
  for(const w of packet.witnesses){
    const key=w.obligation+'/'+w.producer,run=w.run_id+'/'+w.attempt;
    if(ids.has(w.id)||runs.has(run)||covered.has(key))reasons.push('Reused execution identity or evidence coverage: '+w.id);
    ids.add(w.id);runs.add(run);covered.add(key);
    if(w.depends_on.includes(packet.claim_id)||w.depends_on.includes('claim:'+packet.claim_id))
      reasons.push('Circular self-certification: '+w.id);
    if(w.revision!==a.revision||w.source_sha256!==a.source_sha256||w.ir_sha256!==a.ir_sha256)
      reasons.push('Misattributed source/IR witness: '+w.id);
    const obligation=required.get(w.obligation);
    if(!obligation||!obligation.producers.includes(w.producer)){reasons.push('Unrequested witness: '+w.id);continue;}
    if(policy.toolchains[w.producer]!==w.toolchain)reasons.push('Wrong witness toolchain: '+w.id);
    if(policy.not_before&&Date.parse(w.observed_at)<Date.parse(policy.not_before))reasons.push('Expired witness: '+w.id);
    if(['js','python'].includes(w.producer)&&w.artifact_sha256!==policy.artifacts[w.producer])
      reasons.push('Wrong backend artifact identity: '+w.id);
    if(w.outcome.trap!==obligation.expected.trap||w.outcome.stdout.length!==obligation.expected.stdout.length||
       !w.outcome.stdout.every((s,i)=>s===obligation.expected.stdout[i]))
      contradictions.push('Observed trace disagrees with independent oracle: '+w.id);
  }
  // A declared dependency is not a trusted edge. Reject dangling and cyclic
  // witness references instead of allowing self-affirming evidence chains.
  const graph=new Map(packet.witnesses.map(w=>[w.id,w.depends_on]));
  const visited=new Set(),active=new Set();
  const visit=(id,depth=0)=>{
    if(depth>128){reasons.push('Evidence dependency depth exceeded');return;}
    if(active.has(id)){reasons.push('Circular witness evidence: '+id);return;}
    if(visited.has(id))return;
    active.add(id);
    for(const parent of graph.get(id)??[]){
      if(!graph.has(parent))reasons.push('Unresolved evidence dependency: '+id+' -> '+parent);
      else visit(parent,depth+1);
    }
    active.delete(id);visited.add(id);
  };
  for(const id of graph.keys())visit(id);
  if(reasons.length)return result('UNTRUSTED_SOURCE',reasons);
  if(contradictions.length)return result('REFUTED',contradictions);
  const missing=[...packet.open_obligations];
  for(const o of policy.obligations)for(const producer of o.producers)
    if(!covered.has(o.id+'/'+producer))missing.push(o.id+'/'+producer);
  if(missing.length)return result('INSUFFICIENT',['Unresolved witness or verification obligations'],missing);
  if(packet.unsupported.length)return result('OUT_OF_SCOPE',['Unsupported semantic region: '+packet.unsupported.join(', ')]);
  return result('SUPPORTED_WITH_SCOPE',['All caller-supplied traces match pinned policy; witness origin is NOT authenticated']);
}
