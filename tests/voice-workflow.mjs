import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-user')!=='owner')throw Object.assign(new Error('Unauthorized'),{status:401});return 'owner'};
export const loadProject=async(user,id)=>{if(id!==state.id)throw new Error('Not found');return structuredClone(state)};
export const saveProject=async(user,p,revision)=>{if(revision!==state.revision)throw new Error('revision');if(globalThis.failAttach&&p.voiceComparisons?.some(c=>c.samples.some(s=>s.assetId&&!state.voiceComparisons?.flatMap(c=>c.samples).find(x=>x.jobId===s.jobId)?.assetId))){globalThis.failAttach=false;throw new Error('Storage unavailable after audio save')};p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(user,id,fn)=>{const p=await loadProject(user,id);fn(p);return saveProject(user,p,p.revision)};
export const getKey=async(user,provider)=>{if(globalThis.noKey===provider)throw new Error('Missing key');return 'fake-test'};
export const asset=async(user,id)=>{if(!assets.has(id))throw new Error('Foreign asset');return assets.get(id)};
export const storeAsset=async(user,id,name,mime,bytes)=>{assets.set(id,{id,name,mime,size:bytes.byteLength});return id};
export const imageData=async()=>{throw new Error('Unexpected image request')};export const runtime={FILES:{head:async id=>assets.get(id)}};
`;
await build({stdin:{resolveDir:process.cwd(),contents:`
 export * as D from './lib/domain';export * as A from './lib/animatic';export * as W from './lib/workflow';export * as R from './lib/render';
 export {characterRemovalReason} from './lib/character-removal';
 export {POST as compare} from './app/api/projects/[id]/generate-voice-tests/route';
 export {POST as tick} from './app/api/projects/[id]/jobs/[jobId]/route';
 export {PATCH as patch} from './app/api/projects/[id]/route';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/voice-workflow.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'runtime',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onResolve({filter:/^@\/lib\/providers$/},()=>({path:'providers',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='server'?mock:`
 export class ProviderError extends Error{constructor(message,definite,notSent){super(message);this.definite=definite;this.notSent=notSent}};
 export const generate=async j=>{globalThis.providerCalls.push(structuredClone(j));if(globalThis.providerFailure)throw new Error('Uncertain network result');return {bytes:new Uint8Array([1,2,3]),mime:'audio/mpeg',actual:'15'}};
 export const poll=async()=>{throw new Error('Unexpected polling')};export const retrieve=async()=>{throw new Error('Unexpected retrieval')};
 `}));
}}]});
const {D,A,W,R,compare,tick,patch,characterRemovalReason}=await import('../work/tests/voice-workflow.mjs');
function fixture(){
 const p=D.newProject('Раздельная озвучка');p.speechMode='plans';
 const shots=Array.from({length:10},(_,n)=>({title:'План '+n,description:'У моря',duration:5,camera:'Наезд',continuity:'Склейка',dialogue:'Привет, мир!',speechType:'voiceover',speaker:'Катя'}));
 for(const i of p.items.filter(i=>i.stage<5)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
 p.items=p.items.filter(i=>![5,7].includes(i.stage));const scriptId=p.items.find(i=>i.stage===4).id;
 for(const stage of [5,6,7])for(const shot of shots){const i={id:D.id(),stage,title:shot.title,sourceShot:{scriptId,title:shot.title},variants:[]};p.items.push(i);D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:5,text:'Вариант',dialogue:shot.dialogue,voiceId:'old'});D.approve(p,i.id);}
 return p;
}
const p=fixture(),track=p.items.find(i=>i.stage===6&&!i.sourceShot),voice=p.items.find(i=>i.stage===6&&i.sourceShot);
D.addAnimatic(p,track.id,{kind:'video',assetId:D.id(),duration:50});
assert(!p.items.filter(i=>i.stage===6).every(i=>D.isApproved(p,i)),'Reproduce the previous misleading unfinished-stage indicator');
assert(W.stageComplete(p,6));assert(D.stageReady(p,7));assert.equal(W.nextStage(6),9);assert.equal(W.nextStage(9),7);
const before=structuredClone(p.items),basis=A.animaticBasis(p),v=A.saveAnimatic(p,{kind:'video',assetId:D.id(),duration:50},basis);
assert.deepEqual(p.items,before,'Saving a separate animatic never changes voice selections or approvals');
A.approveAnimatic(p,v.id);assert(W.stageComplete(p,9));assert.equal(D.dependencies(p,7),D.dependencies({...p,animatic:undefined},7),'Animatic approval does not stale paid video');
const approved=structuredClone(p);
const newer=D.addVariant(p,voice.id,{kind:'audio',assetId:D.id(),duration:5,dialogue:'Привет, мир!',voiceId:'new'});
assert(!W.stageComplete(p,6),'An unapproved selected replacement is not a completed voice stage');
assert.equal(R.editPlan(p,true).audio[0].id,newer.id);assert(!A.animaticApproved(p));assert.throws(()=>A.approveAnimatic(p,v.id),/изменились/);
const preview=A.saveAnimatic(p,{kind:'video',assetId:D.id(),duration:50},A.animaticBasis(p));
assert.throws(()=>A.approveAnimatic(p,preview.id),/утвердите выбранные реплики/);D.approve(p,voice.id);A.approveAnimatic(p,preview.id);assert(A.animaticApproved(p));
for(const change of [p=>D.chosen(p.items.find(i=>i.id===voice.id)).volume=0.5,p=>D.chosen(p.items.find(i=>i.id===voice.id)).trim=0.1,p=>p.configVersion++,p=>p.format='9:16',p=>p.items.find(i=>i.stage===5).variants[0].duration=5.1]){const changed=structuredClone(approved);change(changed);assert(!A.animaticApproved(changed));}
assert.throws(()=>A.saveAnimatic(p,{kind:'video',assetId:D.id()},basis),/Источники изменились/);
assert.match(A.animaticIssue(p,track.variants[0]),/прежний просмотр/);
const silent=fixture();silent.items=silent.items.filter(i=>!(i.stage===6&&i.sourceShot));
const script=D.chosen(silent.items.find(i=>i.stage===4)),data=JSON.parse(script.text);for(const shot of data.shots){shot.dialogue='';shot.speechType='none';}script.text=JSON.stringify(data);
assert(D.silentFilm(silent));assert(W.stageComplete(silent,6));assert(D.stageReady(silent,7));
const silentPreview=A.saveAnimatic(silent,{kind:'video',assetId:D.id(),duration:50},A.animaticBasis(silent));A.approveAnimatic(silent,silentPreview.id);assert(A.animaticApproved(silent));
silent.speechMode='track';assert(W.stageComplete(silent,6),'Silent track mode ignores an empty placeholder');
globalThis.state=D.newProject('Пробы до утверждения сценария');globalThis.assets=new Map();globalThis.providerCalls=[];
const ctx=()=>({params:Promise.resolve({id:state.id})}),req=(b,user='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'test-user':user},body:JSON.stringify(b)});
const pairs=[{model:'speech-2.8-hd',voiceId:'Russian_A',name:'Голос A',estimate:'20'},{model:'eleven_v3',voiceId:'voice_B',name:'Голос B',estimate:'20'}];
const body={revision:state.revision,batchId:D.id(),phrase:'КАТЯ: Эту фразу читают одинаково.',voices:pairs},clean=structuredClone(state);
const response=await compare(req(body),ctx());assert.equal(response.status,200,await response.clone().text());
assert.equal(state.jobs.length,2);assert.deepEqual(state.items,clean.items);assert.equal(state.speechMode,clean.speechMode);assert.equal(D.dependencies(state,7),D.dependencies(clean,7));
assert.equal(D.totals(state).reserved,'40');assert.equal(state.voiceComparisons.length,1);
assert.equal((await compare(req(body),ctx())).status,200);assert.equal(state.jobs.length,2,'Same comparison request is deduplicated');
assert.equal(characterRemovalReason(state,state.items[1].id),'','Voice tests do not depend on characters');
for(const job of state.jobs){const jobCtx={params:Promise.resolve({id:state.id,jobId:job.id})};assert.equal((await tick(req({}),jobCtx)).status,200);assert.equal((await tick(req({}),jobCtx)).status,200);}
assert.equal(providerCalls.length,2,'Completed attempts cannot trigger paid repeats');assert(providerCalls.every(j=>j.dialogue===body.phrase),'Frozen phrase is not changed by character-name stripping');
assert(state.voiceComparisons[0].samples.every(s=>s.assetId));assert.deepEqual(state.items,clean.items);assert.equal(D.totals(state).actual,'30');
const patchAction=async(action,data)=>patch(req({revision:state.revision,action,data}),ctx());
assert.equal((await patchAction('chooseVoiceTest',{jobId:state.jobs[1].id})).status,200);assert.equal(state.preferredVoice.model,'eleven_v3');assert.equal(state.preferredVoice.voiceId,'voice_B');assert.deepEqual(state.items,clean.items);
assert.equal((await patchAction('removeVoiceComparison',{comparisonId:state.voiceComparisons[0].id})).status,200);assert(state.voiceComparisons[0].removedAt);assert.equal(D.totals(state).actual,'30');
assert.equal((await patchAction('restoreVoiceComparison',{comparisonId:state.voiceComparisons[0].id})).status,200);assert(!state.voiceComparisons[0].removedAt);
for(const change of [{voices:[pairs[0],pairs[0]]},{voices:[{...pairs[0],model:'flux-2-pro'}]},{phrase:' '},{phrase:'x'.repeat(501)},{revision:-1}]){
 const saved=structuredClone(state);const r=await compare(req({...body,revision:state.revision,batchId:D.id(),...change}),ctx());assert.equal(r.status,400);assert.deepEqual(state,saved);
}
let r=await compare(req({...body,revision:state.revision,batchId:D.id()},'other'),ctx());assert.equal(r.status,401);
state.limit='31';r=await compare(req({...body,revision:state.revision,batchId:D.id()}),ctx());assert.equal(r.status,400);assert.match((await r.json()).error,/лимит/);state.limit=null;
globalThis.noKey='elevenlabs';const saved=structuredClone(state);r=await compare(req({...body,revision:state.revision,batchId:D.id()}),ctx());assert.equal(r.status,400);assert.deepEqual(state,saved);globalThis.noKey=undefined;
r=await compare(req({...body,revision:state.revision,batchId:D.id(),voices:[pairs[0]]}),ctx());assert.equal(r.status,200);const job=state.jobs.at(-1);globalThis.providerFailure=true;
await tick(req({}),{params:Promise.resolve({id:state.id,jobId:job.id})});assert.equal(state.jobs.at(-1).status,'unknown');const count=providerCalls.length;
await tick(req({}),{params:Promise.resolve({id:state.id,jobId:job.id})});assert.equal(providerCalls.length,count,'Uncertain TTS must never resend automatically');globalThis.providerFailure=false;
r=await compare(req({...body,revision:state.revision,batchId:D.id(),voices:[pairs[0]]}),ctx());assert.equal(r.status,200);const recoveryJob=state.jobs.at(-1);globalThis.failAttach=true;
await tick(req({}),{params:Promise.resolve({id:state.id,jobId:recoveryJob.id})});assert.equal(state.jobs.at(-1).status,'unknown');assert(assets.has(recoveryJob.id));const beforeRecovery=providerCalls.length;
r=await tick(req({action:'recover-voice-file'}),{params:Promise.resolve({id:state.id,jobId:recoveryJob.id})});assert.equal(r.status,200);assert.equal(state.jobs.at(-1).status,'done');assert.equal(state.voiceComparisons.at(-1).samples[0].assetId,recoveryJob.id);assert.equal(providerCalls.length,beforeRecovery,'Recovery attaches the stored paid file without TTS');
r=await tick(req({action:'recover-voice-file'}),{params:Promise.resolve({id:state.id,jobId:job.id})});assert.equal(r.status,400);assert.equal(providerCalls.length,beforeRecovery,'Missing saved file does not cause a new generation');
globalThis.state=structuredClone(approved);const videoId=D.id();assets.set(videoId,{id:videoId,mime:'video/mp4'});
r=await patchAction('saveAnimaticPreview',{title:'Новый просмотр',text:'',kind:'video',assetId:videoId,duration:64.17,basis:A.animaticBasis(state)});assert.equal(r.status,200,await r.clone().text());
assert.equal(state.animatic.variants.at(-1).duration,64.17);
const newId=state.animatic.selectedId;assert.equal((await patchAction('approveAnimatic',{variantId:newId})).status,200);assert(A.animaticApproved(state));
assert.equal((await patchAction('deleteAnimatic',{variantId:newId})).status,200);assert(!A.animaticApproved(state));assert.equal((await patchAction('restoreAnimatic',{variantId:newId})).status,200);assert(!A.animaticApproved(state),'Restore does not silently approve');
const finalItem=state.items.find(i=>i.stage===8);
r=await patch(req({revision:state.revision,action:'addVariant',itemId:finalItem.id,data:{title:'Фильм',text:'',kind:'video',assetId:videoId,duration:64.17}}),ctx());
assert.equal(r.status,200,await r.clone().text());assert.equal(state.items.find(i=>i.id===finalItem.id).variants.at(-1).duration,64.17);
console.log('PASS voice workflow: active speech completion, separate animatic approval/source snapshots, legacy MP4 preservation, new selected voices, stale render protection, 2-provider voice comparison, immutable phrase, no film mutations, budget and auth validation, deduplication, uncertain-request safety, preferences and reversible deletion. No paid calls.');
