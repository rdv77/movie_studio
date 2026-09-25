import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/render';export * as A from './lib/animatic';export * as V from './lib/video';export * as S from './lib/storyboard';export * as P from './lib/plan-sync';export * as Speech from './lib/speech';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/plan-removal.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,revision)=>{if(state.revision!==revision)throw Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const asset=async()=>({mime:'video/mp4'});`}));}}]});
const {D,R,A,V,S,P,Speech,PATCH}=await import('../work/tests/plan-removal.mjs');
const p=D.newProject('Удаление планов');p.seconds=15;p.speechMode='plans';
const shots=Array.from({length:3},(_,n)=>({title:`План ${n+1} — История ${n+1}`,description:'Действие '+n,duration:5,camera:'Наезд',continuity:'Склейка',dialogue:n===1?'Реплика удаляемой сцены':'',speechType:n===1?'voiceover':'none'}));
for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
p.items=p.items.filter(i=>![5,6,7].includes(i.stage));const script=p.items.find(i=>i.stage===4);
for(const stage of [5,6,7])for(const [n,shot] of shots.entries()){
 if(stage===6&&n!==1)continue;
 const i={id:D.id(),stage,title:shot.title,sourceShot:{scriptId:script.id,title:shot.title,key:P.planKey(shot.title),scriptVersion:script.approvedId},variants:[]};p.items.push(i);
 D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:5,dialogue:shot.dialogue,speechType:shot.speechType,text:shot.description,shotSource:script.approvedId});D.approve(p,i.id);
}
const frames=p.items.filter(i=>i.stage===5),videos=p.items.filter(i=>i.stage===7);
p.assemblyCuts=[{itemId:videos[1].id,variantId:videos[1].approvedId,trim:0,duration:4}];p.captions=[{planId:frames[1].id,text:'Сохранённый титр',enabled:true}];
const initialAssets=p.items.flatMap(i=>i.variants.map(v=>[i.id,v.id,v.assetId]));const basis=A.animaticBasis(p),finalBasis=D.dependencies(p,8);
globalThis.state=structuredClone(p);
const patch=(action,itemId=frames[1].id,data,revision=state.revision)=>PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify({action,itemId,data,revision})}),{params:Promise.resolve({id:p.id})});
await patch('removePlan',videos[1].id);
for(const stage of [5,7])assert.deepEqual(state.items.filter(i=>i.stage===stage&&D.participates(state,i)).map(i=>i.title),[shots[0].title,shots[2].title]);
assert.equal(state.items.filter(i=>i.stage===6&&D.participates(state,i)).length,0);
assert(D.silentFilm(state));assert.equal(Speech.speechPlans(state).length,0);assert.equal(Speech.scriptSpeech(state).sources.length,0);
assert.equal(R.editPlan(state,true).clips.length,2);assert.equal(R.editPlan(state,false).audio.length,0);
assert.notEqual(A.animaticBasis(state),basis);assert.notEqual(D.dependencies(state,8),finalBasis);
assert(state.items.filter(i=>[5,7].includes(i.stage)&&D.participates(state,i)).every(i=>D.isApproved(state,i)));
assert.deepEqual(state.items.flatMap(i=>i.variants.map(v=>[i.id,v.id,v.assetId])),initialAssets);
const count=state.items.length;S.preparePlanCards(state);assert.equal(state.items.length,count);assert.equal(V.scriptVideo(state).shots.length,2);assert.equal(state.items.find(i=>i.id===frames[1].id).planArchive.reason,'excluded');
assert(!P.planCardsNeedSync(state,5,V.scriptVideo(state)));
await patch('saveAssemblyCuts','',{cuts:[]});assert.deepEqual(state.assemblyCuts,p.assemblyCuts);
await patch('restorePlan');assert.equal(R.editPlan(state,false).clips.length,3);assert.equal(R.editPlan(state,false).audio.length,1);assert.deepEqual(state.captions,p.captions);
assert(state.items.filter(i=>[5,6,7].includes(i.stage)).every(i=>D.isApproved(state,i)));
await assert.rejects(()=>patch('restorePlan'));await assert.rejects(()=>patch('removePlan',D.id()));await assert.rejects(()=>patch('removePlan',script.id));await assert.rejects(()=>patch('removePlan',frames[1].id,undefined,state.revision-1));
globalThis.denied=true;await assert.rejects(()=>patch('removePlan'),/Unauthorized/);globalThis.denied=false;
state.jobs.push({id:D.id(),status:'pending'});const busy=structuredClone(state);await assert.rejects(()=>patch('removePlan'),/Дождитесь/);assert.deepEqual(state,busy);state.jobs=[];
// Renaming through script reconciliation keeps the removal and paid media.
await patch('removePlan');const renamed=shots.map((s,n)=>({...s,title:`Кадр ${n+1}: Новое название ${n+1}`}));
D.addVariant(state,script.id,{text:JSON.stringify({shots:renamed})});D.approve(state,script.id);S.preparePlanCards(state);
assert.equal(state.items.find(i=>i.id===frames[1].id).sourceShot.title,renamed[1].title);
assert.equal(state.items.find(i=>i.id===frames[1].id).planArchive.reason,'excluded');assert.equal(V.scriptVideo(state).shots.length,2);
await patch('restorePlan');assert(!D.isApproved(state,state.items.find(i=>i.id===frames[1].id)),'Restoration does not revive a stale image after a script edit');
console.log('PASS plan removal: linked exclusion/restore, media retained, no resurrection during sync/rename, silent-film assembly, remaining approvals, montage settings, stale protection and API auth/revision.');
