import {build} from 'esbuild';import assert from 'node:assert/strict';
const server=`
import {projectAssetIds} from './lib/project-assets';
export const api=fn=>fn;
export const owner=async()=>globalThis.worldUser;
export const getKey=async()=> 'local-mock-key';
export async function loadProject(user,id){if(user!==globalThis.worldOwner||id!==globalThis.worldState.id)throw Object.assign(Error('Not found'),{status:404});return structuredClone(globalThis.worldState);}
export async function asset(user,id,p){
 globalThis.worldAssetChecks++;
 if(globalThis.worldCheckPristine)assertPristine(p);
 const row=globalThis.worldFiles.get(id);if(!row||row.owner!==user||row.project_id!==p.id&&!projectAssetIds(p).has(id))throw Object.assign(Error('Foreign project file'),{status:404});return row;
}
function assertPristine(p){if(JSON.stringify(p)!==JSON.stringify(globalThis.worldState))throw Error('Snapshot mutated before asset validation');}
export async function saveProject(user,p,expected){if(globalThis.worldRace){globalThis.worldState.revision++;globalThis.worldRace=false;}if(expected!==globalThis.worldState.revision)throw Object.assign(Error('CAS conflict'),{status:409});p.revision=expected+1;globalThis.worldState=structuredClone(p);return structuredClone(p);}
export async function mutate(user,id,fn){for(let n=0;n<10;n++){const p=await loadProject(user,id),revision=p.revision;fn(p);await Promise.resolve();try{return await saveProject(user,p,revision);}catch(e){if(e.status!==409||n===9)throw e;}}}
export const runtime={FILES:{},DB:{}};
export const imageData=async()=> {throw Error('Unexpected image retrieval');};
export const storeAsset=async()=> {throw Error('Unexpected media storage');};
`;
const provider=`export async function generate(job){globalThis.worldCalls++;globalThis.worldSent=structuredClone(job);if(globalThis.worldHold)await new Promise(resolve=>globalThis.worldRelease=resolve);if(globalThis.worldFailure)throw Error('Transport outcome unknown');return {text:JSON.stringify({appearance:'Голубые глаза',description:'Принимает решение вопреки страху.',actorProfile:globalThis.worldActorResult,notes:['Наблюдаемый выбор героя']}),requestId:'actor-receipt',actual:'250000000',usage:{input_tokens:120,output_tokens:80}};}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as W from './lib/world-assets';export {projectAssetIds} from './lib/project-assets';export {POST} from './app/api/projects/[id]/world/route';export {PATCH} from './app/api/projects/[id]/route';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/world-routes.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'world-mocks',setup(b){
 b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'world'}));b.onResolve({filter:/^\.\/providers$/},()=>({path:'provider',namespace:'world'}));b.onLoad({filter:/.*/,namespace:'world'},args=>({contents:args.path==='server'?server:provider,resolveDir:process.cwd()}));
}}]});
const {D,R,W,POST,PATCH,projectAssetIds,runDirectorStep}=await import('../work/tests/world-routes.mjs');
const actor={...W.emptyActorProfile(),identity:'Голубые глаза',role:'Главный герой',motivation:'Помочь другу',traits:[{name:'Гротеск',intensity:0,instruction:'Не усиливать'}]};
const make=()=>{const p=D.newProject('Постоянный мир'),d=R.ensureDirecting(p),hero=p.items.find(i=>i.stage===1),place=p.items.find(i=>i.stage===3);hero.character={name:'Младший',appearance:'Голубые глаза',description:'Добрый мальчик',instructions:'Сохранить внешность',refs:[D.id()],actorProfile:structuredClone(actor)};const image=D.makeVariant(p,hero,{kind:'image',assetId:D.id(),character:structuredClone(hero.character)});hero.variants.push(image);hero.selectedId=image.id;hero.approvedId=image.id;
 const profile={...W.emptyLocation('Пруд'),identity:'Овальный пруд',refs:[D.id()],approvedAngles:[{id:D.id(),name:'Берег',description:'Мост справа',refs:[D.id()]}]};place.location=structuredClone(profile);const old=D.makeVariant(p,place,{kind:'image',assetId:D.id(),location:structuredClone(profile)});place.variants.push(old);place.selectedId=old.id;place.approvedId=old.id;return {p,d,hero,place,image,old,profile};};
const setup=p=>{globalThis.worldState=structuredClone(p);globalThis.worldUser='owner';globalThis.worldOwner='owner';globalThis.worldFiles=new Map([...projectAssetIds(p)].map(id=>[id,{id,owner:'owner',project_id:p.id,mime:'image/png',size:100}]));globalThis.worldCalls=0;globalThis.worldRelease=undefined;globalThis.worldAssetChecks=0;globalThis.worldCheckPristine=false;globalThis.worldRace=false;globalThis.worldHold=false;globalThis.worldFailure=false;globalThis.worldActorResult=structuredClone(actor);};
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
 assert.equal(worldSent.prompt,input.prompt);assert.deepEqual(job.versionInfo,input.versionInfo);assert.equal(job.actual,'250000000');assert.equal(job.requestId,'actor-receipt');assert.equal(job.status,'done');assert(candidate.characterDraft);assert.deepEqual(candidate.character.refs,input.character.refs);assert.equal(item.approvedId,image.id);assert.equal(worldState.items.find(i=>i.id===hero.id).selectedId,image.id);assert(!D.visibleVariants(worldState.items.find(i=>i.id===hero.id)).some(v=>v.id===candidate.id));
 await request('chooseActorDraft',{itemId:hero.id,variantId:candidate.id});assert.equal(worldState.items.find(i=>i.id===hero.id).character.description,candidate.character.description);assert.equal(worldState.items.find(i=>i.id===hero.id).approvedId,image.id);await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);
});
await test('unknown actor request is retained with no automatic paid retry',async()=>{
 const {p,hero}=make();setup(p);await request('generateActor',{itemId:hero.id,model:'gpt-6-astra',instruction:'Проработай героя',actorProfile:actor});worldFailure=true;await runDirectorStep('owner',p.id);assert.equal(worldState.jobs[0].status,'unknown');await runDirectorStep('owner',p.id);assert.equal(worldCalls,1);assert.equal(worldState.items.find(i=>i.id===hero.id).variants.length,1);
});
for(const name of ['worldState','worldUser','worldOwner','worldFiles','worldCalls','worldSent','worldRelease','worldAssetChecks','worldCheckPristine','worldRace','worldHold','worldFailure','worldActorResult'])delete globalThis[name];
console.log(`PASS ${checks} world route/runner regression groups. Owned files mocked; no paid provider requests.`);
