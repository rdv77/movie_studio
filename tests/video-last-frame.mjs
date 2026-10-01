import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as P from './lib/providers';export * as F from './lib/fal-provider';export * as E from './lib/video-end-frame';export * as T from './lib/video-duration';export * as C from './lib/prompt-compiler';export * as J from './lib/prompt-jobs';export * as A from './lib/prompt-assets';export * as D from './lib/domain';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/video-last-frame.mjs'});
const {P,F,E,T,C,J,A,D}=await import('../work/tests/video-last-frame.mjs');
const first='data:image/png;base64,AA==',last='data:image/webp;base64,AQ==',hero='data:image/jpeg;base64,Ag==';
const requestId='764cabcf-b745-4b3e-ae38-1200304cf45b',key='mock-only-last-frame-key';
const previousFetch=globalThis.fetch;let calls=[];
try{
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options,body:JSON.parse(options.body)});
  assert.equal(options.redirect,'manual');
  return Response.json(String(url).includes('minimax.io')?{task_id:'h3-last-frame'}:{request_id:requestId,usage:{cost_in_usd_ticks:'12345'}});
 };
 for(const model of ['grok-imagine-video-1.5','MiniMax-H3','fal-minimax-h3-max']){
  const job={model,kind:'video',prompt:'Сохранить лица и одежду. Плавный наезд. Все рты закрыты.',duration:5,refs:['first-owned'],endFrameAssetId:'last-owned',estimate:'999'};
  const auxiliaries=model==='grok-imagine-video-1.5'?[hero]:[];
  const result=await P.generate(job,key,[first],'16:9',auxiliaries,last),body=calls.at(-1).body;
  assert(result.pending);assert.equal(body.prompt??body.content[0].text,job.prompt);assert.equal(body.duration,5);
  assert.equal(job.estimate,'999','A provider receipt does not overwrite the estimate');
  if(model==='grok-imagine-video-1.5'){
   assert.equal(calls.at(-1).url,'https://api.x.ai/v1/videos/generations');assert.deepEqual(body.image,{url:first});assert.deepEqual(body.last_frame,{url:last});
   assert.deepEqual(body.reference_images,[{url:hero}]);assert(!body.reference_images.some(ref=>ref.url===last),'The final frame is not a hero reference');
   assert.equal(result.actual,'12345');assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+key);
  }else if(model==='MiniMax-H3'){
   assert.equal(calls.at(-1).url,'https://api.minimax.io/v2/video_generation');
   assert.deepEqual(body.content,[{type:'text',text:job.prompt},{type:'image_url',image_url:{url:first},role:'first_frame'},{type:'image_url',image_url:{url:last},role:'last_frame'}]);
   assert.equal(body.resolution,'768P');assert.equal(body.ratio,'adaptive');assert.equal(result.actual,null);
  }else{
   assert.equal(calls.at(-1).url,'https://queue.fal.run/minimax/h3-max/image-to-video');assert.equal(body.image_url,first);assert.equal(body.end_image_url,last);
   assert.equal(body.prompt_expansion_mode,'disabled');assert.equal(body.enable_safety_checker,true);assert.equal(calls.at(-1).options.headers.Authorization,'Key '+key);assert.equal(result.actual,null);
  }
  const before=calls.length;
  for(const bad of [undefined,'','https://foreign.test/end.png','data:image/gif;base64,AA==','data:image/png;base64,A'])
   await assert.rejects(()=>P.generate(job,key,[first],'16:9',auxiliaries,bad),e=>e.notSent&&e.definite);
  for(const refs of [[],[first,first]])await assert.rejects(()=>P.generate(job,key,refs,'16:9',auxiliaries,last),e=>e.notSent&&e.definite);
  if(model!=='grok-imagine-video-1.5')await assert.rejects(()=>P.generate(job,key,[first],'16:9',[hero],last),e=>e.notSent&&e.definite);
  assert.equal(calls.length,before,'A missing/invalid selected final image cannot silently become first-frame-only generation');
  const legacy={...job};delete legacy.endFrameAssetId;
  await P.generate(legacy,key,[first],'16:9',auxiliaries);const old=calls.at(-1).body;
  assert.equal(old.duration,6,'Legacy jobs retain their original six-second duration');
  assert(!('last_frame'in old)&&!('end_image_url'in old)&&!(old.content??[]).some(ref=>ref.role==='last_frame'),'Saved jobs without end selection retain their original payload');
 }
 for(const model of ['grok-imagine-video-1.5','MiniMax-H3','fal-minimax-h3-max']){
  for(const duration of [5.2,12,15]){
   const job={model,kind:'video',prompt:'Действие с закрытыми ртами.',duration,refs:['first'],endFrameAssetId:'last'};
   await P.generate(job,key,[first],'16:9',[],last);assert.equal(calls.at(-1).body.duration,Math.ceil(duration));
   const prepared={...job,videoPreparationBasis:'approved-manifest'};delete prepared.endFrameAssetId;
   await P.generate(prepared,key,[first],'16:9');assert.equal(calls.at(-1).body.duration,Math.ceil(duration),'A prepared first-only plan also uses manifest duration');
  }
  const before=calls.length;
  for(const duration of [NaN,0,-1,15.1])await assert.rejects(()=>P.generate({model,kind:'video',prompt:'Действие.',duration,endFrameAssetId:'last'},key,[first],'16:9',[],last),e=>e.notSent&&e.definite);
  assert.equal(calls.length,before,'Durations over the endpoint limit stop before paid calls');
 }
 assert.equal(T.videoRequestTiming('MiniMax-H3',2,true).requestedSeconds,4);
 assert.equal(T.videoRequestTiming('fal-minimax-h3-max',2,true).requestedSeconds,5);
 assert.equal(T.scaledVideoReservation('4800000000','1',12),'9600000000');
 assert.equal(T.scaledVideoReservation('4800000000','12000000000',12),'12000000000');
 assert.equal(T.scaledVideoReservation('4800000000','1',5),'4800000000');
 assert.equal(T.scaledVideoReservation(null,null,12),null,'Unknown prices are not invented');
 assert.equal(T.grokVideoReservation(6,1),'8500000000');assert.equal(T.grokVideoReservation(12,9),'17700000000');
 assert.equal(T.grokVideoReservation(5,2,'1'),'7200000000');assert.equal(T.grokVideoReservation(5,2,'9000000000'),'9000000000');
 await F.generateFal({model:'fal-minimax-h3-max',kind:'video',prompt:'Действие.',duration:12},key,[first],'16:9',last);
 assert.equal(calls.at(-1).body.duration,12,'A privately loaded end argument uses the same duration contract even without a stored end ID');
 const before=calls.length;
 for(const model of ['MiniMax-Hailuo-2.3','fal-wan-2.2-a14b','veo-3.1-generate-preview'])
  await assert.rejects(()=>P.generate({model,kind:'video',prompt:'Действие.',duration:5,endFrameAssetId:'end'},key,[first],'16:9',[],last),e=>e.notSent&&e.definite);
 await assert.rejects(()=>F.generateFal({model:'fal-wan-2.2-a14b',kind:'video',prompt:'Действие.',duration:5,endFrameAssetId:'end'},key,[first],'16:9',last),e=>e.notSent&&e.definite,'The exported fal adapter guards unsupported end images too');
 assert.equal(calls.length,before);
 assert.throws(()=>E.validateEndFrameAsset({kind:'video',model:'MiniMax-H3'},{mime:'image/png',size:10*1024*1024+1}),e=>e.notSent);
 assert.throws(()=>E.validateEndFrameAsset({kind:'video',model:'fal-minimax-h3-max'},{mime:'image/png',size:20*1024*1024+1}),e=>e.notSent);

 const p=D.newProject('Точные начало и конец'),script=p.items.find(i=>i.stage===4),frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7);
 const shot={id:D.id(),title:'Письмо',duration:5,description:'Герой поднимает письмо',cast:[],camera:'Плавный наезд',continuity:'Письмо остаётся в руке',dialogue:'',speechType:'none',stateIn:'Письмо на столе',stateOut:'Письмо в руке'};
 const approve=(item,data)=>{const v=D.makeVariant(p,item,data);item.variants.push(v);item.selectedId=item.approvedId=v.id;return v};
 approve(script,{kind:'text',text:JSON.stringify({timingMode:'actual',shots:[shot]})});
 for(const item of [frame,video]){item.title=shot.title;item.sourceShot={scriptId:script.id,shotId:shot.id,title:shot.title};}
 const firstId=D.id(),lastId=D.id();approve(frame,{kind:'image',assetId:firstId,jobId:D.id(),text:'Первый кадр'});approve(frame,{kind:'image',assetId:lastId,jobId:D.id(),text:'Конец'});
 const base={kind:'video',prompt:'Нежный свет.',startFrameId:firstId,endFrameId:lastId,references:[]};
 for(const model of ['grok-imagine-video-1.5','MiniMax-H3','fal-minimax-h3-max']){
  const compiled=C.compilePrompt(p,video,model,base);assert.deepEqual(compiled.references.map(r=>[r.assetId,r.role]),[[firstId,'first-frame'],[lastId,'last-frame']]);
  assert(compiled.criticalText.includes(shot.stateIn)&&compiled.criticalText.includes(shot.stateOut));assert(!compiled.warnings.some(w=>w.includes('не передаёт конечный кадр')));assert(C.promptModelCapability(model).adapter.lastFrame);
  const job=J.compileMediaJob(p,{id:D.id(),itemId:video.id,kind:'video',model,brief:base.prompt,prompt:'old',duration:5,refs:[firstId],endFrameAssetId:lastId});
  assert.deepEqual(job.refs,[firstId]);assert.equal(job.endFrameAssetId,lastId);assert(!job.characterRefs,'Final frame does not consume additional hero slots');
  assert.equal(job.providerDuration,5);assert.equal(job.compilation.duration.requestedSeconds,5);
  if(model==='grok-imagine-video-1.5')assert.equal(job.estimate,'7200000000','The client cannot under-reserve the 720p output and both endpoint inputs');
  const read=[];await A.validateCompiledMediaAssets(job,async id=>{read.push(id);return {mime:'image/png',size:100}});assert.deepEqual(read,[firstId,lastId],'Project-scoped storage validates both endpoint files');
  await assert.rejects(()=>A.validateCompiledMediaAssets(job,async id=>{if(id===lastId)throw Error('Foreign asset');return {mime:'image/png',size:100}}),/Foreign asset/);
  await assert.rejects(()=>A.validateCompiledMediaAssets(job,async id=>({mime:id===lastId?'audio/mpeg':'image/png',size:100})),/изображением/);
 }
 const staticHold=C.compilePrompt(p,video,'MiniMax-H3',{...base,endFrameId:firstId});assert.deepEqual(staticHold.references.map(r=>r.role),['first-frame','last-frame'],'A deliberate static hold may pin the same owned image to both endpoints');
 const extraRefs=Array.from({length:7},()=>D.id()),seven=C.compilePrompt(p,video,'grok-imagine-video-1.5',{...base,references:extraRefs});
 assert.equal(seven.references.length,9,'Two endpoints do not consume any of seven additional reference slots');
 assert.equal(seven.references.filter(r=>!['first-frame','last-frame'].includes(r.role)).length,7);
 assert.throws(()=>C.compilePrompt(p,video,'grok-imagine-video-1.5',{...base,references:[...extraRefs,D.id()]}),e=>e.code==='reference_count');
 const long=J.compileMediaJob(p,{id:D.id(),itemId:video.id,kind:'video',model:'grok-imagine-video-1.5',brief:base.prompt,prompt:'old',duration:12,refs:[firstId],endFrameAssetId:lastId,estimate:'1'},{duration:12,references:extraRefs});
 assert.equal(long.providerDuration,12);assert.equal(long.estimate,'17700000000');
 const rounded=C.compilePrompt(p,video,'MiniMax-H3',{...base,duration:5.2});assert.equal(rounded.capability.duration.requestedSeconds,6);assert(rounded.warnings.some(w=>w.includes('Обрезка конца')));
 const unrelated={id:D.id(),stage:5,title:'Другой план',sourceShot:{scriptId:script.id,shotId:D.id(),title:'Другой план'},variants:[]};p.items.push(unrelated);const other=approve(unrelated,{kind:'image',assetId:D.id(),jobId:D.id()}).assetId;
 assert.throws(()=>C.compilePrompt(p,video,'MiniMax-H3',{...base,endFrameId:other}),e=>e.code==='last_frame');
 const hidden=structuredClone(p);hidden.hiddenReferenceIds=[lastId];assert.throws(()=>C.compilePrompt(hidden,hidden.items.find(i=>i.id===video.id),'MiniMax-H3',base),e=>e.code==='last_frame');
 const fallback=C.compilePrompt(p,video,'fal-wan-2.2-a14b',base);assert(!fallback.references.some(r=>r.role==='last-frame'));assert(fallback.warnings.some(w=>w.includes('конечный кадр')));assert(fallback.criticalText.includes(shot.stateOut));
 const oldJob=J.compileMediaJob(p,{id:D.id(),itemId:video.id,kind:'video',model:'fal-wan-2.2-a14b',brief:base.prompt,prompt:'old',duration:5,refs:[firstId],endFrameAssetId:lastId});assert.equal(oldJob.endFrameAssetId,undefined,'Unsupported endpoints cannot leak back into the job through spread fields');
 for(const model of ['MiniMax-Hailuo-2.3','fal-wan-2.2-a14b','veo-3.1-generate-preview'])assert(!C.promptModelCapability(model).adapter.lastFrame);
 assert.equal(calls.length,before);console.log('PASS last-frame video: exact Grok/MiniMax H3/fal H3 payloads, separate identity refs, legacy payloads, final asset ownership/MIME/size, no unsupported flag, before-fetch refusal and pure compiler endpoint roles. No paid calls.');
}finally{globalThis.fetch=previousFetch}
