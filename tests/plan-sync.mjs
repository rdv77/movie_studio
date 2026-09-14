import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/storyboard.ts','lib/video.ts','lib/plan-sync.ts','lib/plan-speech.ts','lib/approval-blockers.ts','lib/speech.ts','lib/render.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/plan-sync',outExtension:{'.js':'.mjs'},external:['@ffmpeg/ffmpeg']});
const root='../work/tests/plan-sync/',D=await import(root+'domain.mjs'),S=await import(root+'storyboard.mjs'),V=await import(root+'video.mjs'),P=await import(root+'plan-sync.mjs'),B=await import(root+'approval-blockers.mjs'),A=await import(root+'speech.mjs'),R=await import(root+'render.mjs'),PS=await import(root+'plan-speech.mjs');
const p=D.newProject('11 планов после правок');
const durations=[6,4,4,5,4,5,6,4,4,4,4];
const shots=durations.map((duration,n)=>({title:`План ${String(n+1).padStart(2,'0')} — История ${n+1}`,duration,description:`Действие ${n+1}`,camera:'Наезд',continuity:'Склейка',speechType:'voiceover',speaker:'Катя',dialogue:`Рассказ ${n+1}`}));
for(const i of p.items.filter(i=>i.stage<=4)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
S.preparePlanCards(p);
const active=stage=>p.items.filter(i=>i.stage===stage&&D.participates(p,i));
const script=p.items.find(i=>i.stage===4),oldVersion=script.approvedId;
const originalFrames=active(5),frameIds=originalFrames.map(i=>i.id),videoIds=active(7).map(i=>i.id);
// Represent drafts saved by the earlier app, without the new provenance marker.
for(const i of originalFrames)delete D.chosen(i).planDraft;
const media=originalFrames[0];D.addVariant(p,media.id,{kind:'image',assetId:D.id(),jobId:D.id(),shotSource:oldVersion,speechType:'voiceover',speaker:'Катя',dialogue:shots[0].dialogue});
D.approve(p,media.id);
const imageBefore=structuredClone(D.chosen(media));
p.jobs.push({id:imageBefore.jobId,itemId:media.id,status:'done',actual:'500',deps:'original',refs:[]});
const manual=originalFrames[2];D.addVariant(p,manual.id,{...D.chosen(manual),id:undefined,text:'Авторская правка, которую нельзя потерять',planDraft:undefined});
const manualBefore=structuredClone(D.chosen(manual));
const edited=structuredClone(shots);
for(const [n,s] of edited.entries())s.title=`Кадр ${n+1}: Новое название ${n+1}`;
for(const n of [0,9]){edited[n].speechType='character';edited[n].speaker='Петя';edited[n].dialogue=`Я говорю ${n+1}`;}
D.addVariant(p,script.id,{text:JSON.stringify({shots:edited})});D.approve(p,script.id);
// Reproduce the old buggy migration: eleven additional exact-title cards plus a legacy extra = 23.
for(const shot of edited){const i={id:D.id(),stage:5,title:shot.title,sourceShot:{scriptId:script.id,title:shot.title},variants:[]};p.items.push(i);}
p.items.push({id:D.id(),stage:5,title:'Старый общий комикс',variants:[]});
assert.equal(active(5).length,23);
const duplicateState=structuredClone(p);
assert(P.planCardsNeedSync(p,5,V.scriptVideo(p)));
const jobsBefore=structuredClone(p.jobs);
assert(S.preparePlanCards(p));assert.equal(active(5).length,11);assert.equal(active(7).length,11);
assert.deepEqual(active(5).map(i=>i.id),frameIds);assert.deepEqual(active(7).map(i=>i.id),videoIds);
assert.equal(p.items.filter(i=>i.stage===5&&i.planArchive).length,12);
assert.deepEqual(D.chosen(media),imageBefore,'Paid image and original snapshot stay untouched');
assert.deepEqual(D.chosen(manual),manualBefore,'Manual descriptions stay untouched');
assert.deepEqual(p.jobs,jobsBefore,'All original job/cost records are retained');
const updated=D.chosen(originalFrames[9]);assert.equal(updated.speechType,'character');assert.equal(updated.speaker,'Петя');assert.equal(updated.dialogue,edited[9].dialogue);assert.equal(updated.shotSource,script.approvedId);
assert(originalFrames[9].variants.some(v=>v.shotSource===oldVersion&&v.speechType==='voiceover'),'Old draft remains in variant history');
assert.equal(PS.planSpeech(p,media,imageBefore).speechType,'character');assert.equal(S.planFields(p,media,imageBefore).dialogue,edited[0].dialogue);
assert.equal(S.storyboardBatchPlans(p).length,11);
assert(!P.planCardsNeedSync(p,5,V.scriptVideo(p)));const count=p.items.reduce((n,i)=>n+i.variants.length,0);assert(!S.preparePlanCards(p));assert.equal(p.items.reduce((n,i)=>n+i.variants.length,0),count);
for(const i of p.items.filter(i=>i.planArchive)){assert(!D.isApproved(p,i));assert(!B.approvalBlockers(p,6).some(b=>b.itemId===i.id));assert.throws(()=>D.approve(p,i.id),/истории/);assert.equal(V.videoShot(p,i),undefined);}
// Current media can be reviewed without archived duplicates blocking speech or the animatic.
for(const i of active(5)){const shot=V.videoShot(p,i);D.addVariant(p,i.id,{kind:'image',assetId:D.id(),shotSource:script.approvedId,...shot,text:shot.description});D.approve(p,i.id);}
assert(D.stageReady(p,6));assert.equal(A.speechPlans(p).length,11);assert.equal(A.speechPlans(p)[9].speechType,'character');
const audio=p.items.find(i=>i.stage===6&&!i.sourceShot);D.addVariant(p,audio.id,{kind:'audio',assetId:D.id(),duration:50});D.approve(p,audio.id);
assert.equal(R.editPlan(p,true).clips.length,11);
// Updating only speech, with no title changes, still refreshes system drafts.
const clean=D.newProject('Только речь');for(const i of clean.items.filter(i=>i.stage<=4)){D.addVariant(clean,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(clean,i.id);}S.preparePlanCards(clean);
const simpleSource=clean.items.find(i=>i.stage===4),sameTitles=structuredClone(shots);sameTitles[9].speechType='character';sameTitles[9].speaker='Петя';
D.addVariant(clean,simpleSource.id,{text:JSON.stringify({shots:sameTitles})});D.approve(clean,simpleSource.id);
assert(P.planCardsNeedSync(clean,5,V.scriptVideo(clean)));S.preparePlanCards(clean);assert.equal(clean.items.filter(i=>i.stage===5&&!i.planArchive).length,11);assert.equal(D.chosen(clean.items.filter(i=>i.stage===5&&!i.planArchive)[9]).speechType,'character');
// Never merge two distinct current plans which share a number.
const collision=structuredClone(clean);const cs=collision.items.find(i=>i.stage===4),sameNumber=structuredClone(shots);sameNumber[1].title='Кадр 01 — другой самостоятельный план';
D.addVariant(collision,cs.id,{text:JSON.stringify({shots:sameNumber})});D.approve(collision,cs.id);S.preparePlanCards(collision);const live=collision.items.filter(i=>i.stage===5&&!i.planArchive);assert.equal(live.length,11);assert.equal(new Set(live.map(i=>i.id)).size,11);assert(live.some(i=>i.sourceShot.title===sameNumber[1].title));
const running=structuredClone(clean);running.jobs.push({id:D.id(),itemId:running.items.find(i=>i.stage===5).id,status:'pending'});const snap=structuredClone(running);assert.throws(()=>S.preparePlanCards(running),/Дождитесь/);assert.deepEqual(running,snap);
// Insert a numbered shot: matching may follow unique titles, never the old ordinal.
const insertion=structuredClone(clean),insSource=insertion.items.find(i=>i.stage===4),insFrames=insertion.items.filter(i=>i.stage===5);
insFrames[0].variants.push(D.makeVariant(insertion,insFrames[0],{kind:'image',assetId:'media-A'}));insFrames[0].selectedId=insFrames[0].variants.at(-1).id;
const inserted=[{...shots[0],title:'План 01 — Новое вступление',description:'Совершенно новое действие'},...shots.map((s,n)=>({...s,title:`План ${n+2} — История ${n+1}`}))];
inserted[0].duration=2;inserted[1].duration-=2;
D.addVariant(insertion,insSource.id,{text:JSON.stringify({shots:inserted})});D.approve(insertion,insSource.id);S.preparePlanCards(insertion);
assert.equal(insertion.items.find(i=>i.stage===5&&!i.planArchive&&i.sourceShot.title===inserted[1].title).id,insFrames[0].id);
assert(!insertion.items.find(i=>i.stage===5&&!i.planArchive&&i.sourceShot.title===inserted[0].title).variants.some(v=>v.assetId),'New intro must not inherit the old first image');
// Exercise the real PATCH route against a 23-card persisted snapshot, including archive guards.
await build({entryPoints:['app/api/projects/[id]/route.ts','app/api/projects/[id]/generate/route.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/plan-sync-api',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'memory',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,rev)=>{if(rev!==state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const getKey=async()=> 'unused-test';export const asset=async(_,id)=>({id,mime:'image/png',size:100});`}));}}]});
const api=await import('../work/tests/plan-sync-api/app/api/projects/[id]/route.mjs'),G=await import('../work/tests/plan-sync-api/app/api/projects/[id]/generate/route.mjs');
globalThis.state=duplicateState;const ctx={params:Promise.resolve({id:state.id})},req=b=>new Request('http://localhost',{method:'PATCH',body:JSON.stringify(b)});
let response=await api.PATCH(req({revision:state.revision,action:'prepareShots'}),ctx);assert.equal(response.status,200);assert.equal(state.items.filter(i=>i.stage===5&&!i.planArchive).length,11);
const archived=state.items.find(i=>i.planArchive);
response=await api.PATCH(req({revision:state.revision,action:'approve',itemId:archived.id}),ctx);assert.equal(response.status,400);
response=await G.POST(req({revision:state.revision,batchId:D.id(),itemId:archived.id,models:['flux-2-pro'],count:1,prompt:'Do not send',refs:[],dialogue:'',voiceId:'',estimates:{}}),ctx);assert.equal(response.status,400);assert.deepEqual(state.jobs,duplicateState.jobs);
console.log('PASS plan sync: 23 to 11 cards, stable media IDs, renamed plans, current character speech, immutable manual edits and receipts, idempotency, archived blockers/render exclusion, ambiguous numbers and in-flight protection. No paid calls.');
