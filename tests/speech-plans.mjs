import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/speech.ts','lib/render.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/speech-plans',outExtension:{'.js':'.mjs'},external:['@ffmpeg/ffmpeg']});
const D=await import('../work/tests/speech-plans/domain.mjs'), S=await import('../work/tests/speech-plans/speech.mjs'), R=await import('../work/tests/speech-plans/render.mjs');
const p=D.newProject('По планам');
const shots=Array.from({length:10},(_,n)=>({title:`План ${n+1}`,description:'Действие',duration:5,camera:'Наезд',continuity:'Склейка',dialogue:n===9?'':'КАТЯ, ЗА КАДРОМ: Реплика '+n+'.'}));
for(const i of p.items.filter(i=>i.stage<=4)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
const script=p.items[4];
p.items=p.items.filter(i=>i.stage!==5);
for(const s of shots){const i={id:D.id(),stage:5,title:s.title,sourceShot:{scriptId:script.id,title:s.title},variants:[]};p.items.push(i);D.addVariant(p,i.id,{kind:'image',assetId:D.id(),duration:5});D.approve(p,i.id);}
const old=p.items.find(i=>i.stage===6);D.addVariant(p,old.id,{kind:'audio',assetId:D.id(),duration:50});D.approve(p,old.id);
const plugin={name:'server-mock',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=f=>f;export const owner=async()=> 'owner';export const loadProject=async()=>globalThis.current;export const saveProject=async(_,p)=>{p.revision++;globalThis.current=p;return p};export const getKey=async()=>{if(globalThis.noKey)throw new Error('Missing key');return 'key';};`}));}};
await build({entryPoints:['app/api/projects/[id]/generate-speech/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/speech-plans/route.mjs',plugins:[plugin]});
const Q=await import('../work/tests/speech-plans/route.mjs');
const rows=S.speechPlans(p); assert.equal(rows.length,9); assert.equal(rows[1].offset,5);assert(!rows[0].dialogue.includes('ЗА КАДРОМ'));
const body={revision:p.revision,batchId:D.id(),model:'speech-2.8-hd',voiceId:'test-voice',estimate:'100',plans:rows.map(r=>({frameId:r.frameId,dialogue:r.dialogue}))};
const run=b=>Q.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify(b)}),{params:Promise.resolve({id:p.id})});
globalThis.current=structuredClone(p);
const queued=await(await run(body)).json();
assert.equal(queued.jobs.length,9);assert.equal(queued.speechMode,'plans');assert.deepEqual(queued.items.find(i=>i.id===old.id),JSON.parse(JSON.stringify(old)));assert.equal(queued.items.filter(i=>i.stage===6&&i.sourceShot).length,9);
assert.equal((await(await run(body)).json()).jobs.length,9);
for(const [n,j] of queued.jobs.entries()){assert.equal(j.kind,'audio');assert.equal(j.voiceId,'test-voice');assert.equal(j.offset,n*5);assert.equal(j.duration,5);assert.equal(j.dialogue,rows[n].dialogue);assert.equal(j.estimate,'100');assert.equal(j.status,'queued');}
for(const change of [{revision:-1},{model:'flux-2-pro'},{voiceId:''},{plans:[body.plans[0],body.plans[0]]},{plans:[{...body.plans[0],dialogue:'КАТЯ, ЗА КАДРОМ:'}]},{plans:[{...body.plans[0],frameId:D.id()}]}]){globalThis.current=structuredClone(p);await assert.rejects(()=>run({...body,...change}));assert.deepEqual(globalThis.current,p);}
globalThis.current=structuredClone(p);globalThis.current.limit='1';await assert.rejects(()=>run(body),/лимит/);assert.equal(globalThis.current.jobs.length,0);
globalThis.current=structuredClone(p);globalThis.noKey=true;await assert.rejects(()=>run(body),/Missing key/);assert.deepEqual(globalThis.current,p);globalThis.noKey=false;
const ready=structuredClone(queued);ready.jobs=[];
for(const i of ready.items.filter(i=>i.stage===6&&i.sourceShot)){D.addVariant(ready,i.id,{kind:'audio',assetId:D.id(),duration:5});D.approve(ready,i.id);}
assert.equal(R.editPlan(ready,true).audio.length,9);assert(!R.editPlan(ready,true).audio.some(a=>a.assetId===old.variants[0].assetId));
const frames=ready.items.filter(i=>i.stage===5), a=ready.items.indexOf(frames[0]),b=ready.items.indexOf(frames[1]);[ready.items[a],ready.items[b]]=[ready.items[b],ready.items[a]];
// Reordering requires director review under the existing dependency policy.
for(const i of ready.items.filter(i=>i.stage===6&&i.sourceShot)){D.addVariant(ready,i.id,{kind:'audio',assetId:D.chosen(i).assetId,duration:5});D.approve(ready,i.id);}
const plan=R.editPlan(ready,true);assert.equal(plan.audio.find(v=>v.title==='План 1').offset,5);assert.equal(plan.audio.find(v=>v.title==='План 2').offset,0);
assert.equal(R.fittedSpeechDuration({title:'План',trim:0,duration:5},3.2),3.2);assert.throws(()=>R.fittedSpeechDuration({title:'План',trim:0,duration:5},6.1),/Увеличьте длительность/);assert.throws(()=>R.fittedSpeechDuration({title:'План',trim:3,duration:5},2),/звучащий участок/);
const missing=structuredClone(ready);missing.items.find(i=>i.stage===6&&i.sourceShot).approvedId=undefined;assert.equal(R.editPlan(missing,true).audio.length,9,'Animatic previews the selected current voice before approval');
missing.items.find(i=>i.stage===6&&i.sourceShot).selectedId=undefined;assert.throws(()=>R.editPlan(missing,true),/Выберите аудиозапись/);
globalThis.current=structuredClone(ready);const blocked=globalThis.current.items.find(i=>i.stage===6&&i.sourceShot);globalThis.current.jobs.push({id:D.id(),itemId:blocked.id,status:'unknown',actual:null});await assert.rejects(()=>run({...body,revision:ready.revision,batchId:D.id()}),/неизвестным/);
console.log('PASS speech plans: atomic queue, one voice, timing from frames, director approvals, old narration excluded, reordered offsets, overlong speech protection, budgets and idempotency. No paid requests.');
