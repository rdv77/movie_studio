import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('work/tests',{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export {prepareKeyframeGeneration} from './lib/keyframes';export {POST as single} from './app/api/projects/[id]/generate/route';export {POST as storyboard} from './app/api/projects/[id]/generate-storyboard/route';export {POST as remaining} from './app/api/projects/[id]/generate-remaining/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-api.mjs',plugins:[{name:'offline-prompt-api',setup(b){
  b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'prompt-api'}));
  b.onLoad({filter:/.*/,namespace:'prompt-api'},()=>({contents:`
    export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
    export const owner=async()=> 'offline-owner';
    export const loadProject=async(_,id)=>{if(id!==globalThis.promptState.id)throw Error('Foreign project');return structuredClone(globalThis.promptState)};
    export const saveProject=async(_,p,revision)=>{if(revision!==globalThis.promptState.revision)throw Error('Revision conflict');p.revision++;globalThis.promptState=structuredClone(p);return p};
    export const getKey=async()=> 'mock-only';
    export const asset=async(_,id,p)=>{globalThis.promptAssetLookups.push(id);const a=globalThis.promptAssets.get(id);if(!p||a?.projectId!==p.id)throw Error('Foreign asset');return a};
  `}));
}}]});
const {D,C,prepareKeyframeGeneration,single,storyboard,remaining}=await import('../work/tests/prompt-api.mjs');
globalThis.promptAssets=new Map();globalThis.promptAssetLookups=[];
let calls=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('Paid API calls forbidden')};
const request=body=>new Request('http://localhost/offline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const context=()=>({params:Promise.resolve({id:globalThis.promptState.id})});
try {
  const p=D.newProject('Один compiler в трёх API');p.productionOrder='video-first';p.seconds=10;
  const makeImage=()=>{const id=D.id();globalThis.promptAssets.set(id,{id,projectId:p.id,mime:'image/png',size:1000});return id};
  const approve=(item,data)=>{D.addVariant(p,item.id,data);D.approve(p,item.id);return D.chosen(item)};
  approve(p.items.find(i=>i.stage===0),{text:'Анна открывает письмо во дворе.'});
  const style=p.items.find(i=>i.stage===2);
  approve(style,{text:'Акварельная анимация.\n\n'+Array.from({length:22},(_,n)=>`Деталь палитры ${n}: ${'свет и живая фактура; '.repeat(25)}`).join('\n\n')});
  const loc=p.items.find(i=>i.stage===3);loc.title='Двор';loc.location={name:'Двор',identity:'Каменная арка слева',geography:'Выход справа',permanentProps:'Фонарь у арки',refs:[],approvedAngles:[]};
  const locAsset=makeImage();approve(loc,{kind:'image',assetId:locAsset,location:loc.location,text:'Двор'});
  const hero=p.items.find(i=>i.stage===1);hero.title='Анна';hero.character={name:'Анна',appearance:'Зелёные глаза, каштановые волосы',description:'Смелая',instructions:'Сохранять лицо',refs:[]};
  const heroAsset=makeImage();approve(hero,{kind:'image',assetId:heroAsset,character:hero.character,text:'Анна'});
  const foreignHero={id:D.id(),stage:1,title:'Борис',variants:[],character:{name:'Борис',appearance:'Седая борода',description:'Спокоен',instructions:'',refs:[]}};
  p.items.push(foreignHero);const foreignAsset=makeImage();approve(foreignHero,{kind:'image',assetId:foreignAsset,character:foreignHero.character,text:'Борис'});
  const source=p.items.find(i=>i.stage===4),shots=Array.from({length:2},(_,n)=>({id:D.id(),title:`План ${n+1}`,sceneId:'yard-scene',duration:5,cast:['Анна'],characterIds:[hero.id],locationIds:[loc.id],description:'Анна поднимает письмо',stateIn:'Письмо лежит на столе',stateOut:'Письмо в руке Анны',camera:'Наезд',continuity:'Синий плащ сохраняется',sceneContinuity:[{character:'Анна',characterId:hero.id,outfit:'Синий плащ',props:'Сумка на левом плече'}],dialogue:'',speechType:'none'}));
  approve(source,{text:JSON.stringify({timingMode:'actual',shots})});
  const frames=shots.map((shot,n)=>{const item=n===0?p.items.find(i=>i.stage===5):{id:D.id(),stage:5,title:shot.title,variants:[]};if(n)p.items.push(item);item.title=shot.title;item.sourceShot={scriptId:source.id,shotId:shot.id,title:shot.title};return item});
  const frameAssets=frames.map(frame=>{const assetId=makeImage();approve(frame,{kind:'image',assetId,text:'Первый кадр'});return assetId});
  const videos=shots.map((shot,n)=>{const item=n===0?p.items.find(i=>i.stage===7):{id:D.id(),stage:7,title:shot.title,variants:[]};if(n)p.items.push(item);item.title=shot.title;item.sourceShot={scriptId:source.id,shotId:shot.id,title:shot.title};return item});
  const video=D.makeVariant(p,videos[0],{kind:'video',assetId:D.id(),model:'MiniMax-H3',text:'Готовый ролик'});videos[0].variants.push(video);videos[0].selectedId=video.id;
  const ready=structuredClone(p);
  const reset=()=>{globalThis.promptState=structuredClone(ready);globalThis.promptAssetLookups.length=0};
  const input=()=>({revision:globalThis.promptState.revision,batchId:D.id(),itemId:frames[0].id,models:['gpt-image-2.5-sunburst','grok-imagine-image-2.0'],count:1,prompt:'Нарисуй начало плана.',refs:[heroAsset,locAsset,foreignAsset],referenceMode:'selected',dialogue:'',voiceId:'',estimates:{}});
  reset();const response=await single(request(input()),context());assert.equal(response.status,200,await response.clone().text());
  assert(!globalThis.promptAssetLookups.includes(foreignAsset),'Irrelevant known images are removed before asset reads');
  const [gpt,grok]=globalThis.promptState.jobs;
  assert(gpt.prompt.length>grok.prompt.length && gpt.prompt.length<=32000 && grok.prompt.length<=5000,'Every selected model compiles independently');
  for(const job of [gpt,grok]){assert.deepEqual(job.refs,[heroAsset,locAsset]);assert(job.compilation);assert.equal(job.compilation.budget.compiledCharacters,job.prompt.length);assert(job.prompt.includes('Синий плащ') && job.prompt.includes('Сумка на левом плече'));}
  assert.equal(grok.estimate,'1000000000');assert(grok.compilation.compression.omitted.some(x=>x.reason==='budget'));
  const pure=C.compilePrompt(ready,frames[0],grok.model,{kind:'image',keyframe:'start',keyframeInstruction:prepareKeyframeGeneration(ready,frames[0].id,'start',{model:grok.model,refs:[heroAsset,locAsset,foreignAsset]}).roleInstruction,prompt:'Нарисуй начало плана.',references:[heroAsset,locAsset,foreignAsset],allowLegacyModel:true});assert.equal(grok.prompt,pure.prompt);

  reset();const batch=await storyboard(request({revision:ready.revision,batchId:D.id(),model:'grok-imagine-image-2.0',refs:[],estimate:'1',plans:frames.map(frame=>({itemId:frame.id,prompt:'Нарисуй начало плана.',refs:[heroAsset,locAsset,foreignAsset]}))}),context());
  assert.equal(batch.status,200,await batch.clone().text());assert.equal(globalThis.promptState.jobs.length,2);for(const job of globalThis.promptState.jobs){assert(job.compilation);assert.equal(job.estimate,'1000000000');assert.deepEqual(job.refs,[heroAsset,locAsset]);}

  reset();const remainingBody={revision:ready.revision,batchId:D.id(),sourceItemId:videos[0].id,sourceVariantId:video.id,estimate:'10000000000',plans:[{itemId:videos[1].id,ref:frameAssets[1],prompt:'Подними письмо и сохрани взгляд'}]};
  const videoBatch=await remaining(request(remainingBody),context());assert.equal(videoBatch.status,200,await videoBatch.clone().text());const motion=globalThis.promptState.jobs[0];assert(motion.compilation);assert.deepEqual(motion.refs,[frameAssets[1]]);assert(motion.prompt.includes('рты закрытыми весь план'));assert(motion.prompt.includes(shots[1].stateOut));

  reset();const tooLarge=structuredClone(ready);const badHero=tooLarge.items.find(i=>i.id===hero.id);badHero.variants.find(v=>v.id===badHero.approvedId).character.appearance='НЕОБХОДИМАЯ ВНЕШНОСТЬ '.repeat(400);globalThis.promptState=tooLarge;
  const badBody={...input(),models:['grok-imagine-image-2.0']};const before=JSON.stringify(globalThis.promptState);const failure=await single(request(badBody),context());assert.equal(failure.status,400);assert((await failure.json()).error.includes('Обязательная постановка'));assert.equal(JSON.stringify(globalThis.promptState),before);assert.equal(globalThis.promptState.jobs.length,0);
  reset();const unknown=makeImage();globalThis.promptAssets.get(unknown).projectId=D.id();const outside=await single(request({...input(),refs:[unknown]}),context());assert.equal(outside.status,400,'An unknown upload still needs a project-scoped asset check');assert.equal(globalThis.promptState.jobs.length,0);
  assert.equal(calls,0);console.log('PASS prompt APIs: per-model compile/refs, exact preview, single/bulk/remaining metadata, mandatory errors before enqueue, scoped unknown uploads; no paid API calls');
} finally {globalThis.fetch=originalFetch}
