import {build} from 'esbuild';import assert from 'node:assert/strict';
const server=`
import {projectAssetIds} from './lib/project-assets';
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=fn=>fn;
export const owner=async()=>globalThis.worldUser;
export const getKey=async()=> 'local-mock-key';
export async function loadProject(user,id){if(user!==globalThis.worldOwner||id!==globalThis.worldState.id)throw Object.assign(Error('Not found'),{status:404});return JSON.parse(JSON.stringify(globalThis.worldState));}
export async function asset(user,id,p){
 globalThis.worldAssetChecks++;
 if(globalThis.worldCheckPristine)assertPristine(p);
 const row=globalThis.worldFiles.get(id);if(!row||row.owner!==user||row.project_id!==p.id&&!projectAssetIds(p).has(id))throw Object.assign(Error('Foreign project file'),{status:404});return row;
}
function assertPristine(p){if(JSON.stringify(p)!==JSON.stringify(globalThis.worldState))throw Error('Snapshot mutated before asset validation');}
export async function saveProject(user,p,expected){if(globalThis.worldRace){globalThis.worldState.revision++;globalThis.worldRace=false;}if(expected!==globalThis.worldState.revision)throw Object.assign(Error('CAS conflict'),{status:409});p.revision=expected+1;globalThis.worldState=JSON.parse(JSON.stringify(p));return JSON.parse(JSON.stringify(p));}
export async function mutate(user,id,fn){for(let n=0;n<10;n++){const p=await loadProject(user,id),revision=p.revision;fn(p);await Promise.resolve();try{return await saveProject(user,p,revision);}catch(e){if(e.status!==409||n===9)throw e;}}}
export const runtime={FILES:{},DB:{}};
export const imageData=async(user,id,p)=>{await asset(user,id,p);return 'data:image/png;base64,'+btoa(id);};
export const storeAsset=async()=> {throw Error('Unexpected media storage');};
`;
const provider=`export async function generate(job,key,refs){globalThis.worldRefData=refs;globalThis.worldCalls++;globalThis.worldSent=structuredClone(job);if(globalThis.worldHold)await new Promise(resolve=>globalThis.worldRelease=resolve);if(globalThis.worldFailure)throw Error('Transport outcome unknown');return {text:JSON.stringify({appearance:'Голубые глаза',description:'Принимает решение вопреки страху.',actorProfile:globalThis.worldActorResult,notes:['Наблюдаемый выбор героя']}),requestId:'actor-receipt',actual:'250000000',usage:{input_tokens:120,output_tokens:80}};}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as C from './lib/creative-versions';export * as W from './lib/world-assets';export * as L from './lib/scene-locations';export {projectAssetIds} from './lib/project-assets';export {POST} from './app/api/projects/[id]/world/route';export {POST as voiceAction} from './app/api/projects/[id]/voice-design/route';export {POST as generateLocations} from './app/api/projects/[id]/generate-locations/route';export {PATCH} from './app/api/projects/[id]/route';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/world-routes.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'world-mocks',setup(b){
 b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'world'}));b.onResolve({filter:/^\.\/providers$/},()=>({path:'provider',namespace:'world'}));b.onLoad({filter:/.*/,namespace:'world'},args=>({contents:args.path==='server'?server:provider,resolveDir:process.cwd()}));
}}]});
const {D,R,C,W,L,POST,PATCH,voiceAction,generateLocations,projectAssetIds,runDirectorStep}=await import('../work/tests/world-routes.mjs');
const actor={...W.emptyActorProfile(),identity:'Голубые глаза',role:'Главный герой',motivation:'Помочь другу',traits:[{name:'Гротеск',intensity:0,instruction:'Не усиливать'}]};
const make=()=>{const p=D.newProject('Постоянный мир'),d=R.ensureDirecting(p),hero=p.items.find(i=>i.stage===1),place=p.items.find(i=>i.stage===3);hero.character={name:'Младший',appearance:'Голубые глаза',description:'Добрый мальчик',instructions:'Сохранить внешность',refs:[D.id()],actorProfile:structuredClone(actor)};const image=D.makeVariant(p,hero,{kind:'image',assetId:D.id(),character:structuredClone(hero.character)});hero.variants.push(image);hero.selectedId=image.id;hero.approvedId=image.id;
 const profile={...W.emptyLocation('Пруд'),identity:'Овальный пруд',refs:[D.id()],approvedAngles:[{id:D.id(),name:'Берег',description:'Мост справа',refs:[D.id()]}]};place.location=structuredClone(profile);const old=D.makeVariant(p,place,{kind:'image',assetId:D.id(),location:structuredClone(profile)});place.variants.push(old);place.selectedId=old.id;place.approvedId=old.id;return {p,d,hero,place,image,old,profile};};
const setup=p=>{globalThis.worldState=JSON.parse(JSON.stringify(p));globalThis.worldUser='owner';globalThis.worldOwner='owner';globalThis.worldFiles=new Map([...projectAssetIds(p)].map(id=>[id,{id,owner:'owner',project_id:p.id,mime:'image/png',size:100}]));globalThis.worldCalls=0;globalThis.worldRelease=undefined;globalThis.worldAssetChecks=0;globalThis.worldCheckPristine=false;globalThis.worldRace=false;globalThis.worldHold=false;globalThis.worldFailure=false;globalThis.worldActorResult=structuredClone(actor);};
const request=async(action,data,revision=worldState.revision)=>POST(new Request('http://localhost/world',{method:'POST',body:JSON.stringify({action,data,revision})}),{params:Promise.resolve({id:worldState.id})});
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS world route:',name);}
await test('foreign references cannot bootstrap ownership by modifying incoming location snapshot',async()=>{
 const {p,place,profile}=make();setup(p);worldCheckPristine=true;const foreign=D.id();worldFiles.set(foreign,{id:foreign,owner:'owner',project_id:D.id(),mime:'image/png',size:100});const before=structuredClone(worldState);
 await assert.rejects(request('saveLocation',{itemId:place.id,profile:{...profile,refs:[foreign]}}),/Foreign project/);assert.deepEqual(worldState,before);assert.equal(worldCalls,0);
 await request('saveLocation',{itemId:place.id,profile});assert(worldAssetChecks>0);
});
await test('location profile version retains selected and approved image; angles survive soft remove/restore',async()=>{
 const {p,place,profile,image,old}=make();setup(p);await request('saveLocation',{itemId:place.id,profile:{...profile,geography:'Мост на востоке'}});
 let item=worldState.items.find(i=>i.id===place.id);assert.equal(item.selectedId,old.id);assert.equal(item.approvedId,old.id);assert.equal(item.variants.length,2);assert.equal(item.location.geography,'Мост на востоке');assert.equal(item.variants.at(-1).assetId,old.assetId);assert.equal(W.locationForItem(item).geography,profile.geography);
 await request('removeLocation',{itemId:place.id});item=worldState.items.find(i=>i.id===place.id);assert(item.removedAt);for(const id of profile.approvedAngles[0].refs)assert(projectAssetIds(worldState).has(id));await request('restoreLocation',{itemId:place.id});assert.equal(worldState.items.find(i=>i.id===place.id).removedAt,undefined);
});
await test('revision admission and final CAS reject stale edits without canonical changes or paid calls',async()=>{
 const {p,place,profile}=make();setup(p);await assert.rejects(request('saveLocation',{itemId:place.id,profile},p.revision-1),/изменился/);assert.equal(worldAssetChecks,0);
 worldRace=true;const before=structuredClone(worldState.items);await assert.rejects(request('saveLocation',{itemId:place.id,profile:{...profile,name:'Другой пруд'}}),/CAS conflict/);assert.deepEqual(worldState.items,before);assert.equal(worldCalls,0);
 worldUser='foreign-user';await assert.rejects(request('saveLocation',{itemId:place.id,profile}),/Not found/);
});
await test('scene locations reject foreign IDs/angles before saving a creative version',async()=>{
 const {p,d,place,profile}=make();const scene={id:D.id(),title:'Находка',purpose:'Чудо',location:'Пруд',conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:[]};d.scenes.push(scene);setup(p);
 await assert.rejects(request('saveSceneLocation',{sceneId:scene.id,locationIds:[D.id()],locationState:W.emptyLocationState()}),/текущего проекта/);assert.equal(worldState.creativeHistory,undefined);
 await request('saveSceneLocation',{sceneId:scene.id,locationIds:[place.id],locationState:{...W.emptyLocationState(),angleIds:[profile.approvedAngles[0].id],weather:'Туман'}});assert.equal(worldState.directing.scenes[0].locationState.weather,'Туман');assert(worldState.creativeHistory.length>0);
});
await test('manual actor profile saves history and preserves image choice/approval',async()=>{
 const {p,hero,image}=make();setup(p);await request('saveActorProfile',{itemId:hero.id,profile:{...actor,motivation:'Защитить слабого'}});const item=worldState.items.find(i=>i.id===hero.id);assert.equal(item.selectedId,image.id);assert.equal(item.approvedId,image.id);assert.equal(item.character.actorProfile.motivation,'Защитить слабого');assert.equal(item.characterHistory.length,2);
 const response=await PATCH(new Request('http://localhost/project',{method:'PATCH',body:JSON.stringify({revision:worldState.revision,action:'saveCharacter',itemId:hero.id,data:{profile:item.character}})}),{params:Promise.resolve({id:p.id})});assert(response.ok);assert.deepEqual(worldState.items.find(i=>i.id===hero.id).character.actorProfile,item.character.actorProfile);
});
await test('actor engine uses frozen actual input and provenance; late candidate never selects/approves image',async()=>{
 const {p,hero,image}=make();setup(p);await request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Сделай выбор выразительным',actorProfile:actor});const input=structuredClone(worldState.directing.runs[0].characterInput);assert.equal(worldCalls,0);worldHold=true;const flight=runDirectorStep('owner',p.id);for(let n=0;n<1000&&!worldRelease;n++)await new Promise(resolve=>setImmediate(resolve));assert(worldRelease);
 const item=worldState.items.find(i=>i.id===hero.id);item.character.description='Изменено после запуска';item.character.refs=[D.id()];worldState.directing.runs[0].stopped=true;worldRelease();await flight;const job=worldState.jobs[0],candidate=worldState.items.find(i=>i.id===hero.id).variants.at(-1);
 assert.equal(worldSent.prompt,input.prompt);assert.deepEqual(worldSent.refs,input.character.refs);assert.equal(worldRefData.length,input.character.refs.length);assert(worldRefData.every(ref=>ref.startsWith('data:image/png;base64,')));assert.deepEqual(job.versionInfo,input.versionInfo);assert.equal(job.actual,'250000000');assert.equal(job.requestId,'actor-receipt');assert.equal(job.status,'done');assert(candidate.characterDraft);assert.deepEqual(candidate.character.refs,input.character.refs);assert.equal(item.approvedId,image.id);assert.equal(worldState.items.find(i=>i.id===hero.id).selectedId,image.id);assert(!D.visibleVariants(worldState.items.find(i=>i.id===hero.id)).some(v=>v.id===candidate.id));
 await request('chooseActorDraft',{itemId:hero.id,variantId:candidate.id});assert.equal(worldState.items.find(i=>i.id===hero.id).character.description,candidate.character.description);assert.equal(worldState.items.find(i=>i.id===hero.id).approvedId,image.id);await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);
});
await test('unknown actor request is retained with no automatic paid retry',async()=>{
 const {p,hero}=make();setup(p);await request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Проработай героя',actorProfile:actor});worldFailure=true;await runDirectorStep('owner',p.id);assert.equal(worldState.jobs[0].status,'unknown');await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);assert.equal(worldState.items.find(i=>i.id===hero.id).variants.length,1);
});
await test('automatic place preparation retains structure approval, profiles and previous files; repeat is a no-op',async()=>{
 const {p,d,place,old}=make();d.scenes=[{id:D.id(),title:'Встреча',purpose:'Чудо',location:'Пруд. Мост справа.',conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:[]}];d.scenesApproved=R.scenesBasis(p);setup(p);
 await request('prepareLocations',{});assert.equal(worldState.directing.scenes[0].locationIds[0],place.id);assert.equal(worldState.directing.scenesApproved,R.scenesBasis(worldState));assert.equal(worldState.items.find(i=>i.id===place.id).approvedId,old.id);
 const revision=worldState.revision,before=JSON.stringify(worldState);await request('prepareLocations',{});assert.equal(worldState.revision,revision);assert.equal(JSON.stringify(worldState),before);
 await request('saveSceneLocation',{sceneId:d.scenes[0].id,locationIds:[place.id],locationState:{...W.emptyLocationState(),light:'Мягкий свет слева'}});assert.equal(worldState.directing.scenesApproved,R.scenesBasis(worldState));assert.equal(worldCalls,0);
});
await test('bulk location route admits frozen per-place jobs once, ignoring fabricated estimate and never calling a provider',async()=>{
 const {p,d,place}=make();for(const stage of [0,2]){const item=p.items.find(i=>i.stage===stage),v=D.makeVariant(p,item,{kind:'text',text:stage===0?'Сказка у пруда.':'Книжная живопись.'});item.variants.push(v);item.selectedId=v.id;item.approvedId=v.id;}
 d.scenes=[{id:D.id(),title:'Встреча',purpose:'Чудо',location:'Пруд',locationIds:[place.id],conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:[]}];d.scenesApproved=R.scenesBasis(p);setup(p);
 const input={revision:p.revision,batchId:D.id(),model:'gpt-image-2.5-sunburst',itemIds:[place.id],count:2,estimate:'0'};
 const send=data=>generateLocations(new Request('http://localhost/generate-locations',{method:'POST',body:JSON.stringify(data)}),{params:Promise.resolve({id:p.id})});
 const response=await send(input);assert(response.ok);assert.equal(worldState.jobs.length,2);assert(worldState.jobs.every(j=>j.location.name==='Пруд'&&j.status==='queued'&&j.estimate===null&&j.versionInfo));assert.equal(worldCalls,0);
 const before=JSON.stringify(worldState);await send(input);assert.equal(JSON.stringify(worldState),before,'Repeated batch is idempotent even with old revision');
 await assert.rejects(send({...input,batchId:D.id()}),/изменился/);
 await assert.rejects(send({...input,batchId:D.id(),revision:worldState.revision}),/карточки/);
 worldUser='other';await assert.rejects(send(input),/Not found/);
});
await test('hero photo admission and locked constraints are preserved without paid requests',async()=>{
 const {p,hero}=make();hero.character.locked='Нельзя менять возраст, цвет глаз и лицо';setup(p);
 await assert.rejects(request('generateActor',{itemId:hero.id,model:'MiniMax-M2.7',instruction:'Описание',actorProfile:actor}),/фотограф|Неизвестная модель|Модель не найдена/);assert.equal(worldCalls,0);
 const ref=hero.character.refs[0];worldFiles.get(ref).owner='other';await assert.rejects(request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Описание',actorProfile:actor}),/Foreign project/);assert.equal(worldState.directing.runs.length,0);
 worldFiles.get(ref).owner='owner';await request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Описание',actorProfile:actor});assert(worldState.directing.runs[0].characterInput.prompt.includes(hero.character.locked));await runDirectorStep('owner',p.id);assert.equal(worldState.items.find(i=>i.id===hero.id).variants.at(-1).character.locked,hero.character.locked);
});
await test('character audio mode is optional, revision checked and never generates/deletes audio',async()=>{
 const {p}=make();setup(p);const items=structuredClone(worldState.items);
 for(const mode of ['design','catalog','nonverbal','skip']){const response=await voiceAction(new Request('http://localhost/voice',{method:'POST',body:JSON.stringify({revision:worldState.revision,action:'setCharacterAudioMode',data:{mode}})}),{params:Promise.resolve({id:p.id})});assert(response.ok);assert.equal(worldState.voiceStudio.characterAudioMode,mode);assert.equal(worldState.jobs.length,0);assert.deepEqual(worldState.items,items);}
 await assert.rejects(voiceAction(new Request('http://localhost/voice',{method:'POST',body:JSON.stringify({revision:-1,action:'setCharacterAudioMode',data:{mode:'design'}})}),{params:Promise.resolve({id:p.id})}),/изменился/);assert.equal(worldCalls,0);
});
const legacyActor=()=>{
 const {p,d,hero}=make(),script=p.items.find(item=>item.stage===0),text=D.makeVariant(p,script,{kind:'text',text:'Совсем другой сюжет: герой строит мост.'});script.variants.push(text);script.selectedId=script.approvedId=text.id;
 const input={itemId:hero.id,prompt:W.actorDraftPrompt(p,hero,'Сохрани лицо',actor),character:structuredClone(hero.character),actorProfile:actor,versionInfo:C.captureVersionInfo(p,hero,{}, {actorProfile:actor},'Агент героя')};
 const run={id:D.id(),created:D.now(),mode:'character',model:'gpt-6-astra',basis:R.signature(input),characterInput:input,sceneIds:[],tasks:[{id:D.id(),role:'actor-profile',requires:[]}],stopped:true};d.runs.push(run);
 assert.notEqual(run.basis,R.characterRunInputBasis(input),'Fixture must reproduce optional undefined keys lost by real JSON storage');setup(p);return {p,hero,run:worldState.directing.runs[0]};
};
await test('JSON storage keeps new actor fingerprint valid and dispatches exactly once',async()=>{
 const {p,hero}=make();setup(p);await request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Новый сюжет',actorProfile:actor});
 const run=worldState.directing.runs[0];assert.equal(run.basis,R.directorRunBasis(worldState,run));await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);assert(worldState.directing.runs[0].tasks[0].applied);assert(!worldState.directing.runs[0].stopped);await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);
});
await test('recognized unsent legacy run resumes same input once with revision/CAS and owned photo validation',async()=>{
 const {p,hero,run}=legacyActor(),input=structuredClone(run.characterInput),revision=worldState.revision;assert(R.isRecoverableUnsentCharacterRun(worldState,run));
 await assert.rejects(request('resumeActorRun',{itemId:hero.id,runId:run.id},revision-1),/изменился/);assert.equal(worldCalls,0);
 worldRace=true;await assert.rejects(request('resumeActorRun',{itemId:hero.id,runId:run.id}),/CAS conflict/);assert(worldState.directing.runs[0].stopped);
 worldFiles.get(hero.character.refs[0]).owner='foreign';await assert.rejects(request('resumeActorRun',{itemId:hero.id,runId:run.id}),/Foreign project/);assert(worldState.directing.runs[0].stopped);
 worldFiles.get(hero.character.refs[0]).owner='owner';await request('resumeActorRun',{itemId:hero.id,runId:run.id});assert.equal(worldCalls,0);assert.equal(worldState.jobs.length,0);assert.equal(worldState.directing.runs.length,1);assert.deepEqual(worldState.directing.runs[0].characterInput,input);assert(!worldState.directing.runs[0].stopped);
 await assert.rejects(request('resumeActorRun',{itemId:hero.id,runId:run.id}),/Продолжение недоступно/);await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);assert.equal(worldSent.prompt,input.prompt);assert.deepEqual(worldSent.refs,input.character.refs);assert(worldState.items.find(item=>item.id===hero.id).variants.at(-1).characterDraft);
 worldUser='foreign';await assert.rejects(request('resumeActorRun',{itemId:hero.id,runId:run.id}),/Not found/);
});
await test('recovery rejects manual stops, dispatched/unknown jobs, altered snapshots, deleted/changed heroes and duplicate active runs',async()=>{
 const changes=[
 ({run})=>run.tasks[0].error='Проработка остановлена.',
 ({run})=>run.tasks[0].jobId=D.id(),
 ({run})=>run.tasks[0].result={},
 ({run})=>run.tasks[0].applied=false,
 ({run})=>worldState.jobs.push({id:D.id(),batchId:run.id,status:'unknown'}),
 ({run})=>worldState.jobs.push({id:D.id(),batchId:run.id,status:'failed'}),
 ({run})=>run.characterInput.prompt+=' изменён',
 ({hero})=>worldState.items.find(item=>item.id===hero.id).character.description='Другое описание',
 ({hero})=>worldState.items.find(item=>item.id===hero.id).character.refs=[D.id()],
 ({hero})=>worldState.items.find(item=>item.id===hero.id).removedAt=D.now(),
 ({run})=>worldState.directing.runs.push({...structuredClone(run),id:D.id(),stopped:false,basis:R.characterRunInputBasis(run.characterInput)}),
 ];
 for(const change of changes){const fixture=legacyActor();change(fixture);assert(!R.isRecoverableUnsentCharacterRun(worldState,fixture.run));await assert.rejects(request('resumeActorRun',{itemId:fixture.hero.id,runId:fixture.run.id}),/Продолжение недоступно|не найден/);assert.equal(worldCalls,0);}
 const {run}=legacyActor(),other=D.newProject('Чужой фильм');assert(!R.isRecoverableUnsentCharacterRun(other,run));assert.throws(()=>R.resumeUnsentCharacterRun(worldState,run.id,D.id()),/Продолжение недоступно/);
});
for(const name of ['worldState','worldUser','worldOwner','worldFiles','worldCalls','worldSent','worldRelease','worldAssetChecks','worldCheckPristine','worldRace','worldHold','worldFailure','worldActorResult','worldRefData'])delete globalThis[name];
console.log(`PASS ${checks} world route/runner regression groups. Owned files mocked; no paid provider requests.`);
