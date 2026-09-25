import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`
 export * as D from './lib/domain';export * as S from './lib/speech-approval';export * as B from './lib/bulk-approval';
 export * as W from './lib/workflow';export * as V from './lib/video-approval';export {approvalBlockers} from './lib/approval-blockers';
 export {PATCH} from './app/api/projects/[id]/route';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/speech-approval.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`
 export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
 export const owner=async req=>{if(req.headers.get('test-user')!=='owner')throw Object.assign(new Error('Unauthorized'),{status:401});return 'owner'};
 export const loadProject=async(_,id)=>{if(id!==state.id)throw Object.assign(new Error('Not found'),{status:404});return structuredClone(state)};
 export const saveProject=async(_,p,revision)=>{if(state.revision!==revision)throw new Error('Conflict');p.revision++;globalThis.state=structuredClone(p);return p};
 export const asset=async(_,id)=>{if(!assets.has(id))throw new Error('Foreign asset');return assets.get(id)};
 `}));
}}]});
const {D,S,B,W,V,approvalBlockers,PATCH}=await import('../work/tests/speech-approval.mjs');
const p=D.newProject('Планы 5 и 10');p.speechMode='plans';
const shots=Array.from({length:11},(_,n)=>({title:'План '+(n+1),description:'На берегу моря',duration:n===0?5:4.5,camera:'Наезд',continuity:'Склейка',dialogue:'Мы снова встретились у моря.',speechType:'voiceover',speaker:'Катя'}));
for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
const scriptId=p.items[4].id;p.items=p.items.filter(i=>![5,7].includes(i.stage));
for(const stage of [5,6,7])for(const shot of shots){
 const i={id:D.id(),stage,title:shot.title,sourceShot:{scriptId,title:shot.title},variants:[]};p.items.push(i);
 D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:shot.duration,dialogue:shot.dialogue,speechType:'voiceover',speaker:'Катя',voiceId:'Russian_Warm',text:'Сохранённая запись',trim:0.1,volume:0.8});D.approve(p,i.id);
}
const voices=p.items.filter(i=>i.stage===6&&i.sourceShot),fifth=voices[4],tenth=voices[9],frame=p.items.find(i=>i.stage===5);
const oldBasis=D.dependencies(p,6),fifthBefore=structuredClone(D.chosen(fifth));
// A real upstream image replacement makes the existing audio approvals stale.
D.addVariant(p,frame.id,{...D.chosen(frame),id:D.id(),assetId:D.id()});D.approve(p,frame.id);
for(const i of voices.filter(i=>![fifth.id,tenth.id].includes(i.id))){D.addVariant(p,i.id,{...D.chosen(i),id:D.id(),deps:D.dependencies(p,6)});D.approve(p,i.id);}
const otherTenth=D.makeVariant(p,tenth,{...D.chosen(tenth),id:D.id(),assetId:D.id(),deps:oldBasis,voiceId:'another-voice'});tenth.variants.push(otherTenth);tenth.selectedId=otherTenth.id;
p.jobs.push({id:D.id(),itemId:fifth.id,kind:'audio',model:'speech-2.8-hd',voiceId:fifthBefore.voiceId,status:'done',actual:'1234',deps:oldBasis,prompt:'Исходная реплика',refs:[]});
const baseline=structuredClone(p),jobsBefore=structuredClone(p.jobs),videosBefore=structuredClone(p.items.filter(i=>i.stage===7));
assert.equal(fifth.selectedId,fifth.approvedId);assert(!D.isApproved(p,fifth));assert.notEqual(tenth.selectedId,tenth.approvedId);
assert.equal(S.speechReapprovalReason(p,fifth.id,fifth.selectedId),'');assert.equal(S.speechReapprovalReason(p,tenth.id,tenth.selectedId),'');
assert.throws(()=>D.approve(p,fifth.id),/Основа изменилась/,'Reproduce disabled ordinary approval');
assert.equal(B.approvalBatch(p,6).find(r=>r.itemId===fifth.id).reason,'');
assert.match(B.approvalBatch(p,6).find(r=>r.itemId===tenth.id).reason,/новый выбор/);
assert(approvalBlockers(p,7).filter(r=>r.stage===6).every(r=>r.reason.includes('Утвердить эту запись')));
S.reapproveSpeech(p,fifth.id,fifth.selectedId);assert(D.isApproved(p,fifth));assert(!D.stageReady(p,7));
assert.deepEqual(D.chosen(fifth),{...fifthBefore,deps:D.dependencies(p,6)});assert.equal(fifth.variants.length,1,'No duplicate recording');
S.reapproveSpeech(p,tenth.id,tenth.selectedId);assert(D.stageReady(p,7));assert(W.stageComplete(p,6));assert.equal(tenth.approvedId,otherTenth.id);
assert.deepEqual(p.jobs,jobsBefore);assert.deepEqual(p.items.filter(i=>i.stage===7),videosBefore,'Downstream approval records are not silently rewritten');
assert.equal(D.totals(p).actual,'1234');
const synced=p.items.find(i=>i.stage===7&&i.title===tenth.title);D.chosen(synced).lipsync={videoVariantId:D.id(),audioItemId:tenth.id,audioVariantId:baseline.items.find(i=>i.id===tenth.id).approvedId};D.chosen(synced).trim=0;
assert.match(V.videoReapprovalReason(p,synced.id,synced.selectedId),/Реплика этого ролика изменилась/);
for(const mutate of [
 p=>p.speechMode='track',p=>p.items.find(i=>i.id===fifth.id).planArchive={reason:'duplicate'},p=>p.items.find(i=>i.id===fifth.id).removedAt=D.now(),
 p=>p.items.find(i=>i.id===fifth.id).selectedId=undefined,p=>D.chosen(p.items.find(i=>i.id===fifth.id)).kind='video',p=>D.chosen(p.items.find(i=>i.id===fifth.id)).assetId=undefined,
 p=>p.items.find(i=>i.stage===5).approvedId=undefined,p=>p.jobs.push({id:D.id(),itemId:tenth.id,status:'pending'}),
 p=>Object.assign(D.chosen(p.items.find(i=>i.id===fifth.id)),{speechType:'character',speaker:''}),
 p=>Object.assign(D.chosen(p.items.find(i=>i.id===fifth.id)),{speechType:'character',speaker:'Катя',dialogue:'КАТЯ:'}),
]){const bad=structuredClone(baseline);mutate(bad);const before=structuredClone(bad);assert.throws(()=>S.reapproveSpeech(bad,fifth.id,fifthBefore.id));assert.deepEqual(bad,before);}
const legacy=structuredClone(baseline),legacyVoice=D.chosen(legacy.items.find(i=>i.id===fifth.id));delete legacyVoice.speechType;delete legacyVoice.speaker;legacyVoice.dialogue='';legacyVoice.text='';S.reapproveSpeech(legacy,fifth.id,legacyVoice.id);assert(D.isApproved(legacy,legacy.items.find(i=>i.id===fifth.id)),'Old uploaded audio is not forced to acquire invented text');
globalThis.state=structuredClone(baseline);globalThis.assets=new Map(state.items.flatMap(i=>i.variants).filter(v=>v.assetId).map(v=>[v.assetId,{id:v.assetId,mime:v.kind+'/mpeg'}]));
const body={revision:state.revision,action:'reapproveSpeech',itemId:fifth.id,data:{variantId:fifthBefore.id}};
async function request(b=body,user='owner',projectId=state.id){return PATCH(new Request('https://site.test/api',{method:'PATCH',headers:{'test-user':user},body:JSON.stringify(b)}),{params:Promise.resolve({id:projectId})});}
for(const [data,user,pid,status] of [[body,'other',state.id,401],[{...body,revision:-1},'owner',state.id,400],[{...body,data:{variantId:D.id()}},'owner',state.id,400],[body,'owner',D.id(),404]]){const before=structuredClone(state),r=await request(data,user,pid);assert.equal(r.status,status);assert.deepEqual(state,before);}
assets.set(fifthBefore.assetId,{id:fifthBefore.assetId,mime:'video/mp4'});let r=await request();assert.equal(r.status,400);assets.delete(fifthBefore.assetId);r=await request();assert.equal(r.status,400);assert.deepEqual(state,baseline);
assets.set(fifthBefore.assetId,{id:fifthBefore.assetId,mime:'audio/mpeg'});r=await request();assert.equal(r.status,200,await r.clone().text());assert(D.isApproved(state,state.items.find(i=>i.id===fifth.id)));assert.equal(state.revision,baseline.revision+1);
const after=structuredClone(state);r=await request({...body,revision:state.revision});assert.equal(r.status,400);assert.deepEqual(state,after,'Already-current audio follows the normal approval path');
const ordinary=state.items.find(i=>i.id===fifth.id);D.addVariant(state,ordinary.id,{kind:'audio',assetId:fifthBefore.assetId,dialogue:'Новая запись'});assert.match(S.speechReapprovalReason(state,ordinary.id,ordinary.selectedId),/обычное утверждение/);D.approve(state,ordinary.id);assert(D.isApproved(state,ordinary));
console.log('PASS speech reapproval: stale plans 5/10 with same and changed selected IDs, same-card approval, preserved file/words/speaker/timing/history/costs, inactive/archive/metadata/job guards, API ownership/MIME/revision validation and obsolete lipsync protection. No paid calls.');

const batch=structuredClone(baseline);
for(const i of batch.items.filter(i=>i.stage===6&&i.sourceShot)){i.selectedId=i.approvedId;D.chosen(i).deps=oldBasis;}
const selections=x=>B.approvalBatch(x,6).filter(r=>!r.reason).map(({itemId,variantId})=>({itemId,variantId}));
assert.equal(selections(batch).length,11);
const batchOriginal=structuredClone(batch),oldVideos=structuredClone(batch.items.filter(i=>i.stage===7));
B.approveBatch(batch,6,selections(batch));assert(W.stageComplete(batch,6));
assert.deepEqual(batch.items.filter(i=>i.stage===7),oldVideos);assert.deepEqual(batch.jobs,batchOriginal.jobs);
for(const i of batch.items.filter(i=>i.stage===6&&i.sourceShot)){
 const prev=batchOriginal.items.find(x=>x.id===i.id);assert.equal(i.variants.length,prev.variants.length);
 assert.deepEqual(D.chosen(i),{...D.chosen(prev),deps:D.dependencies(batch,6)});
}
// Scenario changes are checked independently from image overrides and from
// the old audio text which the speech editor intentionally preserves.
for(const patch of [s=>s.dialogue='Другая реплика',s=>s.speaker='Петя',s=>s.speechType='character',s=>s.duration=5]){
 const x=structuredClone(batchOriginal),script=x.items.find(i=>i.stage===4),data=JSON.parse(D.chosen(script).text);patch(data.shots[4]);
 if(data.shots[4].duration===5)data.shots[3].duration=4;
 D.addVariant(x,script.id,{text:JSON.stringify(data)});D.approve(x,script.id);
 for(const frame of x.items.filter(i=>i.stage===5))D.chosen(frame).deps=D.dependencies(x,5);
 assert(D.stageReady(x,6));assert(!selections(x).some(s=>s.itemId===fifth.id));
}
const imageChange=structuredClone(batchOriginal),fifthFrame=imageChange.items.find(i=>i.stage===5&&i.title===fifth.title);
D.addVariant(imageChange,fifthFrame.id,{...D.chosen(fifthFrame),id:D.id(),dialogue:'Новый текст из раскадровки'});D.approve(imageChange,fifthFrame.id);
assert(!selections(imageChange).some(s=>s.itemId===fifth.id));
// Two script revisions with identical spoken content remain bulk-approvable.
const cosmetic=structuredClone(batchOriginal),cosmeticScript=cosmetic.items.find(i=>i.stage===4),cosmeticData=JSON.parse(D.chosen(cosmeticScript).text);cosmeticData.shots[0].camera='Новая камера';
D.addVariant(cosmetic,cosmeticScript.id,{text:JSON.stringify(cosmeticData)});D.approve(cosmetic,cosmeticScript.id);
for(const frame of cosmetic.items.filter(i=>i.stage===5))D.chosen(frame).deps=D.dependencies(cosmetic,5);
assert.equal(selections(cosmetic).length,11);
for(const mutate of [x=>x.configVersion++,x=>x.jobs.push({status:'saving'}),x=>D.getItem(x,fifth.id).approvedId=undefined,x=>D.getItem(x,fifth.id).sourceShot.title='Missing',x=>D.getItem(x,fifth.id).sourceShot=undefined]){
 const x=structuredClone(batchOriginal);mutate(x);assert(!selections(x).some(s=>s.itemId===fifth.id));
}
const mixed=structuredClone(imageChange),snapshot=structuredClone(mixed);
assert.throws(()=>B.approveBatch(mixed,6,selections(batchOriginal)));assert.deepEqual(mixed,snapshot);
globalThis.state=structuredClone(batchOriginal);
const batchBody={revision:state.revision,action:'approveBatch',data:{stage:6,selections:selections(state)}};
assets.delete(fifthBefore.assetId);r=await request(batchBody);assert.equal(r.status,400);assert.deepEqual(state,batchOriginal);
assets.set(fifthBefore.assetId,{mime:'audio/mpeg'});r=await request(batchBody,'other');assert.equal(r.status,401);assert.deepEqual(state,batchOriginal);
r=await request(batchBody);assert.equal(r.status,200,await r.clone().text());assert(W.stageComplete(state,6));
const savedBatch=structuredClone(state);r=await request(batchBody);assert.equal(r.status,400);assert.deepEqual(state,savedBatch);
console.log('PASS bulk speech reapproval: all 11 unchanged voices, changed dialogue/speaker/type/duration excluded, no duplicate files, atomic approval and API permission/media/revision guards.');
