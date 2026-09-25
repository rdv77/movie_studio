import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/render.ts','lib/bulk-approval.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/selected-speech',outExtension:{'.js':'.mjs'},external:['@ffmpeg/ffmpeg']});
const D=await import('../work/tests/selected-speech/domain.mjs'), R=await import('../work/tests/selected-speech/render.mjs'),B=await import('../work/tests/selected-speech/bulk-approval.mjs');
const p=D.newProject('Voice choice');p.speechMode='plans';
const shots=Array.from({length:10},(_,n)=>({title:`Plan ${n}`,description:'Scene',duration:5,camera:'Still',continuity:'Cut',dialogue:'Hello'}));
for(const item of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,item.id,{text:item.stage===4?JSON.stringify({shots}):'Base'});D.approve(p,item.id)}
const scriptId=p.items[4].id;p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
for(const stage of [5,6,7])for(const shot of shots){
 const item={id:D.id(),stage,title:shot.title,sourceShot:{scriptId,title:shot.title},variants:[]};p.items.push(item);
 D.addVariant(p,item.id,{text:'Old',kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:5,model:stage===6?'minimax':'manual'});D.approve(p,item.id);
}
const voices=p.items.filter(i=>i.stage===6), oldIds=voices.map(i=>i.approvedId);
for(const item of voices)D.addVariant(p,item.id,{text:'New voice',kind:'audio',assetId:D.id(),duration:5,model:'eleven_v3',voiceId:'new'});
const before=structuredClone(p),plan=R.editPlan(p,true);
assert.deepEqual(plan.audio.map(v=>v.id),voices.map(i=>i.selectedId));assert(plan.audio.every(v=>v.model==='eleven_v3'));
assert.deepEqual(plan.audioClipIndexes,[0,1,2,3,4,5,6,7,8,9]);assert.deepEqual(p,before,'Preview never approves a new voice');
assert.throws(()=>R.editPlan(p,false),/выбран новый голос/);
const fit=R.fitPlanToSpeech(plan,[5.1,4.6,4,4,4,4,4,4,4,4]);assert.equal(fit.audio[1].offset,5.125);assert.equal(fit.seconds,50.125);
const changes=B.changedSpeechSelections(p).map(i=>({itemId:i.id,variantId:i.selectedId}));assert.equal(changes.length,10);
const stale=structuredClone(p);D.chosen(stale.items.find(i=>i.id===voices[9].id)).deps='old';
const staleBefore=structuredClone(stale);assert.throws(()=>B.approveSelectedSpeech(stale,changes),/Основа изменилась/);assert.deepEqual(stale,staleBefore);
B.approveSelectedSpeech(p,changes);assert.deepEqual(voices.map(i=>i.approvedId),voices.map(i=>i.selectedId));assert.notDeepEqual(voices.map(i=>i.approvedId),oldIds);
assert.equal(B.changedSpeechSelections(p).length,0);assert.throws(()=>R.editPlan(p,false),/Утвердите все планы/,'New audio approvals invalidate old final-video basis');
const missing=structuredClone(before);missing.items.find(i=>i.id===voices[0].id).selectedId=undefined;assert.throws(()=>R.editPlan(missing,true),/Выберите аудиозапись/);
const track=structuredClone(before);track.speechMode='track';track.items=track.items.filter(i=>i.stage!==6);
const sound={id:D.id(),stage:6,title:'Whole narration',variants:[]};track.items.push(sound);
D.addVariant(track,sound.id,{kind:'audio',assetId:D.id(),duration:50});D.approve(track,sound.id);
D.addVariant(track,sound.id,{kind:'audio',assetId:D.id(),duration:50,voiceId:'new-track'});
assert.equal(R.editPlan(track,true).audio[0].voiceId,'new-track');
console.log('PASS animatic uses all selected voices in plan/track modes, never old approvals; final render blocks unapproved replacements; timing uses new clips; bulk replacement is atomic.');
