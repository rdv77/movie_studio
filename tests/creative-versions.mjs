import {build} from 'esbuild';
import {strict as A} from 'node:assert';
const server=`export const owner=async()=> 'owner';export const getKey=async()=> 'fake';export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(u,p,revision)=>{if(revision!==globalThis.state.revision)throw Error('Revision');p.revision++;globalThis.state=p;return p;};export const mutate=async()=>{throw Error('No generation');};export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx);}catch(e){return Response.json({error:e.message},{status:400});}};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/creative-versions';export * as B from './lib/material-basis';export * as R from './lib/directing';export * as S from './lib/shots';export * as P from './lib/plan-sync';export {POST} from './app/api/projects/[id]/directing/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/creative-versions.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'mock',setup(b){b.onResolve({filter:/^(?:@\/lib|\.)\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,C,B,R,S,P,POST}=await import('../work/tests/creative-versions.mjs');
const p=D.newProject('Версии без потери фильма'),d=R.ensureDirecting(p);
function approve(item,data){const v=D.makeVariant(p,item,data);item.variants.push(v);item.selectedId=v.id;item.approvedId=v.id;return v;}
function card(stage,title){const i={id:D.id(),stage,title,variants:[]};p.items.push(i);return i;}
approve(p.items.find(i=>i.stage===0),{text:'Анна и Борис встречаются у пруда.'});
const anna=p.items.find(i=>i.stage===1),boris=card(1,'Борис');anna.title='Анна';
const profile=name=>({name,appearance:name==='Анна'?'Чёрные волосы':'Светлые волосы',description:'Спокойный герой',instructions:'Книжная анимация',refs:[D.id()]});
for(const i of [anna,boris]){i.character=profile(i.title);approve(i,{kind:'image',assetId:D.id(),character:structuredClone(i.character),text:i.title});}
const style=p.items.find(i=>i.stage===2);approve(style,{text:'Мягкая живопись, тёплый свет.'});
const pond=p.items.find(i=>i.stage===3),yard=card(3,'Двор');pond.title='Пруд';
for(const i of [pond,yard])approve(i,{kind:'image',assetId:D.id(),text:i.title+' · книжная иллюстрация'});
const shot=(name,n)=>({id:D.id(),title:'План '+n,duration:5,cast:[name],characterIds:[name==='Анна'?anna.id:boris.id],story:name+' поднимает письмо',stateIn:'Письмо на столе',stateOut:'Письмо в руке',cinematography:'Крупный план',productionDesign:'Тёплый свет',dialogue:{speechType:n===1?'character':'voiceover',speaker:n===1?'Анна':'Рассказчик',text:'Я вернусь.',delivery:'Тихо'},continuityChanges:'',approvalVersion:2});
const scene={id:D.id(),title:'Письмо',purpose:'Сделать выбор',location:'Пруд',locationIds:[pond.id],conflict:'Страх',turn:'Решение',stateIn:'У пруда',stateOut:'Уход',continuity:[{character:'Анна',characterId:anna.id,outfit:'Синий плащ',props:'Письмо'},{character:'Борис',characterId:boris.id,outfit:'Красный плащ',props:'Чашка'}],shots:[shot('Анна',1),shot('Борис',2),shot('Анна',3)]};
d.scenes=[scene];d.scenesApproved=R.scenesBasis(p);d.editorBasis=R.editorBasis(p);
for(const s of scene.shots){s.approved=R.shotApproval(scene,s);s.approvedFoundation=R.shotFoundationBasis(p,scene,s);}
const exported=R.directorExport(p);const script=p.items.find(i=>i.stage===4);approve(script,{text:JSON.stringify(exported)});
const parsed=S.parseShots(script.variants[0].text,p.seconds);
A.equal(parsed[0].stateIn,'Письмо на столе');A.deepEqual(parsed[0].characterIds,[anna.id]);A.deepEqual(parsed[0].locationIds,[pond.id]);A.equal(parsed[0].dialogueDelivery,'Тихо');A.equal(parsed[0].sceneContinuity[0].characterId,anna.id);
const frames=parsed.map((s,n)=>{const i=n?card(5,s.title):p.items.find(i=>i.stage===5);i.title=s.title;i.sourceShot={scriptId:script.id,scriptVersion:script.approvedId,title:s.title,shotId:s.id,sceneId:scene.id};approve(i,{kind:'image',assetId:D.id(),text:'Кадр '+n,refs:[anna.variants[0].assetId]});return i;});
p.storyboardOrder=frames.map(i=>i.id);
const audio=p.items.find(i=>i.stage===6),video=p.items.find(i=>i.stage===7);for(const i of [audio,video]){i.title=frames[0].title;i.sourceShot={...frames[0].sourceShot};}
const av=approve(audio,{kind:'audio',assetId:D.id(),dialogue:'Я вернусь.'});
const vv=approve(video,{kind:'video',assetId:D.id(),refs:[frames[0].variants[0].assetId],characterIds:[anna.id]});
const fv=frames[0].variants[0];
A.equal(fv.basisVersion,2);A.equal(D.variantCurrent(p,frames[0],fv),true);A.equal(D.variantCurrent(p,video,vv),true);
const basis=(i,v)=>B.materialBasis(p,i,v),imageBefore=basis(frames[0],fv),audioBefore=basis(audio,av),videoBefore=basis(video,vv);
function editScript(fn){const x=JSON.parse(script.variants[0].text);fn(x.shots);script.variants[0].text=JSON.stringify(x);}
editScript(shots=>shots[0].dialogue='Я обязательно вернусь.');
A.equal(basis(frames[0],fv),imageBefore,'Voice text does not invalidate images');A.equal(basis(video,vv),videoBefore,'Voice text does not invalidate unsynchronised video');A.notEqual(basis(audio,av),audioBefore,'Speech tracks its exact words');
editScript(shots=>shots[0].dialogue='Я вернусь.');
boris.variants[0].character.appearance='Рыжие волосы';A.equal(basis(frames[0],fv),imageBefore,'An absent hero is independent');boris.variants[0].character.appearance='Светлые волосы';
yard.variants[0].text='Новый двор';A.equal(basis(frames[0],fv),imageBefore,'Unrelated locations are independent');
pond.variants[0].text='Пруд с каменным мостом';A.notEqual(basis(frames[0],fv),imageBefore,'Linked location changes are reviewed');pond.variants[0].text='Пруд · книжная иллюстрация';
anna.variants[0].character.appearance='Другой костюм';A.notEqual(basis(frames[0],fv),imageBefore);A.equal(basis(audio,av),audioBefore,'Wardrobe never invalidates speech');anna.variants[0].character.appearance='Чёрные волосы';
p.hiddenReferenceIds=[anna.variants[0].assetId,frames[0].variants[0].assetId];A.equal(basis(frames[0],fv),imageBefore);A.equal(basis(video,vv),videoBefore,'Hiding refs affects future series only');
editScript(shots=>shots[1].dialogue='Изменение соседней реплики');A.equal(basis(video,vv),videoBefore);editScript(shots=>shots[1].stateIn='Письмо уже в кармане');A.notEqual(basis(video,vv),videoBefore,'Video tracks neighbouring entry state');
editScript(shots=>{shots[1].dialogue='Я вернусь.';shots[1].stateIn='Письмо на столе';});
p.storyboardOrder=[frames[0].id,frames[2].id,frames[1].id];A.notEqual(basis(video,vv),videoBefore,'Actual montage order defines neighbours');A.equal(basis(frames[0],fv),imageBefore);p.storyboardOrder=frames.map(i=>i.id);
const alt=approve(frames[0],{kind:'image',assetId:D.id(),text:'Альтернатива'});
const pinned=D.makeVariant(p,video,{kind:'video',assetId:D.id(),refs:[fv.assetId]});const pinnedBasis=basis(video,pinned);
A.equal(pinned.versionInfo.sources.find(s=>s.role==='frame').followApproval,false);
approve(frames[0],{kind:'image',assetId:D.id(),text:'Новый выбранный кадр'});A.equal(basis(video,pinned),pinnedBasis,'Explicit alternate input stays pinned');A.notEqual(basis(video,vv),videoBefore,'Automatic approved frame follows its card');
frames[0].approvedId=fv.id;frames[0].selectedId=fv.id;
const legacy=D.makeVariant(p,frames[0],{kind:'image',assetId:D.id(),reviewBasis:B.materialBasis(p,frames[0])});
A.equal(legacy.basisVersion,undefined);A.equal(D.variantCurrent(p,frames[0],legacy),true);
yard.variants[0].text='Изменённый двор';A.equal(D.variantCurrent(p,frames[0],legacy),false,'Legacy semantics remain unchanged');yard.variants[0].text='Новый двор';
const queued={id:D.id(),itemId:frames[0].id,kind:'image',model:'grok-imagine-image-2.0',refs:[fv.assetId],characterIds:[anna.id],status:'queued',deps:D.dependencies(p,5),imageSettings:{quality:'medium',resolution:'2k'}};
C.stampGenerationVersions(p,[queued]);const qInfo=structuredClone(queued.versionInfo);A.equal(queued.basisVersion,2);A(D.jobCurrent(p,frames[0],queued));
frames[0].selectedId=alt.id;A.deepEqual(queued.versionInfo,qInfo,'Queued parent and sources are frozen');A.equal(queued.versionInfo.parentVariantId,fv.id);
const settingsBefore=C.creativeSnapshot(p),baseline=C.recordCreativeVersion(p,'baseline');A.equal(C.recordCreativeVersion(p,'no-change').id,baseline.id);
d.brief.genre='Комедия';d.scenes[0].shots[0].story='Анна роняет письмо';const changed=C.recordCreativeVersion(p,'edit');A.equal(changed.parentId,baseline.id);
p.jobs=[{id:D.id(),status:'done',actual:'900000000',requestId:'paid'}];p.mediaDurations={[fv.assetId]:5};p.assemblyCuts=[{itemId:video.id,variantId:vv.id,trim:0,duration:null}];p.items.push({id:D.id(),stage:5,title:'Исключённый',variants:[],excludedAt:new Date().toISOString(),planArchive:{reason:'excluded'}});
const preserved=structuredClone({jobs:p.jobs,media:p.mediaDurations,cuts:p.assemblyCuts,items:p.items});
const restored=C.restoreCreativeVersion(p,baseline.id);A.equal(restored.parentId,changed.id);A.equal(restored.restoredFromId,baseline.id);A.notEqual(restored.id,baseline.id);
A.deepEqual(C.creativeSnapshot(p),settingsBefore);A.deepEqual({jobs:p.jobs,media:p.mediaDurations,cuts:p.assemblyCuts,items:p.items},preserved,'Restoring creative text preserves paid media and montage');A.equal(d.editorBasis,undefined);
const originalScene=structuredClone(d.scenes[0]);d.scenes.push({...structuredClone(originalScene),id:D.id(),title:'Независимая сцена',shots:[]});
const extraSceneId=d.scenes.at(-1).id;C.recordCreativeVersion(p,'with extra scene');d.scenes[0].purpose='Изменённая задача';
const branch=C.restoreSceneVersion(p,baseline.id,originalScene.id);A.equal(d.scenes[0].purpose,originalScene.purpose);A.equal(d.scenes.at(-1).id,extraSceneId,'Choosing one scene preserves other scenes');A.equal(branch.parentId,p.creativeHistory.at(-2).id);A.equal(d.scenesApproved,undefined);A.deepEqual(p.jobs,preserved.jobs);
d.scenes.pop();d.scenesApproved=settingsBefore.scenesApproved;
const heroFirst=C.recordCharacterVersion(anna,'baseline');anna.character.appearance='Светлые волосы';const heroChanged=C.recordCharacterVersion(anna,'edit');const heroRestored=C.restoreCharacterVersion(anna,heroFirst.id);
A.equal(heroRestored.parentId,heroChanged.id);A.equal(heroRestored.restoredFromId,heroFirst.id);A.equal(anna.character.appearance,'Чёрные волосы');A.equal(anna.approvedId,anna.variants[0].id,'Profile restoration does not approve or replace an image');
const aShot=d.scenes[0].shots[0],bShot=d.scenes[0].shots[1];A(R.shotApproved(d.scenes[0],aShot,p));
boris.variants[0].character.appearance='Новый Борис';A(R.shotApproved(d.scenes[0],aShot,p),'Other hero preserves shot approval');A(!R.shotApproved(d.scenes[0],bShot,p));boris.variants[0].character.appearance='Светлые волосы';
const promptBasis=R.shotPromptBasis(p,d.scenes[0],aShot);yard.variants[0].text='Ещё другой двор';A.equal(R.shotPromptBasis(p,d.scenes[0],aShot),promptBasis,'Unused locations preserve prepared prompts');
const old=structuredClone(p);delete old.creativeHistory;delete old.creativeVersionId;for(const i of old.items){delete i.characterHistory;delete i.characterVersionId;for(const v of i.variants){delete v.basisVersion;delete v.versionInfo;}}const oldBefore=JSON.stringify(old);A.deepEqual(JSON.parse(JSON.stringify(old)),JSON.parse(oldBefore));A.equal(JSON.stringify(old),oldBefore,'Reading a legacy fixture makes no migration or approval reset');
// A manually reviewed old shot migrates only when the director approves it.
const oldShot=old.directing.scenes[0].shots[0];delete oldShot.approvalVersion;delete oldShot.characterIds;delete oldShot.locationIds;
oldShot.approved=R.shotApproval(old.directing.scenes[0],oldShot);oldShot.approvedFoundation=R.directorBasis(old);old.directing.editorBasis=R.editorBasis(old);
const sceneStructureApproval=old.directing.scenesApproved;globalThis.state=old;
const res=await POST(new Request('http://localhost/api/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'approveShots',revision:state.revision,data:{ids:[oldShot.id]}})}),{params:Promise.resolve({id:old.id})});
A.equal(res.status,200,await res.clone().text());const migrated=state.directing.scenes[0].shots[0];A.equal(migrated.approvalVersion,2);A.deepEqual(migrated.characterIds,[anna.id]);A.deepEqual(migrated.locationIds,[pond.id]);A(R.shotApproved(state.directing.scenes[0],migrated,state));A.equal(state.directing.scenesApproved,sceneStructureApproval);A.equal(state.directing.editorBasis,R.editorBasis(state),'Binding IDs preserves an already current editor check');
console.log('PASS creative branches and restore; immutable queued provenance; selective image/voice/video sources and neighbours; actual frame provenance; stable IDs and legacy approval compatibility. No paid requests.');
