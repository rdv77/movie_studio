import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};
export const owner=async()=> 'owner';
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p,revision)=>{if(revision!==state.revision)throw new Error('Revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const getKey=async()=> 'test-key';
export const asset=async(_,id)=>({id,mime:'image/png',size:100});
`;
await build({entryPoints:['lib/domain.ts','lib/speech-mode.ts','lib/plan-speech.ts','lib/shots.ts','lib/storyboard.ts','lib/speech.ts','lib/video.ts','lib/lipsync.ts','app/api/projects/[id]/generate-speech/route.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-lipsync/route.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/speech-modes',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'mock',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock}));}}]});
const root='../work/tests/speech-modes/';
const D=await import(root+'lib/domain.mjs'),M=await import(root+'lib/speech-mode.mjs'),PS=await import(root+'lib/plan-speech.mjs'),SH=await import(root+'lib/shots.mjs'),SB=await import(root+'lib/storyboard.mjs'),S=await import(root+'lib/speech.mjs'),V=await import(root+'lib/video.mjs'),L=await import(root+'lib/lipsync.mjs');
const Q=await import(root+'app/api/projects/[id]/generate-speech/route.mjs'),G=await import(root+'app/api/projects/[id]/generate/route.mjs'),LS=await import(root+'app/api/projects/[id]/generate-lipsync/route.mjs');
assert.equal(M.speechInfo({dialogue:'КАТЯ, ЗА КАДРОМ: История.'}).speechType,'voiceover');
assert.equal(M.speechInfo({dialogue:'КАТЯ: История.'}).speechType,'voiceover','A legacy name alone does not enable lipsync');
assert.equal(M.speechInfo({dialogue:''}).speechType,'none');
const p=D.newProject('Рассказчик и герои');
const shots=Array.from({length:10},(_,n)=>({title:`План ${n+1}`,description:'Мальчик смотрит на море.',duration:5,camera:'Средний план',continuity:'Прямая склейка',
  dialogue:n===0?'КАТЯ, ЗА КАДРОМ: Петя рвался первым.':n===1?'ПЕТЯ: Я первый!':n===2?'':'Мы вернёмся.',
  ...(n===1?{speechType:'character',speaker:'Петя'}:n===2?{speechType:'none',speaker:''}:{})}));
assert.match(SH.readableText(JSON.stringify({shots})),/Герой в кадре · Петя/);
assert.throws(()=>SH.parseShots(JSON.stringify({shots:shots.map((s,n)=>n===1?{...s,speaker:''}:s)}),50),/какой герой/);
for(const item of p.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,item.id,{kind:'text',text:item.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,item.id);}
SB.preparePlanCards(p);
const frames=p.items.filter(i=>i.stage===5),videos=p.items.filter(i=>i.stage===7);
assert.equal(D.chosen(frames[1]).speechType,'character');assert.equal(D.chosen(frames[1]).speaker,'Петя');
for(const item of frames){D.addVariant(p,item.id,{...D.chosen(item),id:undefined,kind:'image',assetId:D.id()});D.approve(p,item.id);}
const sources=S.scriptSpeech(p).sources;assert(!sources.some(s=>s.id==='script:all'),'Do not mix characters and narration into one speech track');
let rows=S.speechPlans(p);assert.equal(rows.length,9);assert.equal(rows[0].speechType,'voiceover');assert.equal(rows[1].dialogue,'Я первый!');assert.equal(rows[1].speaker,'Петя');
const body={revision:p.revision,batchId:D.id(),model:'speech-2.8-hd',voiceId:'test',estimate:'1',plans:rows.map(r=>({frameId:r.frameId,dialogue:r.dialogue,speechType:r.speechType,speaker:r.speaker}))};
const ctx={params:Promise.resolve({id:p.id})},req=b=>new Request('http://localhost',{method:'POST',body:JSON.stringify(b)});
globalThis.state=structuredClone(p);
let response=await Q.POST(req(body),ctx);assert.equal(response.status,200);const queued=await response.json();
assert.equal(queued.jobs[0].speechType,'voiceover');assert.equal(queued.jobs[1].speechType,'character');assert.equal(queued.jobs[1].speaker,'Петя');assert.equal(queued.jobs[1].dialogue,'Я первый!');
assert(queued.items.filter(i=>i.stage===6&&i.sourceShot).every(i=>!i.approvedId),'No automatic speech approval');
state=structuredClone(p);response=await Q.POST(req({...body,plans:[{...body.plans[1],speaker:''}]}),ctx);assert.equal(response.status,400);assert.equal(state.jobs.length,0);
const ready=structuredClone(queued);ready.jobs=[];
for(const item of ready.items.filter(i=>i.stage===6&&i.sourceShot)){
  const job=queued.jobs.find(j=>j.itemId===item.id);D.addVariant(ready,item.id,{...job,id:undefined,kind:'audio',assetId:D.id(),text:job.dialogue});D.approve(ready,item.id);
}
assert(D.stageReady(ready,7));
const vi=ready.items.find(i=>i.id===videos[1].id),narrated=ready.items.find(i=>i.id===videos[0].id);
assert.equal(PS.planSpeech(ready,vi).speechType,'character');assert.equal(PS.planSpeech(ready,narrated).speechType,'voiceover');
assert.match(V.videoGenerationPrompt(ready,narrated,'Медленный наезд.'),/Все персонажи держат рты закрытыми/);
assert.match(V.videoGenerationPrompt(ready,vi,'Медленный наезд.'),/произносит в кадре Петя/);
assert.doesNotMatch(V.videoGenerationPrompt(ready,vi,'Медленный наезд.'),/Все персонажи держат рты закрытыми/);
assert.doesNotMatch(V.videoGenerationPrompt(ready,narrated,'Медленный наезд.'),/Петя рвался первым/,'Narration words are not a talking instruction');
assert.throws(()=>L.lipsyncImageSource(ready,narrated.id),/закадровый голос/);assert.equal(L.lipsyncImageSource(ready,vi.id).audio.speaker,'Петя');
const audioItem=ready.items.find(i=>i.stage===6&&i.sourceShot?.title===vi.title);
const legacy=structuredClone(ready);delete D.chosen(legacy.items.find(i=>i.id===audioItem.id)).speechType;
assert.equal(PS.planSpeech(legacy,vi).speechType,'voiceover');assert.throws(()=>L.lipsyncImageSource(legacy,vi.id),/закадровый голос/);
const technical=structuredClone(ready);D.chosen(technical.items.find(i=>i.id===audioItem.id)).dialogue='(пауза)';assert.throws(()=>L.lipsyncImageSource(technical,vi.id),/произносимый текст/);
const edited=structuredClone(ready),editedAudio=edited.items.find(i=>i.id===audioItem.id);
D.addVariant(edited,editedAudio.id,{kind:'audio',assetId:D.chosen(editedAudio).assetId,dialogue:'Новая закадровая версия.',speechType:'voiceover',speaker:'Катя'});
assert.equal(PS.planSpeech(edited,vi).speechType,'character','An unapproved selection cannot change generation policy');
let retry=S.speechPlans(edited).find(r=>r.title===vi.title);assert.equal(retry.dialogue,'Новая закадровая версия.');assert.equal(retry.speechType,'voiceover');assert.equal(retry.speaker,'Катя','Batch regenerations preserve selected director edits');
D.approve(edited,editedAudio.id);assert.equal(PS.planSpeech(edited,vi).speechType,'voiceover');
const track=structuredClone(ready);track.speechMode='track';const common=track.items.find(i=>i.stage===6&&!i.sourceShot);common.title=vi.title;
D.addVariant(track,common.id,{kind:'audio',assetId:D.id(),dialogue:'Общий рассказ',speechType:'voiceover'});D.approve(track,common.id);
assert.equal(PS.planSpeech(track,vi).speechType,'voiceover','A hidden plan track cannot make a character speak');
track.speechMode='plans';assert.equal(PS.planSpeech(track,vi).speechType,'character','A hidden general track cannot mask the active plan speech');
const payload={revision:ready.revision,batchId:D.id(),itemId:narrated.id,models:['MiniMax-Hailuo-2.3'],count:1,prompt:'Медленный наезд.',refs:[D.id()],dialogue:'',voiceId:'',estimates:{}};
state=structuredClone(ready);response=await G.POST(req(payload),ctx);assert.equal(response.status,200);assert.match(state.jobs[0].prompt,/рты закрытыми/);assert.equal(state.jobs[0].speechType,'voiceover');
state=structuredClone(ready);response=await G.POST(req({...payload,itemId:vi.id}),ctx);assert.equal(response.status,200);assert.match(state.jobs[0].prompt,/произносит в кадре Петя/);assert.equal(state.jobs[0].speaker,'Петя');
state=structuredClone(ready);response=await G.POST(req({...payload,prompt:'x'.repeat(1900)}),ctx);assert.equal(response.status,400);assert.equal(state.jobs.length,0,'The speech rule counts toward the provider limit before billing');
const frame=ready.items.find(i=>i.id===frames[0].id),image=D.chosen(frame),audio=ready.items.find(i=>i.stage===6&&i.sourceShot?.title===narrated.title);
state=structuredClone(ready);response=await LS.POST(req({revision:ready.revision,batchId:D.id(),model:'sync-3',rate:'100',plans:[{inputType:'image',itemId:narrated.id,imageVariantId:image.id,imageItemId:frame.id,imageAssetId:image.assetId,imageWidth:1024,imageHeight:768,audioVariantId:audio.approvedId,audioAssetId:D.chosen(audio).assetId,seconds:5,speaker:{x:.5,y:.5},prompt:'Speak.'}]}),ctx);
assert.equal(response.status,400);assert.match((await response.json()).error,/закадровый голос/);assert.equal(state.jobs.length,0);
console.log('PASS speech modes: explicit screenplay metadata, legacy narration, clean TTS, manual edits and approvals, active audio selection, single/batch queue persistence, closed-mouth video prompts and limits, and server-side sync rejection. No paid calls.');
