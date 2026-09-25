import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const server=`
export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p,revision)=>{await Promise.resolve();if(revision!==state.revision)throw Object.assign(Error('conflict'),{status:409});p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(u,id,fn)=>{for(let n=0;n<5;n++){const p=await loadProject(),rev=p.revision;fn(p);try{return await saveProject(u,p,rev)}catch(e){if(e.status!==409||n===4)throw e}}};
export const getKey=async()=> 'mock';export const asset=async()=>({mime:'image/png',size:100});
export const imageData=async()=> 'data:image/png;base64,AA==';export const storeAsset=async(_,id)=>id;export const runtime={FILES:{}};
`;
const provider=`
export class ProviderError extends Error {};
export const generate=async j=>{globalThis.calls.push(j.id);await new Promise(resolve=>globalThis.releases.set(j.id,resolve));return {requestId:j.id,pending:true}};
export const poll=async j=>globalThis.finished.has(j.id)?{bytes:new Uint8Array([1]),mime:'video/mp4'}:{requestId:j.id,pending:true};
export const retrieve=async()=>({bytes:new Uint8Array([1]),mime:'video/mp4'});
`;
await build({entryPoints:['lib/domain.ts','lib/generation-queue.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-remaining/route.ts','app/api/projects/[id]/jobs/[jobId]/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/parallel-video',outExtension:{'.js':'.mjs'},plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/providers$/},args=>args.importer.includes('jobs')?{path:'provider',namespace:'mock'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='server'?server:provider}));
}}]});
const root='../work/tests/parallel-video/',D=await import(root+'lib/domain.mjs'),Q=await import(root+'lib/generation-queue.mjs');
const {POST:generate}=await import(root+'app/api/projects/[id]/generate/route.mjs'),{POST:remaining}=await import(root+'app/api/projects/[id]/generate-remaining/route.mjs'),{POST:tick}=await import(root+'app/api/projects/[id]/jobs/[jobId]/route.mjs');
const p=D.newProject('Parallel video'),shots=Array.from({length:10},(_,n)=>({title:'Plan '+n,description:'Лес',duration:5,camera:'Общий план',dialogue:'',continuity:'Склейка',speechType:'none'}));
for(const i of p.items.filter(i=>i.stage<7).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа',kind:i.stage===5?'image':'text',assetId:i.stage===5?D.id():undefined});D.approve(p,i.id);}
const a=p.items.find(i=>i.stage===7);a.sourceShot={scriptId:p.items[4].id,title:'Plan 0'};
const b={id:D.id(),stage:7,title:'Plan 1',sourceShot:{scriptId:p.items[4].id,title:'Plan 1'},variants:[]};p.items.push(b);
const c={...structuredClone(b),id:D.id(),title:'Plan 2',sourceShot:{scriptId:p.items[4].id,title:'Plan 2'}};p.items.push(c);
const ctx={params:Promise.resolve({id:p.id})},req=body=>new Request('https://test/api',{method:'POST',body:JSON.stringify(body)});
const input=(item,models=['grok-imagine-video-1.5'],count=1)=>({revision:state.revision,batchId:D.id(),itemId:item.id,models,count,prompt:'Камера над лесом',refs:[D.id()],characterIds:[],dialogue:'',voiceId:'',estimates:Object.fromEntries(models.map(m=>[m,'100']))});
globalThis.state=structuredClone(p);
const first=input(a,['grok-imagine-video-1.5','MiniMax-Hailuo-2.3'],2);await generate(req(first),ctx);assert.equal(state.jobs.length,4);
assert.equal(Q.runnableJobs(state,new Set(),new Map()).length,3);
assert.equal(new Set(Q.runnableJobs(state,new Set(),new Map()).map(j=>j.model)).size,2,'Schedule distinct models before extra variants');
const twoModels=structuredClone(state);await generate(req(input(b)),ctx);assert.equal(state.jobs.length,5,'Another plan can be queued during an active series');
await generate(req(first),ctx);assert.equal(state.jobs.length,5,'Idempotent retry');
await assert.rejects(()=>generate(req(input(a)),ctx),/этого плана/);
state.jobs[0].status='unknown';assert(Q.videoAdmissionIssue(state,a.id));
state=structuredClone(p);state.jobs=[{...twoModels.jobs[0],lipsync:{}}];assert(Q.videoAdmissionIssue(state,b.id));
state=structuredClone(p);state.limit='399';await assert.rejects(()=>generate(req({...first,revision:state.revision}),ctx),/лимит/);assert.equal(state.jobs.length,0);
// Concurrent enqueue merges other plans' results and validates budget on CAS retry.
const ja=twoModels.jobs.slice(0,1),jb=[{...twoModels.jobs[1],id:D.id(),batchId:D.id(),itemId:b.id}];
let stored=structuredClone(p);
const load=async()=>structuredClone(stored),save=async(next,rev)=>{await Promise.resolve();if(stored.revision!==rev)throw Object.assign(Error('conflict'),{status:409});stored={...structuredClone(next),revision:rev+1};return stored};
await Promise.all([Q.enqueuePlanJobs(p,ja,load,save),Q.enqueuePlanJobs(p,jb,load,save)]);assert.equal(stored.jobs.length,2);
stored={...structuredClone(p),limit:'150'};const snapshot=structuredClone(stored);
const limited=await Promise.allSettled([Q.enqueuePlanJobs(snapshot,ja,load,save),Q.enqueuePlanJobs(snapshot,jb,load,save)]);
assert.equal(limited.filter(r=>r.status==='fulfilled').length,1);assert.equal(stored.jobs.length,1);
// Four worker calls from multiple tabs can reserve only three provider tasks.
state=structuredClone(twoModels);globalThis.calls=[];globalThis.releases=new Map();globalThis.finished=new Set();
const jobs=state.jobs.map(j=>j.id),work=jobs.map(jobId=>tick(req({}),{params:Promise.resolve({id:p.id,jobId})}));
for(let n=0;n<100&&calls.length<3;n++)await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.length,3);assert.equal(state.jobs.filter(j=>j.status==='dispatching').length,3);
for(const release of releases.values())release();await Promise.all(work);
assert.equal(calls.length,3);assert.equal(state.jobs.filter(j=>j.status==='pending').length,3);assert.equal(state.jobs.filter(j=>j.status==='queued').length,1);
const queued=state.jobs.find(j=>j.status==='queued');await tick(req({}),{params:Promise.resolve({id:p.id,jobId:queued.id})});assert.equal(calls.length,3);
assert(Q.runnableJobs(state,new Set(),new Map()).every(j=>j.status==='pending'),'Polls do not free provider capacity');
await Promise.all(calls.map(jobId=>tick(req({}),{params:Promise.resolve({id:p.id,jobId})})));assert.equal(calls.length,3,'Polling never resends generation');
finished.add(calls[0]);await tick(req({}),{params:Promise.resolve({id:p.id,jobId:calls[0]})});
assert.equal(state.jobs.filter(j=>j.status==='done').length,1);assert(Q.runnableJobs(state,new Set(),new Map()).some(j=>j.id===queued.id));
const next=tick(req({}),{params:Promise.resolve({id:p.id,jobId:queued.id})});
for(let n=0;n<100&&!releases.has(queued.id);n++)await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.length,4);releases.get(queued.id)();await next;
// Remaining-plan modal tolerates background job revisions, but not changed basis.
state=structuredClone(p);D.addVariant(state,a.id,{kind:'video',assetId:D.id(),model:'grok-imagine-video-1.5'});
const batch={revision:state.revision,basis:D.dependencies(state,7),batchId:D.id(),sourceItemId:a.id,sourceVariantId:D.chosen(D.getItem(state,a.id)).id,estimate:'100',characterIds:[],plans:[{itemId:c.id,ref:D.id(),prompt:'Лес'}]};
state.jobs=[{...jb[0],status:'pending'}];state.revision++;
await remaining(req(batch),ctx);assert.equal(state.jobs.length,2);assert.equal(state.jobs[0].status,'pending');
await remaining(req(batch),ctx);assert.equal(state.jobs.length,2);
const bad=structuredClone(state);bad.configVersion++;state=bad;
await assert.rejects(()=>remaining(req({...batch,batchId:D.id()}),ctx),/Проект изменился/);
console.log('PASS parallel video: multi-model/plan admission, diverse fair scheduling, global three-task provider bound under concurrent workers, polling/release, atomic CAS budgets, idempotency and remaining-batch revision checks. Zero paid calls.');
