import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const server=`
export const api=f=>f;export const owner=async()=> 'owner';
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p,revision)=>{await Promise.resolve();if(revision!==state.revision)throw Object.assign(Error('conflict'),{status:409});p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(u,id,fn)=>{for(let n=0;n<5;n++){const p=await loadProject(),rev=p.revision;fn(p);try{return await saveProject(u,p,rev)}catch(e){if(e.status!==409||n===4)throw e}}};
export const getKey=async()=> 'mock';export const asset=async()=>({mime:'image/png',size:100});
export const imageData=async()=> 'data:image/png;base64,AA==';export const storeAsset=async(_,id)=>id;export const runtime={FILES:{}};`;
const provider=`export class ProviderError extends Error{};
export const generate=async j=>{calls.push(j.id);await new Promise(r=>releases.set(j.id,r));return {requestId:j.id,pending:true}};
export const poll=async j=>finished.has(j.id)?{bytes:new Uint8Array([1]),mime:'image/png'}:{requestId:j.id,pending:true};
export const retrieve=async()=>({bytes:new Uint8Array([1]),mime:'image/png'});`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as Q from './lib/generation-queue';export {POST as generate} from './app/api/projects/[id]/generate/route';export {POST as tick} from './app/api/projects/[id]/jobs/[jobId]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/parallel-concepts.mjs',plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/providers$/},a=>a.importer.includes('jobs')?{path:'provider',namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server'?server:provider}));
}}]});
const {D,Q,generate,tick}=await import('../work/tests/parallel-concepts.mjs');
function fixture(stage=1){const p=D.newProject('Образы');for(const i of p.items.filter(i=>D.precedesStage(i.stage,stage)).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:'Основа'});D.approve(p,i.id);}const a=p.items.find(i=>i.stage===stage),b={id:D.id(),title:'Второй герой',stage,variants:[]};p.items.push(b);return {p,a,b};}
const req=x=>new Request('http://test',{method:'POST',body:JSON.stringify(x)});
const body=(i,models=['grok-imagine-image-2.0'],count=1)=>({revision:state.revision,batchId:D.id(),itemId:i.id,models,count,prompt:'Анимационный персонаж на нейтральном фоне',refs:[],referenceMode:'selected',dialogue:'',voiceId:'',estimates:Object.fromEntries(models.map(m=>[m,'100']))});
const run=x=>generate(req(x),{params:Promise.resolve({id:state.id})});
for(const stage of [1,2,3]){
 const {p,a,b}=fixture(stage);globalThis.state=structuredClone(p);
 const input=body(a,['grok-imagine-image-2.0','image-01'],2);await run(input);assert.equal(state.jobs.length,4);
 assert.equal(Q.runnableJobs(state,new Set(),new Map()).length,3);
 assert.equal(new Set(Q.runnableJobs(state,new Set(),new Map()).map(j=>j.model)).size,2);
 await run(body(b));assert.equal(state.jobs.length,5,'Different character/material admitted while first is queued');
 await run(input);assert.equal(state.jobs.length,5,'Batch retry is idempotent');
 await assert.rejects(()=>run(body(a)),/этой карточки/);
 state.jobs[0].status='unknown';assert(Q.conceptImageAdmissionIssue(state,a.id));
 const queued=structuredClone(state);queued.jobs[0].status='pending';assert.equal(Q.runnableJobs(queued,new Set([queued.jobs[0].id]),new Map()).length,2,'Slow provider does not block other slots');
 state=structuredClone(p);state.limit='399';await assert.rejects(()=>run(body(a,input.models,2)),/лимит/);assert.equal(state.jobs.length,0);
 state=structuredClone(p);state.jobs=[{...queued.jobs[0],kind:'text'}];assert(Q.conceptImageAdmissionIssue(state,b.id),'Text stays serial');
}
const {p,a,b}=fixture();state=structuredClone(p);await run(body(a,['grok-imagine-image-2.0','image-01'],2));const batch=structuredClone(state);
// Server-wide reservation: even simultaneous requests from different tabs cannot exceed three.
globalThis.calls=[];globalThis.releases=new Map();globalThis.finished=new Set();
const advance=id=>tick(req({}),{params:Promise.resolve({id:state.id,jobId:id})});
const work=state.jobs.map(j=>advance(j.id));
for(let n=0;n<100&&calls.length<3;n++)await new Promise(r=>setImmediate(r));
assert.equal(calls.length,3);for(const release of releases.values())release();await Promise.all(work);
assert.equal(state.jobs.filter(j=>j.status==='pending').length,3);const waiting=state.jobs.find(j=>j.status==='queued');assert(waiting);
await advance(waiting.id);assert.equal(calls.length,3);
await Promise.all(calls.map(advance));assert.equal(calls.length,3,'Polling never regenerates');
finished.add(calls[1]);await advance(calls[1]);assert.equal(state.jobs.filter(j=>j.status==='done').length,1);assert.equal(D.getItem(state,a.id).variants.length,1);
const next=advance(waiting.id);for(let n=0;n<100&&!releases.has(waiting.id);n++)await new Promise(r=>setImmediate(r));assert.equal(calls.length,4);releases.get(waiting.id)();await next;
// Saving other cards' results while enqueuing must not lose either result or spend.
const ja=[batch.jobs[0]],jb=[{...batch.jobs[1],id:D.id(),batchId:D.id(),itemId:b.id}];let stored=structuredClone(p);
const load=async()=>structuredClone(stored),save=async(next,rev)=>{await Promise.resolve();if(stored.revision!==rev)throw Object.assign(Error('conflict'),{status:409});stored={...structuredClone(next),revision:rev+1};return stored};
await Promise.all([Q.enqueuePlanJobs(p,ja,load,save),Q.enqueuePlanJobs(p,jb,load,save)]);assert.equal(stored.jobs.length,2);
stored={...structuredClone(p),limit:'150'};const snapshot=structuredClone(stored);const outcomes=await Promise.allSettled([Q.enqueuePlanJobs(snapshot,ja,load,save),Q.enqueuePlanJobs(snapshot,jb,load,save)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(stored.jobs.length,1);
for(const change of [x=>{x.configVersion++},x=>{D.getItem(x,a.id).removedAt=D.now()},x=>{D.getItem(x,a.id).title='Изменённый герой'}]){stored=structuredClone(p);change(stored);await assert.rejects(()=>Q.enqueuePlanJobs(p,ja,load,save));assert.equal(stored.jobs.length,0);}
console.log('PASS parallel concepts: heroes/style/locations, multiple models and cards, three global provider slots, slow request isolation, polling without regeneration, idempotency, CAS merge/budget limits and stale/deleted card protection. No paid requests.');
