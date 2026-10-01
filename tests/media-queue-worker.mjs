import {build} from 'esbuild';
import assert from 'node:assert/strict';

const server=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=f=>f;
export const owner=async()=>{if(globalThis.denied)throw new HttpError('Unauthorized',401);return globalThis.requestOwner;};
export async function loadProject(user,id){globalThis.loads++;if(globalThis.owners.get(id)!==user)throw new HttpError('Wrong owner',404);return structuredClone(globalThis.projects.get(id));}
export async function saveProject(user,p,rev){await Promise.resolve();const old=globalThis.projects.get(p.id);if(owners.get(p.id)!==user)throw new HttpError('Wrong owner',404);if(old.revision!==rev)throw new HttpError('CAS conflict',409);p.revision=rev+1;projects.set(p.id,structuredClone(p));return p;}
export async function mutate(user,id,fn){for(let n=0;n<10;n++){const p=await loadProject(user,id),rev=p.revision;fn(p);try{return await saveProject(user,p,rev);}catch(e){if(e.status!==409||n===9)throw e;}}}
export const getKey=async()=> 'mock-key';export const imageData=async()=> 'data:image/png;base64,AA==';
export const asset=async()=>({mime:'audio/mpeg',size:2,id:'owned'});export const storeAsset=async(_,id)=>id;
export const runtime={FILES:{head:async()=>true},DB:{prepare:()=>({all:async()=>({results:[...projects].map(([id,p])=>({id,owner:owners.get(id),revision:p.revision}))})})}};
`;
const provider=`
export class ProviderError extends Error{constructor(message,definite=false,notSent=false){super(message);this.definite=definite;this.notSent=notSent;}}
export async function generate(j){calls.push({kind:'generate',id:j.id});await new Promise(resolve=>releases.set(j.id,resolve));return {requestId:'receipt-'+j.id,pending:true,actual:'120'};}
export async function poll(j){calls.push({kind:'poll',id:j.id,requestId:j.requestId});return finished.has(j.id)?{bytes:new Uint8Array([1,2]),mime:j.kind+'/mock',actual:'120'}:{requestId:j.requestId,pending:true};}
export const retrieve=async url=>{calls.push({kind:'retrieve',url});return {bytes:new Uint8Array([1,2]),mime:'image/png'};};
`;
const workflows=`
export async function runVoiceWorkflowStep(user,id,jobId){specialCalls.push({user,id,jobId,kind:'voice'});const p=projects.get(id);p.jobs.find(j=>j.id===jobId).status='done';p.revision++;return structuredClone(p);}
export async function runSoundscapeStep(user,id,jobId){specialCalls.push({user,id,jobId,kind:'sound'});const p=projects.get(id);p.jobs.find(j=>j.id===jobId).status='done';p.revision++;return structuredClone(p);}
export async function runDirectorStep(user,id){specialCalls.push({user,id,kind:'director'});const p=projects.get(id);for(const r of p.directing?.runs??[])for(const t of r.tasks)t.result={};p.revision++;return structuredClone(p);}
`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as Q from './lib/queue-policy';export {executeMediaJob} from './lib/media-job-runner';export {projectWorkerTick} from './lib/project-worker';export {POST} from './app/api/projects/[id]/jobs/[jobId]/route';export {POST as cron} from './app/api/worker/tick/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/media-queue-worker.mjs',plugins:[{name:'mock',setup(b){
  b.onResolve({filter:/^(?:@\/lib\/|\.\/)(server|providers|voice-design-runner|soundscape-runner|director-runner)$/},a=>({path:a.path.endsWith('/server')?'server':a.path.endsWith('/providers')?'provider':'workflow',namespace:'mock'}));
  b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));
  b.onResolve({filter:/^vinext\/shims\/request-context$/},()=>({path:'context',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='env'?`export const env=new Proxy({},{get:(_,key)=>key==='QUEUE_WORKER_SECRET'?process.env.QUEUE_WORKER_SECRET:undefined});`:a.path==='context'?`export const getRequestExecutionContext=()=>null;`:a.path==='server'?server:a.path==='provider'?provider:workflows}));
}}]});
const {D,Q,POST,cron,executeMediaJob,projectWorkerTick}=await import('../work/tests/media-queue-worker.mjs');
globalThis.projects=new Map();globalThis.owners=new Map();globalThis.loads=0;globalThis.calls=[];globalThis.specialCalls=[];globalThis.releases=new Map();globalThis.finished=new Set();globalThis.denied=false;globalThis.requestOwner='director';
const req=(body={},headers={})=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify(body),headers});
function fixture(owner='director'){
  const p=D.newProject('Смешанная очередь');
  for(const i of p.items.filter(i=>i.stage<8).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
    D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots:[{title:'План',description:'Лес',duration:5,camera:'Общий план',dialogue:'',speechType:'none',continuity:'Склейка'}]}):'Основа',kind:i.stage===5?'image':i.stage===7?'video':i.stage===6?'audio':'text',assetId:[5,6,7].includes(i.stage)?D.id():undefined});D.approve(p,i.id);
  }
  owners.set(p.id,owner);projects.set(p.id,structuredClone(p));return p;
}
function job(p,stage,model,kind,extra={}){
  const i=p.items.find(i=>i.stage===stage);
  return {id:D.id(),batchId:D.id(),itemId:i.id,model,kind,created:D.now(),status:'queued',actual:null,estimate:'1000',refs:[],characterRefs:[],prompt:'Лес',brief:'Короткий план',dialogue:'Привет',voiceId:'voice',duration:5,camera:'Общий план',continuity:'Склейка',offset:0,volume:1,deps:D.dependencies(p,stage),...extra};
}
const p=fixture();Q.saveQueueSettings(p,{concurrency:4,providerLimits:{xai:1,elevenlabs:1,minimax:1,fal:1}});
p.jobs=[job(p,1,'grok-imagine-image-2.0','image'),job(p,7,'MiniMax-Hailuo-2.3','video'),job(p,5,'fal-qwen-image-edit-2511','image'),job(p,6,'eleven_v3','audio')];
p.jobs.push({...job(p,1,'grok-imagine-image-2.0','image'),batchId:p.jobs[0].batchId});projects.set(p.id,structuredClone(p));
const advance=id=>POST(req(),{params:Promise.resolve({id:p.id,jobId:id})});
const concurrent=p.jobs.map(j=>advance(j.id));
for(let n=0;n<100&&calls.filter(c=>c.kind==='generate').length<4;n++)await new Promise(r=>setImmediate(r));
assert.equal(calls.filter(c=>c.kind==='generate').length,4,'Mixed image/video/voice tasks reserve configured project slots atomically');
assert.equal(projects.get(p.id).jobs.filter(j=>j.status==='dispatching').length,4);for(const release of releases.values())release();await Promise.all(concurrent);
assert.equal(projects.get(p.id).jobs.filter(j=>j.status==='pending').length,4);const waiting=projects.get(p.id).jobs.find(j=>j.status==='queued');assert(waiting);
await advance(waiting.id);assert.equal(calls.filter(c=>c.kind==='generate').length,4,'Pending receipts occupy capacity between polls');
const first=projects.get(p.id).jobs[0];finished.add(first.id);await advance(first.id);assert.equal(projects.get(p.id).jobs[0].status,'done');
const next=advance(waiting.id);for(let n=0;n<100&&!releases.has(waiting.id);n++)await new Promise(r=>setImmediate(r));assert(releases.has(waiting.id));releases.get(waiting.id)();await next;
assert.equal(calls.filter(c=>c.kind==='generate').length,5);
// Restart recovery continues existing receipts and saves files without another generation.
for(const j of projects.get(p.id).jobs.filter(j=>j.status==='pending'))finished.add(j.id);
const restartJob=projects.get(p.id).jobs[2];restartJob.status='saving';restartJob.output={url:'https://assets.test/already-paid.png',mime:'image/png'};
await projectWorkerTick();await projectWorkerTick();assert.equal(calls.filter(c=>c.kind==='generate').length,5);assert(projects.get(p.id).jobs.every(j=>j.status==='done'));
assert(calls.some(c=>c.kind==='poll'&&c.requestId?.startsWith('receipt-')));assert(calls.some(c=>c.kind==='retrieve'));const idleLoads=loads;await projectWorkerTick();assert.equal(loads,idleLoads,'Idle revisions avoid loading large state blobs');
// Public requests cannot call the trusted executor as a forged owner.
denied=true;const before=structuredClone(projects.get(p.id));await assert.rejects(()=>advance(first.id),e=>e.status===401);assert.deepEqual(projects.get(p.id),before);denied=false;
await assert.rejects(()=>executeMediaJob('stranger',p.id,first.id),e=>e.status===404);
// Separate voice/sound runners receive the database owner; their expired work receives only a watchdog.
const other=fixture('other-owner');other.jobs=[job(other,1,'grok-imagine-image-2.0','image',{purpose:'voice-design',voiceWorkflow:{provider:'elevenlabs'}}),job(other,3,'eleven_text_to_sound_v2','audio',{purpose:'soundscape',soundInput:{layerId:D.id()}}),job(other,1,'grok-imagine-image-2.0','image',{status:'unknown'}),job(other,1,'grok-imagine-image-2.0','image',{status:'failed'})];other.jobs[0].itemId=D.id();other.jobs[1].itemId=D.id();projects.set(other.id,structuredClone(other));
const tick=projectWorkerTick(),overlap=projectWorkerTick();await Promise.all([tick,overlap]);assert.equal(specialCalls.filter(c=>c.kind==='voice').length,1);assert.equal(specialCalls.filter(c=>c.kind==='sound').length,1);assert(specialCalls.every(c=>c.user==='other-owner'));
const current=projects.get(other.id);for(const j of current.jobs.slice(0,2)){j.status='dispatching';j.started=new Date(Date.now()-3600*1000).toISOString();}current.revision++;const total=specialCalls.length;await projectWorkerTick();assert.equal(specialCalls.length,total);assert(current.jobs.slice(0,2).every(j=>projects.get(other.id).jobs.find(x=>x.id===j.id).status==='unknown'));
assert(projects.get(other.id).jobs.slice(2).every(j=>['unknown','failed'].includes(j.status)));
// The private tick is disabled without a separate secret; body owner IDs do not authorize it.
delete process.env.QUEUE_WORKER_SECRET;await assert.rejects(()=>cron(req({owner:'director'}),{}),e=>e.status===401);
process.env.QUEUE_WORKER_SECRET='0123456789abcdef0123456789abcdef';await assert.rejects(()=>cron(req({}, {'x-queue-worker-secret':'wrong'}),{}),e=>e.status===401);
const cronResult=await (await cron(req({owner:'stranger'}, {'x-queue-worker-secret':process.env.QUEUE_WORKER_SECRET}),{})).json();assert.equal(cronResult.ok,true);assert.deepEqual(cronResult,'background' in cronResult?{ok:true,background:false}:{ok:true});delete process.env.QUEUE_WORKER_SECRET;
console.log('PASS actual media executor/HTTP/Node worker: mixed-stage CAS slots and provider bounds, trusted ownership, pending/saving restart receipts without resending, isolated voice/sound runners, overlapping ticks, expiry-only watchdog, revision cache and private cron secret. Mock APIs only.');
