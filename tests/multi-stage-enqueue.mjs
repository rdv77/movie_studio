import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// All real enqueue routes use one revision-checked store. No dispatcher or provider is run.
const server=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=f=>async(req,ctx)=>{try{return await f(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-owner')!=='owner')throw new HttpError('Unauthorized',401);return 'owner'};
export const loadProject=async(_,id)=>{if(id!==state.id)throw new HttpError('Not found',404);return structuredClone(state)};
export const saveProject=async(_,p,revision)=>{await Promise.resolve();if(revision!==state.revision)throw new HttpError('revision conflict',409);p.revision++;globalThis.state=structuredClone(p);return p};
export const getKey=async(_,provider)=>{if(globalThis.noKey)throw Error('Missing key');globalThis.keys.push(provider);return 'fake-key'};
export const asset=async(_,id)=>{if(!globalThis.assets.has(id))throw Error('Foreign asset');return structuredClone(globalThis.assets.get(id))};
export const imageData=async()=>{throw Error('Unexpected image read')};
export const storeAsset=async()=>{throw Error('Enqueue must not write media')};
export const runtime={FILES:{}};
`;
await build({stdin:{resolveDir:process.cwd(),contents:`
export * as D from './lib/domain';export {speechPlans} from './lib/speech';export {lipsyncSource} from './lib/lipsync';
export {POST as speech} from './app/api/projects/[id]/generate-speech/route';
export {POST as lipsync} from './app/api/projects/[id]/generate-lipsync/route';
export {POST as comparison} from './app/api/projects/[id]/generate-voice-tests/route';
export {POST as music} from './app/api/projects/[id]/music/route';
export {POST as generate} from './app/api/projects/[id]/generate/route';
export {MusicEditor} from './app/music-editor';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/multi-stage-enqueue.mjs',external:['react','react-dom','react-dom/*'],plugins:[{name:'owned-store',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:server}));
}}]});
const {D,speechPlans,lipsyncSource,speech,lipsync,comparison,music,generate,MusicEditor}=await import('../work/tests/multi-stage-enqueue.mjs');
globalThis.fetch=async()=>{throw Error('No network or paid calls allowed in enqueue tests')};
globalThis.keys=[];globalThis.assets=new Map();
function fixture(){
 const p=D.newProject('Независимые этапы');p.speechMode='plans';p.seconds=8;
 const shots=[1,2].map(n=>({title:'План '+n,description:'Герой смотрит на море.',duration:4,camera:'Средний план',continuity:'Склейка по взгляду',dialogue:'Привет, мир!',speechType:'character',speaker:'Катя'}));
 for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Утверждённая основа'});D.approve(p,i.id);}
 const scriptId=p.items.find(i=>i.stage===4).id;
 p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
 for(const stage of [5,6,7])for(const shot of shots){
  const item={id:D.id(),stage,title:shot.title,sourceShot:{scriptId,title:shot.title},variants:[]};p.items.push(item);
  D.addVariant(p,item.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:4,text:'Готовый материал',dialogue:shot.dialogue,speechType:'character',speaker:'Катя',voiceId:'test-voice'});D.approve(p,item.id);
 }
 return p;
}
const initial=fixture(),frames=initial.items.filter(i=>i.stage===5),voices=initial.items.filter(i=>i.stage===6),videos=initial.items.filter(i=>i.stage===7);
const preparedVideo=D.id(),preparedAudio=D.id();
assets.set(preparedVideo,{id:preparedVideo,mime:'video/mp4',size:100});assets.set(preparedAudio,{id:preparedAudio,mime:'audio/wav',size:100});
const reset=()=>{globalThis.state=structuredClone(initial);globalThis.noKey=false;globalThis.keys=[];};
const request=(body,owner='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'content-type':'application/json','test-owner':owner},body:JSON.stringify(body)});
const send=(route,body,owner='owner',projectId=state.id)=>route(request(body,owner),{params:Promise.resolve({id:projectId})});
function job(itemId,status='queued'){
 return {id:D.id(),batchId:D.id(),itemId,model:'speech-2.8-hd',kind:'audio',voiceId:'test-voice',dialogue:'Не меняется',prompt:'Не меняется',brief:'Другая попытка',refs:[],duration:4,offset:0,volume:1,camera:'',continuity:'',created:D.now(),deps:'foreign',status,estimate:'100',actual:status==='unknown'?null:'0'};
}
const source=lipsyncSource(initial,videos[0].id);
const bodies={
 speech:()=>({revision:state.revision,batchId:D.id(),model:'speech-2.8-hd',voiceId:'test-voice',estimate:'100',plans:[{frameId:frames[0].id,dialogue:'Новая реплика.',speechType:'character',speaker:'Катя'}]}),
 lipsync:()=>({revision:state.revision,batchId:D.id(),model:'sync-3',rate:'100',plans:[{itemId:videos[0].id,videoVariantId:source.video.id,audioVariantId:source.audio.id,videoAssetId:preparedVideo,audioAssetId:preparedAudio,seconds:4}]}),
 comparison:()=>({revision:state.revision,batchId:D.id(),phrase:'Сравните наши голоса.',voices:[{model:'speech-2.8-hd',voiceId:'Russian_FriendlyPerson',name:'Первый',estimate:'100'},{model:'eleven_v3',voiceId:'voice-two',name:'Второй',estimate:'100'}]}),
 music:()=>({revision:state.revision,action:'generate',data:{batchId:D.id(),model:'music_v1',prompt:'Instrumental cinematic piano',duration:10,count:2,estimate:'100'}}),
 ideas:()=>({revision:state.revision,action:'ideas',data:{batchId:D.id(),model:'MiniMax-M2.7',prompt:'Спокойная сказка',estimate:'100'}}),
 text:()=>({revision:state.revision,batchId:D.id(),itemId:initial.items.find(i=>i.stage===0).id,models:['MiniMax-M2.7'],count:1,prompt:'Предложи альтернативный сюжет.',refs:[],dialogue:'',voiceId:'',estimates:{'MiniMax-M2.7':'100'}}),
 audio:()=>({revision:state.revision,batchId:D.id(),itemId:voices[0].id,models:['speech-2.8-hd'],count:1,prompt:'Спокойная реплика.',refs:[],dialogue:'Новая реплика.',speechType:'character',speaker:'Катя',voiceId:'test-voice',estimates:{'speech-2.8-hd':'100'}}),
};
const routes={speech,lipsync,comparison,music,ideas:music,text:generate,audio:generate};
const target={speech:voices[0].id,lipsync:videos[0].id,music:initial.id,ideas:initial.id,text:initial.items.find(i=>i.stage===0).id,audio:voices[0].id};
// Every route accepts independent active and unresolved attempts, preserving their records and approvals.
for(const [name,route] of Object.entries(routes))for(const status of ['queued','dispatching','pending','saving','unknown']){
 reset();const foreign=job(D.id(),status);state.jobs.push(foreign);const before=structuredClone(state),body=bodies[name]();
 const response=await send(route,body);assert.equal(response.status,200,name+' with unrelated '+status+': '+JSON.stringify(await response.clone().json()));
 assert(state.jobs.length>1);assert.deepEqual(state.jobs[0],foreign);assert(state.jobs.slice(1).every(j=>j.status==='queued'&&j.actual===null));
 assert.deepEqual(state.items.map(i=>[i.id,i.selectedId,i.approvedId]),before.items.map(i=>[i.id,i.selectedId,i.approvedId]),'Enqueue does not choose or approve');
 const queued=structuredClone(state),revision=state.revision,keyCount=keys.length;
 state.jobs[1].status='unknown';state.jobs[1].actual=null;const same=structuredClone(state);
 assert.equal((await send(route,body)).status,200,'Same batch is idempotent even with stale revision and unknown result');
 assert.deepEqual(state,same);assert.equal(keys.length,keyCount);assert.equal(state.revision,revision);
 assert(queued.jobs.slice(1).every(j=>j.estimate!==undefined),'Every accepted attempt reserves its own estimate');
}
console.log('PASS independent enqueue: 7 routes × 5 unrelated states, immutable approvals, unknown preservation, stale-revision batch idempotency.');
// A batch must fail atomically for its own target, including unknown outcomes and later rows.
for(const [name,itemId] of Object.entries(target))for(const status of ['queued','dispatching','pending','saving','unknown']){
 reset();state.jobs.push(job(itemId,status));const before=structuredClone(state),response=await send(routes[name],bodies[name]());
 assert.equal(response.status,400,name+' own '+status);assert.deepEqual(state,before);assert.equal(keys.length,0);
}
reset();state.jobs.push(job(voices[1].id));const two=bodies.speech();two.plans.push({frameId:frames[1].id,dialogue:'Вторая реплика.',speechType:'character',speaker:'Катя'});
let before=structuredClone(state);assert.equal((await send(speech,two)).status,400);assert.deepEqual(state,before,'A busy later row commits no earlier job');
reset();state.jobs.push(job(videos[1].id));const syncTwo=bodies.lipsync(),next=lipsyncSource(initial,videos[1].id);
syncTwo.plans.push({...syncTwo.plans[0],itemId:videos[1].id,videoVariantId:next.video.id,audioVariantId:next.audio.id});
before=structuredClone(state);assert.equal((await send(lipsync,syncTwo)).status,400);assert.deepEqual(state,before);
reset();state.jobs.push(job(voices[1].id));assert.equal((await send(speech,bodies.speech())).status,200,'Another plan may remain queued');
reset();state.jobs.push(job(videos[1].id));assert.equal((await send(lipsync,bodies.lipsync())).status,200,'Another sync/video plan may remain queued');
reset();const old=job(D.id(),'unknown');old.purpose='voice-test';state.jobs.push(old);
assert.equal((await send(comparison,bodies.comparison())).status,200);assert(state.jobs.slice(1).every(j=>j.itemId!==old.itemId),'New voice comparison is an explicit independent target');
console.log('PASS scoped admission: same material active/unknown rejected atomically; separate plans and voice comparisons admitted.');
for(const [name,route] of Object.entries(routes)){
 for(const scenario of ['owner','project','revision','budget','key']){
  reset();let body=bodies[name](),owner='owner',projectId=state.id;
  if(scenario==='owner')owner='foreign';if(scenario==='project')projectId=D.id();if(scenario==='revision')body.revision=-1;
  if(scenario==='budget')state.limit='0';if(scenario==='key')globalThis.noKey=true;
  const before=structuredClone(state),response=await send(route,body,owner,projectId);
  assert.equal(response.status,scenario==='owner'?401:scenario==='project'?404:400,name+' '+scenario);assert.deepEqual(state,before,name+' failed '+scenario+' must be atomic');
 }
 reset();state.limit='150';const body=bodies[name]();if(name==='music'||name==='comparison'){
  before=structuredClone(state);assert.equal((await send(route,body)).status,400);assert.deepEqual(state,before,'Whole-batch budget checked before reservation');
 }
}
reset();before=structuredClone(state);const invalid=bodies.lipsync();invalid.plans[0].audioAssetId=D.id();assert.equal((await send(lipsync,invalid)).status,400);assert.deepEqual(state,before,'Foreign prepared file must not enqueue');
reset();before=structuredClone(state);const duplicate=bodies.comparison();duplicate.voices[1]={...duplicate.voices[0]};assert.equal((await send(comparison,duplicate)).status,400);assert.deepEqual(state,before);
console.log('PASS enqueue authorization: owner/project/revision/key/budget/file guards; batch budget remains atomic.');
for(const name of ['speech','lipsync','music','comparison','text','audio']){
 reset();const a=bodies[name](),b=bodies[name]();const result=await Promise.all([send(routes[name],a),send(routes[name],b)]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409],name+' concurrent stale snapshots must not both commit');
 const accepted=result.find(r=>r.status===200),saved=await accepted.json();assert.deepEqual(JSON.parse(JSON.stringify(state)),saved);assert.equal(state.revision,initial.revision+1);
}
reset();const both=await Promise.all([send(speech,bodies.speech()),send(music,bodies.music())]);assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
const failed=both[0].status===409?'speech':'music';assert.equal((await send(routes[failed],bodies[failed]())).status,200,'An independent loser can enqueue after explicit refresh');
console.log('PASS revision CAS: concurrent requests cannot overwrite or double-reserve, refreshed independent enqueue succeeds.');
const connections={providers:[{id:'minimax',configured:true},{id:'elevenlabs',configured:true}]};
const html=p=>renderToStaticMarkup(createElement(MusicEditor,{p,busy:false,connections,submit:async()=>{throw Error('Render must not submit')},upload:async()=>{throw Error('Render must not upload')},onContinue:()=>{}}));
reset();state.jobs.push(job(voices[0].id));let markup=html(state);
assert(!/<button[^>]*\sdisabled=""[^>]*>Предложить 3 направления с ИИ/.test(markup),'Unrelated voice cannot disable music UI');
state.jobs.push(job(state.id));markup=html(state);assert(/<button[^>]*\sdisabled=""[^>]*>Предложить 3 направления с ИИ/.test(markup));assert(markup.includes('Другие планы и этапы можно запускать параллельно'));
state.jobs.at(-1).status='unknown';markup=html(state);assert(markup.includes('платный запрос автоматически не повторяется'));
console.log('PASS actual music UI: scoped disabled state explains active/unknown reasons; rendering never submits. Zero paid calls.');
