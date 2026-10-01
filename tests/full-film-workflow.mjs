import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Real route/domain/provider/render code; only the private store, credentials,
// worker URL and remote HTTP are replaced. No API key or paid network call.
await mkdir('work/tests',{recursive:true});
const privateStore=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-owner')!=='owner')throw new HttpError('Unauthorized',401);return 'owner'};
export const loadProject=async(user,id)=>{if(user!=='owner'||id!==globalThis.filmState.id)throw new HttpError('Not found',404);return structuredClone(globalThis.filmState)};
export const saveProject=async(user,p,revision)=>{if(user!=='owner'||p.id!==globalThis.filmState.id)throw new HttpError('Not found',404);if(revision!==globalThis.filmState.revision)throw new HttpError('CAS revision conflict',409);p.revision++;globalThis.filmState=structuredClone(p);return structuredClone(p)};
export const mutate=async(user,id,fn)=>{for(let n=0;n<12;n++){const p=await loadProject(user,id);fn(p);try{return await saveProject(user,p,p.revision)}catch(e){if(e.status!==409||n===11)throw e;}}};
export const getKey=async(user,provider)=>{if(user!=='owner'||!['xai','minimax','elevenlabs'].includes(provider))throw Error('Wrong credential');return 'offline-mock-key'};
export const asset=async(user,id,p)=>{const a=globalThis.filmAssets.get(id);if(user!=='owner'||!a||a.projectId!==p.id)throw new HttpError('Foreign asset',404);return {id,name:a.name,mime:a.mime,size:a.bytes.length,projectId:a.projectId}};
export const imageData=async(user,id,p)=>{const a=await asset(user,id,p);if(!a.mime.startsWith('image/'))throw Error('Wrong image type');globalThis.privateImageReads.push(id);return 'data:'+a.mime+';base64,'+Buffer.from(globalThis.filmAssets.get(id).bytes).toString('base64')};
export const storeAsset=async(user,id,name,mime,bytes,projectId)=>{if(user!=='owner'||projectId!==globalThis.filmState.id)throw Error('Wrong asset owner');globalThis.filmAssets.set(id,{id,name,mime,bytes:new Uint8Array(bytes),projectId});return id};
export const runtime={FILES:{head:async id=>globalThis.filmAssets.has(id),get:async id=>{const a=globalThis.filmAssets.get(id);return a?{arrayBuffer:async()=>a.bytes.buffer.slice(a.bytes.byteOffset,a.bytes.byteOffset+a.bytes.byteLength)}:null}}};
`;
await build({stdin:{resolveDir:process.cwd(),contents:`
 export * as D from './lib/domain';export * as R from './lib/render';export * as A from './lib/animatic';export * as K from './lib/keyframes';export * as S from './lib/speech';export * as W from './lib/workflow';export * as V from './lib/video-from-animatic';
 export {PATCH as patch} from './app/api/projects/[id]/route';
 export {POST as direct} from './app/api/projects/[id]/directing/route';
 export {POST as generate} from './app/api/projects/[id]/generate/route';
 export {POST as frames} from './app/api/projects/[id]/keyframes/route';
 export {POST as prepareVideo} from './app/api/projects/[id]/video-preparation/route';
 export {POST as speech} from './app/api/projects/[id]/generate-speech/route';
 export {POST as voices} from './app/api/projects/[id]/voice-design/route';
 export {POST as step} from './app/api/projects/[id]/jobs/[jobId]/route';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/full-film-workflow.mjs',plugins:[{name:'offline-private-runtime',setup(b){
 b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'offline'}));
 b.onResolve({filter:/^@ffmpeg\/ffmpeg$/},()=>({path:'ffmpeg',namespace:'offline'}));
 b.onResolve({filter:/^\.\/wasm$/},()=>({path:'wasm',namespace:'offline'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='server'?privateStore:a.path==='ffmpeg'?'export const FFmpeg=globalThis.OfflineFFmpeg':'export const wasmUrl=async()=>""'}));
}}]});
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};
globalThis.location={origin:'http://offline.test'};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');
const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let logs=[];
core.setLogger(({message})=>logs.push(message));
const exec=args=>{core.reset();const code=core.exec(...args);if(code)throw Error(logs.slice(-20).join('\n'));return code};
const read=n=>new Uint8Array(core.FS.readFile(n));
const pixel=(file,at)=>{exec(['-y','-ss',String(at),'-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','workflow.rgb']);return read('workflow.rgb').slice(0,3)};
function verifyFrameOrder(file){const colors=[pixel(file,.5),pixel(file,4),pixel(file,5.5),pixel(file,9)];assert(colors[0][0]>200&&colors[0][2]<40);assert(colors[1][2]>200&&colors[1][0]<40);assert(colors[2][1]>80&&colors[2][0]<40);assert(colors[3][0]>200&&colors[3][1]>200&&colors[3][2]<40,'Original start/end stills remain in exact plan order');}
const stills=new Map();
for(const color of ['red','blue','green','yellow','gray']){
 exec(['-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=24`,'-frames:v','1','-threads','1',color+'.png']);stills.set(color,read(color+'.png'));
}
const videos=new Map();
for(const [n,colors] of [['one',['red','blue']],['two',['green','yellow']]]){
 for(const [i,color] of colors.entries())exec(['-y','-loop','1','-i',color+'.png','-t','2.5','-r','24','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',`${n}-${i}.mp4`]);
 core.FS.writeFile(n+'-list.txt',new TextEncoder().encode(colors.map((_,i)=>`file '${n}-${i}.mp4'`).join('\n')));
 exec(['-y','-f','concat','-safe','0','-i',n+'-list.txt','-c','copy',n+'.mp4']);videos.set(n,read(n+'.mp4'));
}
const recordings=[];
for(const [n,seconds] of [6.25,2.25].entries()){
 exec(['-y','-f','lavfi','-i',`sine=frequency=880:duration=${seconds}`,'-ar','32000','-ac','1','-c:a','libmp3lame','-b:a','128k','voice'+n+'.mp3']);recordings.push(read('voice'+n+'.mp3'));
}
globalThis.OfflineFFmpeg=class{
 async load(){}terminate(){}
 async writeFile(n,b){core.FS.writeFile(n,b)}async readFile(n){return core.FS.readFile(n)}async deleteFile(n){core.FS.unlink(n)}
 async ffprobe(args){core.reset();return core.ffprobe(...args)}
 async exec(args){return exec(args.map(v=>v.replaceAll('scale=1920:1080','scale=160:90').replaceAll('pad=1920:1080','pad=160:90')))}
};
const {D,R,A,K,S,W,V,patch,direct,generate,frames,prepareVideo,speech,voices,step}=await import('../work/tests/full-film-workflow.mjs');
globalThis.filmState=D.newProject('Письмо: полный офлайн-маршрут');filmState.seconds=10;
globalThis.filmAssets=new Map();globalThis.privateImageReads=[];
const originalFetch=globalThis.fetch,remoteFiles=new Map(),receipts=new Map(),network=[],agentRoles=[];
let ttsCalls=0;
const phrase='Я нашёл письмо!';
const send=(handler,body,jobId)=>handler(new Request('http://offline.test/test',{method:'POST',headers:{'content-type':'application/json','test-owner':'owner'},body:JSON.stringify(body)}),{params:Promise.resolve({id:filmState.id,...(jobId?{jobId}:{})})});
async function ok(handler,body,jobId){const r=await send(handler,body,jobId);assert.equal(r.status,200,await r.clone().text());return r.json()}
const change=(action,itemId,data)=>ok(patch,{revision:filmState.revision,action,...(itemId?{itemId}:{}),data});
const directing=(action,data)=>ok(direct,{revision:filmState.revision,action,data});
const current=id=>D.getItem(filmState,id);
const upload=(bytes,mime)=>{const id=D.id();filmAssets.set(id,{id,name:'offline fixture',bytes:new Uint8Array(bytes),mime,projectId:filmState.id});return id};
const speak=n=>n===0?{speechType:'none',speaker:'',text:'',delivery:''}:{speechType:'character',speaker:'Петя',text:phrase,delivery:'Удивление сменяется надеждой'};
function agentResponse(role,context){
 if(role==='scenes')return {scenes:[{id:'offline-scene',title:'Письмо в мастерской',purpose:'Раскрыть надежду Пети',location:'Мастерская',locationIds:[locationId],conflict:'Боится открывать письмо',turn:'Решается прочитать',stateIn:'Письмо на столе',stateOut:'Письмо в руках',continuity:[{character:'Петя',characterId:heroId,outfit:'красная куртка',props:'письмо на столе'}],shots:[]}]};
 if(role==='story')return {shots:[0,1].map(n=>({id:'offline-shot-'+n,title:n===0?'Письмо на столе':'Надежда',duration:5,cast:['Петя'],characterIds:[heroId],locationIds:[locationId],story:n===0?'Петя замечает письмо и берёт его':'Петя смотрит на письмо и говорит',stateIn:n===0?'Письмо на столе':'Письмо в руках',stateOut:'Письмо в руках',cinematography:'Средний план',productionDesign:'Свет окна и деревянный стол',dialogue:speak(n),continuityChanges:n===0?'Письмо переходит со стола в руки Пети':''}))};
 if(role==='camera')return {shots:context.scene.shots.map((s,n)=>({id:s.id,cinematography:n===0?'От общего плана к письму':'Крупный план реакции',direction:{framingStart:n===0?'wide':'medium',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Медленно приблизиться к герою'},startFrame:s.stateIn,endFrame:n===0?'Письмо поднято перед грудью':'Взгляд Пети светлеет',actionBeats:[{start:0,end:2.5,action:n===0?'Поднять письмо':'Прочитать и произнести реплику'}],timing:{endingHold:2.5},positions:[{subject:'Петя',start:'За столом',end:'За столом',screenDirection:'static'}],transition:{type:'cut',description:'По взгляду'},sound:{ambience:'Тихая мастерская',effects:[]}}}))};
 if(role==='art')return {shots:context.scene.shots.map(s=>({id:s.id,productionDesign:'Медовый свет окна, красная куртка Пети, деревянный стол. Письмо не меняется.'}))};
 if(role==='dialogue')return {shots:context.scene.shots.map((s,n)=>({id:s.id,dialogue:speak(n)}))};
 if(role==='performance')return {shots:context.scene.shots.map((s,n)=>({id:s.id,performance:[{character:'Петя',characterId:heroId,objective:'Понять письмо',subtext:'Боюсь и надеюсь',visibleAction:n===0?'Петя переводит взгляд и берёт письмо; рот закрыт':'Петя улыбается взглядом; говорит только Петя',emotionStart:'Тревога',emotionEnd:'Надежда'}]}))};
 if(role==='scene-expressive-reviewer'||role==='editor')return {issues:[],patches:[],montageOperations:[]};
 if(role==='compress')return {shots:context.scene.shots.map((s,n)=>({id:s.id,imagePrompt:n===0?'Письмо лежит на столе, Петя смотрит на него.':'Письмо в руках Пети, он смотрит вниз.',videoPrompt:n===0?'Петя поднимает письмо. Плавный наезд.':'Петя смотрит на письмо и произносит реплику. Плавный наезд.'}))};
 throw Error('Unexpected director role '+role);
}
let heroId,locationId;
try{
 globalThis.fetch=async(url,options={})=>{
  const address=String(url);network.push({url:address,method:options.method??'GET'});
  if(address.startsWith('/api/assets/')){const a=filmAssets.get(address.split('/').pop());assert(a,'Renderer reads a stored original asset');return new Response(a.bytes,{headers:{'content-type':a.mime}})}
  if(remoteFiles.has(address)){assert(!options.headers?.Authorization,'Result downloads never carry credentials');const f=remoteFiles.get(address);return new Response(f.bytes,{headers:{'content-type':f.mime}})}
  if(address==='https://api.x.ai/v1/chat/completions'){
   assert.equal(options.headers.Authorization,'Bearer offline-mock-key');const body=JSON.parse(options.body),prompt=body.messages.at(-1).content;
   const job=filmState.jobs.find(j=>j.status==='dispatching'&&j.prompt===prompt);assert(job,'A director request has a claimed immutable job');
   const task=filmState.directing.runs.flatMap(r=>r.tasks).find(t=>t.jobId===job.id);assert(task);agentRoles.push(task.role);
   assert(prompt.includes('Спилберг')&&prompt.includes('Приключение'));const context=JSON.parse(prompt.split('Данные:\n')[1]);
   return Response.json({id:'text-'+job.id,choices:[{message:{content:JSON.stringify(agentResponse(task.role,context))}}],usage:{cost_in_usd_ticks:'11'}});
  }
  if(address.startsWith('https://api.x.ai/v1/images/')){
   const body=JSON.parse(options.body),job=filmState.jobs.find(j=>j.status==='dispatching'&&j.kind==='image'&&j.prompt===body.prompt);assert(job);
   assert.equal(body.quality,'medium');assert.equal(body.resolution,'2k');assert(body.prompt.includes('красная куртка')&&body.prompt.includes('Мастерская'));
   const n=filmState.items.filter(i=>i.stage===5&&D.participates(filmState,i)).findIndex(i=>i.id===job.itemId),color=(n===0?['red','blue']:['green','yellow'])[job.keyframe==='end'?1:0];
   const resultUrl='https://offline-results.example/'+job.id+'.png';remoteFiles.set(resultUrl,{mime:'image/png',bytes:stills.get(color)});
   if(job.keyframe==='end')assert(job.refs.includes(K.selectedKeyframe(current(job.itemId),'start').assetId),'End generation pins its own start version');
   return Response.json({id:'image-'+job.id,data:[{url:resultUrl}],usage:{cost_in_usd_ticks:'12'}});
  }
  if(address==='https://api.x.ai/v1/videos/generations'){
   const body=JSON.parse(options.body),job=filmState.jobs.find(j=>j.status==='dispatching'&&j.kind==='video'&&j.prompt===body.prompt);assert(job);
   const item=current(job.itemId),source=item.videoPreparation;assert(source);assert.equal(body.duration,source.duration);assert.equal(body.resolution,'720p');
   const data=id=>'data:image/png;base64,'+Buffer.from(filmAssets.get(id).bytes).toString('base64');
   assert.equal(body.image.url,data(source.startFrame.assetId));assert.equal(body.last_frame.url,data(source.endFrame.assetId));
   assert(!body.reference_images?.some(r=>r.url===body.last_frame.url),'End image is not an identity reference');
   assert(job.prompt.includes('красная куртка')&&job.prompt.includes('Письмо'));
   if(job.speechType==='none')assert(job.prompt.includes('рты закрыты'));else assert(job.prompt.includes('Петя'));
   const n=filmState.items.filter(i=>i.stage===7&&D.participates(filmState,i)).findIndex(i=>i.id===job.itemId),id='video-'+job.id,resultUrl='https://offline-results.example/'+job.id+'.mp4';
   receipts.set(id,resultUrl);remoteFiles.set(resultUrl,{mime:'video/mp4',bytes:videos.get(n===0?'one':'two')});return Response.json({request_id:id});
  }
  if(address.startsWith('https://api.x.ai/v1/videos/')){const id=decodeURIComponent(address.split('/').pop());assert(receipts.has(id));return Response.json({status:'done',video:{url:receipts.get(id)},usage:{cost_in_usd_ticks:'13'}})}
  if(address==='https://api.minimax.io/v1/t2a_v2'){
   const body=JSON.parse(options.body);assert.equal(body.voice_setting.voice_id,'chosen-offline-actor');assert.equal(body.text,phrase);assert(!body.text.includes('ПЕТЯ:'));
   assert.equal(body.voice_setting.speed,ttsCalls===0?.9:1.1);assert.equal(body.voice_setting.emotion,'surprised');
   return Response.json({trace_id:'tts-'+(++ttsCalls),base_resp:{status_code:0},data:{audio:Buffer.from(recordings[ttsCalls-1]).toString('hex')},usage:{cost_in_usd_ticks:'14'}});
  }
  throw Error('Unexpected HTTP request: '+address);
 };
 const stageItem=stage=>filmState.items.find(i=>i.stage===stage&&!i.planArchive);
 const addApprove=async(item,data)=>{await change('addVariant',item.id,{title:item.title,text:'Основа',kind:'text',...data});await change('approve',item.id)};
 await addApprove(stageItem(0),{text:'Петя замечает письмо на столе мастерской. Он поднимает его, надеется на добрую весть и произносит: «Я нашёл письмо!».'});
 await directing('brief',{brief:{genre:'Приключение',effect:'Добрая тайна и надежда',audience:'Семья',director:'Спилберг',techniques:'Точка зрения героя, раскрытие через реакцию',locked:'Сохранить два события: найти и поднять письмо',factual:false,targetSeconds:10,strengths:{genre:8,style:8,surprise:3,conflict:5,drama:5,pace:4,plotFreedom:2}},productionOrder:'video-first'});
 await addApprove(stageItem(2),{text:'Живописная анимация, медовое освещение, выразительная реакция и красная куртка.'});
 locationId=stageItem(3).id;
 await addApprove(stageItem(3),{title:'Мастерская',text:'Мастерская: деревянный стол у окна.',location:{name:'Мастерская',identity:'Деревянный стол у окна',geography:'Окно слева, стол в центре',permanentProps:'Стол, письмо',refs:[],approvedAngles:[]}});
 heroId=stageItem(1).id;
 await addApprove(stageItem(1),{title:'Петя',text:'Петя',kind:'image',assetId:upload(stills.get('gray'),'image/png'),character:{name:'Петя',appearance:'Темноволосый мальчик',description:'Красная куртка, любопытный взгляд',instructions:'Красная куртка сохраняется',refs:[],actorProfile:{motivation:'Найти добрую весть',contradiction:'Боится и любопытствует',role:'Главный герой',mannerisms:'Смотрит, прежде чем коснуться',identity:'Темноволосый мальчик',traits:[{name:'Любопытство',intensity:8,instruction:'Выражать взглядом'}]}}});
 // Scenes and specialist DAG use the real executor and real text adapter.
 await directing('run',{model:'grok-4.6',mode:'scenes'});await directing('advance',{});assert.equal(filmState.directing.scenes.length,1);assert(filmState.jobs.at(-1).status==='done',filmState.jobs.at(-1).error);
 await directing('approveScenes',{});await directing('run',{model:'grok-4.6',mode:'develop'});
 for(let n=0;n<8&&filmState.directing.runs.at(-1).tasks.some(t=>!t.applied);n++)await directing('advance',{});
 assert(filmState.directing.runs.at(-1).tasks.every(t=>t.applied),JSON.stringify(filmState.directing.runs.at(-1).tasks.map(t=>[t.role,t.error])));
 for(const role of ['scenes','story','camera','art','dialogue','performance','scene-expressive-reviewer','editor'])assert(agentRoles.includes(role));
 const scene=filmState.directing.scenes[0];assert.equal(scene.shots.length,2);assert(scene.shots.every(s=>s.direction?.framingEnd==='close-up'&&s.direction.performance?.length===1));
 await directing('approveShots',{ids:scene.shots.map(s=>s.id)});await directing('publish',{model:'grok-4.6'});await directing('advance',{});
 assert(filmState.directing.runs.at(-1).published);const script=stageItem(4);assert(D.isApproved(filmState,script));assert.equal(JSON.parse(D.chosen(script).text).shots.length,2);
 await change('prepareShots',undefined,{});
 const frameIds=filmState.items.filter(i=>i.stage===5&&D.participates(filmState,i)).map(i=>i.id);assert.equal(frameIds.length,2);
 for(const itemId of frameIds){
  await ok(frames,{revision:filmState.revision,itemId,action:'mode',data:{mode:'pair'}});
  for(const role of ['start','end']){
   await ok(generate,{revision:filmState.revision,batchId:D.id(),itemId,models:['grok-imagine-image-2.0'],count:1,prompt:'Сохрани утверждённые образы и письмо.',keyframe:role,refs:[],referenceMode:'selected',dialogue:'',voiceId:'',estimates:{'grok-imagine-image-2.0':'1'}});
   const j=filmState.jobs.at(-1);assert(BigInt(j.estimate)>=800000000n);await ok(step,{},j.id);assert.equal(filmState.jobs.find(x=>x.id===j.id).status,'done');
   await ok(step,{},j.id);assert.equal(network.filter(x=>x.method==='POST'&&x.url.startsWith('https://api.x.ai/v1/images/')).length,frameIds.indexOf(itemId)*2+(role==='start'?1:2),'A completed image cannot be regenerated by polling');
  }
 }
 await change('approveBatch',undefined,{stage:5,selections:frameIds.map(itemId=>({itemId,variantId:D.chosen(current(itemId)).id,keyframes:K.keyframeSelection(current(itemId))}))});
 assert(frameIds.every(id=>D.isApproved(filmState,current(id))));
 await change('setAnimaticSettings',undefined,{sound:'silent',music:false,motion:false});
 const animaticSource=structuredClone(filmState),animaticBasis=A.animaticBasis(filmState),animatic=await R.renderFilm(filmState,true,()=>{});assert.deepEqual(filmState,animaticSource,'Rendering never mutates approval state');
 assert.equal(animatic.seconds,10);assert.equal(animatic.manifest.clips.length,2);assert(animatic.manifest.clips.every(c=>c.frames.map(f=>f.role).join(',')==='start,end'));
 const animaticBytes=new Uint8Array(await animatic.blob.arrayBuffer());await writeFile('work/tests/full-film-animatic.mp4',animaticBytes);core.FS.writeFile('workflow-animatic.mp4',animaticBytes);verifyFrameOrder('workflow-animatic.mp4');
 const animaticId=upload(new Uint8Array(await animatic.blob.arrayBuffer()),'video/mp4');
 await change('saveAnimaticPreview',undefined,{title:'Аниматик из двух кадров',text:'',kind:'video',assetId:animaticId,duration:animatic.seconds,basis:animaticBasis,animaticManifest:animatic.manifest});
 await change('approveAnimatic',undefined,{variantId:filmState.animatic.selectedId});assert(A.animaticApproved(filmState));
 // Automatic preparation pins original still files, never extracted screenshots.
 await ok(prepareVideo,{revision:filmState.revision,action:'prepare',variantId:filmState.animatic.selectedId});
 const videoIds=filmState.items.filter(i=>i.stage===7&&D.participates(filmState,i)).map(i=>i.id);assert.equal(videoIds.length,2);
 for(const itemId of videoIds){
  const item=current(itemId),prepared=V.preparedVideoInputs(filmState,item,'grok-imagine-video-1.5');assert.equal(prepared.duration,5);assert(prepared.startFrameId&&prepared.endFrameId);
  const original=animatic.manifest.clips.find(c=>c.shotId===item.sourceShot.shotId);assert.equal(prepared.startFrameId,original.frames[0].assetId);assert.equal(prepared.endFrameId,original.frames[1].assetId);
  await ok(generate,{revision:filmState.revision,batchId:D.id(),itemId,models:['grok-imagine-video-1.5'],count:1,prompt:'Сохрани действие и утверждённую композицию.',refs:[prepared.startFrameId],dialogue:'',voiceId:'',estimates:{'grok-imagine-video-1.5':'1'}});
  const j=filmState.jobs.at(-1);assert.equal(j.providerDuration,5);assert(BigInt(j.estimate)>=7200000000n);assert.equal(j.endFrameAssetId,prepared.endFrameId);
  await ok(step,{},j.id);assert.equal(filmState.jobs.find(x=>x.id===j.id).status,'pending');await ok(step,{},j.id);assert.equal(filmState.jobs.find(x=>x.id===j.id).status,'done');await ok(step,{},j.id);
 }
 assert.equal(network.filter(x=>x.url==='https://api.x.ai/v1/videos/generations').length,2,'Repeated job ticks never submit another video');
 await change('approveBatch',undefined,{stage:7,selections:videoIds.map(itemId=>({itemId,variantId:D.chosen(current(itemId)).id}))});
 const measured=Object.fromEntries(videoIds.map(id=>[D.chosen(current(id)).assetId,5]));await change('saveMediaDurations',undefined,{durations:measured});
 // Reuse a chosen profile; technical labels cannot leak into the TTS words.
 await ok(voices,{revision:filmState.revision,action:'saveProfile',data:{profile:{name:'Петя',description:'Тёплый голос героя',provider:'minimax',voiceId:'chosen-offline-actor',characterId:heroId,delivery:{emotion:'surprised',speed:.9,targetSeconds:5,intention:'Надежда'}}}});
 const profile=filmState.voiceStudio.profiles[0];await ok(voices,{revision:filmState.revision,action:'chooseProfile',data:{profileId:profile.id}});
 await change('speechMode',undefined,{mode:'plans'});const row=S.speechPlans(filmState)[0];assert.equal(row.dialogue,phrase);assert.equal(row.duration,5);assert(!row.timingIssue);
 const queueSpeech=delivery=>ok(speech,{revision:filmState.revision,batchId:D.id(),model:'speech-2.8-hd',voiceId:'',profileId:profile.id,voiceDelivery:delivery,estimate:'1',plans:[{frameId:row.frameId,dialogue:'ПЕТЯ: '+phrase,speechType:'character',speaker:'Петя'}]});
 await queueSpeech({emotion:'surprised',speed:.9,targetSeconds:5,intention:'Надежда'});let voiceJob=filmState.jobs.at(-1);assert.equal(voiceJob.voiceProfileId,profile.id);assert.equal(voiceJob.dialogue,phrase);await ok(step,{},voiceJob.id);
 let voiceItem=current(voiceJob.itemId);await change('approveBatch',undefined,{stage:6,selections:[{itemId:voiceItem.id,variantId:D.chosen(voiceItem).id}]});
 const beforeFailedAssembly=structuredClone(filmState);await assert.rejects(()=>R.renderFilm(filmState,false,()=>{}),/Реплика.*6\.\d+.*5\.00/s);assert.deepEqual(filmState,beforeFailedAssembly,'A duration conflict cannot mutate or silently shorten speech');assert.equal(ttsCalls,1);
 // The director explicitly requests a replacement. No automatic speed-up/retry.
 const previousVoice=D.chosen(voiceItem).id;
 await queueSpeech({emotion:'surprised',speed:1.1,targetSeconds:5,intention:'Сказать уверенно'});voiceJob=filmState.jobs.at(-1);await ok(step,{},voiceJob.id);voiceItem=current(voiceJob.itemId);
 assert.equal(D.chosen(voiceItem).id,previousVoice,'A new paid result does not silently replace the director choice');
 await change('select',voiceItem.id,{variantId:voiceJob.id});voiceItem=current(voiceItem.id);
 await change('approveSelectedSpeech',undefined,{selections:[{itemId:voiceItem.id,variantId:D.chosen(voiceItem).id}]});assert.equal(ttsCalls,2);assert.equal(D.chosen(current(voiceItem.id)).voiceId,'chosen-offline-actor');
 assert(videoIds.every(id=>D.isApproved(filmState,current(id))),'A replacement voice never invalidates paid video in video-first mode');
 const finalBefore=structuredClone(filmState),film=await R.renderFilm(filmState,false,()=>{});assert.deepEqual(filmState,finalBefore);assert.equal(film.seconds,10);
 const bytes=new Uint8Array(await film.blob.arrayBuffer());await writeFile('work/tests/full-film-final.mp4',bytes);core.FS.writeFile('workflow-film.mp4',bytes);
 core.reset();assert(core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json','-o','workflow-probe.json','workflow-film.mp4')<=0);
 const probe=JSON.parse(new TextDecoder().decode(read('workflow-probe.json')));assert(Math.abs(Number(probe.format.duration)-10)<.05);assert(probe.streams.some(s=>s.codec_type==='audio'));assert(probe.streams.some(s=>s.codec_type==='video'&&s.width===160&&s.height===90));
 verifyFrameOrder('workflow-film.mp4');
 const volume=at=>{logs=[];exec(['-v','info','-ss',String(at),'-i','workflow-film.mp4','-t','0.3','-af','volumedetect','-vn','-f','null','-']);const m=logs.map(v=>v.match(/mean_volume: (-?[\d.]+) dB/)).find(Boolean);assert(m);return Number(m[1])};
 assert(volume(.5)<-75,'Silent first plan has no leaked speech');assert(volume(6)>-35,'Chosen replacement speech is audible during its own plan');assert(volume(9)<-75,'Speech does not spill after its natural end');
 const finalId=upload(bytes,'video/mp4');await addApprove(stageItem(8),{title:'Итоговый фильм',text:film.timing,kind:'video',assetId:finalId,duration:film.seconds});assert(W.stageComplete(filmState,8));
 assert.equal(filmState.jobs.filter(j=>j.kind==='video').length,2);assert.equal(filmState.jobs.filter(j=>j.kind==='audio').length,2);assert(filmState.jobs.every(j=>j.status==='done'),JSON.stringify(filmState.jobs.map(j=>[j.kind,j.status,j.error])));
 assert(BigInt(D.totals(filmState).actual)>0n);assert.equal(D.totals(filmState).reserved,'0');
 const beforeForeign=structuredClone(filmState);
 const bad=await send(patch,{revision:filmState.revision,action:'addVariant',itemId:stageItem(8).id,data:{title:'Чужой',text:'',kind:'video',assetId:D.id(),duration:5}});assert.equal(bad.status,404);assert.deepEqual(filmState,beforeForeign,'Foreign asset cannot be attached');
 const unauthorized=await patch(new Request('http://offline.test',{method:'PATCH',headers:{'test-owner':'other'},body:JSON.stringify({revision:filmState.revision,action:'unapprove',itemId:stageItem(8).id})}),{params:Promise.resolve({id:filmState.id})});assert.equal(unauthorized.status,401);assert.deepEqual(filmState,beforeForeign,'Authorization refusal cannot change approval state');
 console.log('PASS full film workflow: authorized real routes, creative brief→scene/specialist DAG→published script→4 original images→bulk pair approvals→real10s animatic/manifest→private pinned endpoint video payloads→chosen TTS profile→measured audio conflict→explicit replacement→real final MP4 with frame order, audible chosen speech and no duplicate submits. All remote calls mocked.');
}finally{globalThis.fetch=originalFetch;delete globalThis.OfflineFFmpeg;}
