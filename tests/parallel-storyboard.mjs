import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock={name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
export const api=f=>f;export const owner=async()=> 'owner';
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p,revision)=>{if(revision!==state.revision)throw Object.assign(new Error('conflict'),{status:409});p.revision++;globalThis.state=structuredClone(p);return p};
export const getKey=async()=> 'mock-key';export const asset=async()=>({mime:'image/png',size:100});`}));}};
await build({entryPoints:['lib/domain.ts','lib/generation-queue.ts','app/api/projects/[id]/generate/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/parallel-storyboard',outExtension:{'.js':'.mjs'},plugins:[mock]});
const base='../work/tests/parallel-storyboard/',D=await import(base+'lib/domain.mjs'),Q=await import(base+'lib/generation-queue.mjs'),{POST}=await import(base+'app/api/projects/[id]/generate/route.mjs');
const p=D.newProject('Parallel');
const script=JSON.stringify({shots:Array.from({length:10},(_,n)=>({title:'Plan '+n,description:'Герой у окна',duration:5,camera:'Общий план',dialogue:'',continuity:'Прямая склейка',speechType:'none'}))});
for(const item of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,item.id,{text:item.stage===4?script:'Основа'});D.approve(p,item.id);}
const a=p.items[5],b={id:D.id(),title:'Plan B',stage:5,variants:[]};p.items.push(b);
a.sourceShot={scriptId:p.items[4].id,title:'Plan 0'};b.sourceShot={scriptId:p.items[4].id,title:'Plan 1'};
D.addVariant(p,a.id,{text:'Кадр A'});D.addVariant(p,b.id,{text:'Кадр B'});
const job={id:D.id(),batchId:D.id(),itemId:a.id,model:'grok-imagine-image-2.0',kind:'image',status:'pending',deps:D.dependencies(p,5),estimate:'100',actual:null};p.jobs.push(job);
assert.equal(Q.storyboardAdmissionIssue(p,b.id),'');assert(Q.storyboardAdmissionIssue(p,a.id));
const payload={revision:p.revision,batchId:D.id(),itemId:b.id,models:['grok-imagine-image-2.0'],count:1,prompt:'Create this frame',refs:[],dialogue:'',voiceId:'',estimates:{'grok-imagine-image-2.0':'100'}};
const run=body=>POST(new Request('http://test',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
globalThis.state=structuredClone(p);
await run(payload);assert.equal(state.jobs.length,2);assert.equal(state.jobs[0].status,'pending');assert.equal(state.jobs[1].itemId,b.id);
await run(payload);assert.equal(state.jobs.length,2,'Same batch retry must be idempotent');
await assert.rejects(()=>run({...payload,batchId:D.id(),revision:state.revision}),/этого плана/);
const live=structuredClone(state);
for(const mutate of [x=>{x.jobs[0].status='unknown'},x=>{x.jobs[0].status='saving'},x=>{x.jobs[0].kind='video'}]) {
 state=structuredClone(p);mutate(state);
 const input={...payload,itemId:state.jobs[0].kind==='video'?b.id:a.id};const before=structuredClone(state);
 await assert.rejects(()=>run(input));assert.deepEqual(state,before);
}
state=structuredClone(p);state.limit='150';await assert.rejects(()=>run(payload),/превысит лимит/);assert.equal(state.jobs.length,1);
// A slow request occupies only one slot; a pending poll never starves a new plan.
const queue=structuredClone(live);queue.jobs.push({...queue.jobs[1],id:D.id()}, {...queue.jobs[1],id:D.id()});
assert.equal(Q.runnableJobs(queue,new Set(),new Map()).length,3);
const flights=new Set([job.id]);const attempted=new Map([[job.id,100]]);
assert.equal(Q.runnableJobs(queue,flights,attempted).length,2);assert(Q.runnableJobs(queue,flights,attempted).every(j=>j.id!==job.id));
assert.equal(Q.runnableJobs(queue,new Set(queue.jobs.slice(0,3).map(j=>j.id)),attempted).length,0);
assert.equal(Q.runnableJobs(live,new Set(),attempted)[0].itemId,b.id);
const serial=structuredClone(queue);serial.jobs[0].kind='video';assert.equal(Q.runnableJobs(serial,new Set(),attempted).length,1);assert.equal(Q.runnableJobs(serial,flights,attempted).length,0);
assert.equal(Q.newestProject({...p,revision:10},{...p,revision:9}).revision,10);
assert.equal(Q.newestProject({...p,revision:9},{...p,revision:10}).revision,10);
// Simulate a background result winning CAS while the new plan is being saved.
const jobs=[live.jobs[1]];let stored=structuredClone(p),saves=0;
const result=await Q.enqueueStoryboard(p,jobs,async()=>structuredClone(stored),async(next,revision)=>{
 if(!saves++){stored.jobs[0].status='done';stored.revision++;throw Object.assign(new Error('CAS conflict'),{status:409});}
 assert.equal(revision,stored.revision);stored={...next,revision:revision+1};return stored;
});
assert.equal(result.jobs.length,2);assert.equal(result.jobs[0].status,'done');assert.equal(saves,2);
for(const change of [x=>{x.configVersion++},x=>{x.limit='150'},x=>{D.chosen(x.items.find(i=>i.id===b.id)).text='Changed'},x=>{x.jobs.push({...jobs[0],batchId:D.id()})}]) {
 const fresh=structuredClone(p);change(fresh);let writes=0;
 await assert.rejects(()=>Q.enqueueStoryboard(p,jobs,async()=>structuredClone(fresh),async()=>{writes++;return fresh}));assert.equal(writes,0);
}
console.log('PASS parallel storyboard admission, same-plan protection, uncertain requests, aggregate budget, fair bounded scheduler, stale-response guard, CAS merge without lost results or duplicate costs.');
