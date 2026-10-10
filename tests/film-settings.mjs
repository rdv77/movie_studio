import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as F from './lib/film-settings';export * as D from './lib/domain';export * as R from './lib/directing';export * as T from './lib/runtime-policy';export * as K from './lib/keyframes';export * as P from './lib/shot-planning';export * as A from './lib/animatic';export * as M from './lib/animatic-manifest';export * as V from './lib/video-from-animatic';export * as B from './lib/video-preparation-basis';export {editPlan} from './lib/render';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/film-settings.mjs',external:['@ffmpeg/ffmpeg']});
const {F,D,R,T,K,P,A,M,V,B,editPlan}=await import('../work/tests/film-settings.mjs');
let passed=0;const test=(name,fn)=>{fn();console.log('PASS '+name);passed++;};
const settings=(p,extra={})=>({title:p.title,format:p.format,seconds:p.seconds,limit:p.limit,...extra});
function fixture(){
  const p=D.newProject('Настройки'),d=R.ensureDirecting(p);
  for(const item of p.items){const v=D.makeVariant(p,item,{kind:'text',title:item.title,text:'Герой замечает стрелу'});item.variants=[v];item.selectedId=v.id;item.approvedId=v.id;}
  const shot={id:D.id(),title:'Реакция',duration:6,cast:[],story:'Герой удивляется',stateIn:'Ожидание',stateOut:'Удивление',cinematography:'Крупный план',productionDesign:'Дневной свет',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:''};
  const scene={id:D.id(),title:'Встреча',purpose:'Реакция',location:'Берег',conflict:'Неожиданность',turn:'Удивление',stateIn:'Ожидание',stateOut:'Удивление',continuity:[],shots:[shot]};
  d.scenes=[scene];d.scenesApproved=R.scenesBasis(p);
  shot.approved=R.shotApproval(scene,shot);shot.approvedFoundation=R.directorApprovalBasis(p);shot.promptBasis=R.shotPromptBasis(p,scene,shot);
  P.ensureShotPlanning(p);P.approvePlanSets(p,[scene.id]);d.editorBasis=R.editorBasis(p);d.patchesBasis=d.editorBasis;
  return p;
}
function movieFixture(){
  const p=fixture();p.productionOrder='video-first';p.speechMode='plans';p.animaticSettings={sound:'silent',music:false,motion:false};
  const script=p.items.find(i=>i.stage===4),shot={id:'shot-1',title:'Реакция',duration:6,description:'Герой замечает стрелу',camera:'Крупный план',productionDesign:'Дневной свет',stateIn:'Ждёт',stateOut:'Удивляется',continuityChanges:'',continuity:'Прямая склейка',speechType:'none',dialogue:'',cast:[]};
  script.variants[0].text=JSON.stringify({timingMode:'actual',shots:[shot]});const frame=p.items.find(i=>i.stage===5);frame.sourceShot={scriptId:script.id,shotId:shot.id,title:shot.title};Object.assign(frame.variants[0],{kind:'image',assetId:D.id(),duration:6,deps:D.dependencies(p,5)});
  const plan=editPlan(p,true),basis=A.animaticBasis(p),manifest=M.buildAnimaticManifest(p,plan,basis),preview=A.saveAnimatic(p,{kind:'video',assetId:D.id(),duration:6,animaticManifest:manifest},basis);A.approveAnimatic(p,preview.id);V.prepareVideosFromAnimatic(p,preview.id);
  const video=p.items.find(i=>i.stage===7&&i.sourceShot?.shotId===shot.id);delete video.videoPreparation.shotBasis;delete video.videoPreparation.sourceFrames;delete video.videoPreparation.sourceDuration;
  const request={model:'grok-imagine-video-1.5',refs:[video.videoPreparation.startFrame.assetId]};
  const legacy=D.makeVariant(p,video,{kind:'video',assetId:D.id(),duration:6,...request,videoPreparationBasis:B.legacyPreparationSignature(video.videoPreparation)}),modern=D.makeVariant(p,video,{kind:'video',assetId:D.id(),duration:6,...request,videoPreparationBasis:B.captureVideoPreparationBasis(p,video,request)});video.variants.push(legacy,modern);video.selectedId=video.approvedId=legacy.id;
  assert.equal(V.videoPreparationIssue(p,video),'');assert(B.videoPreparationCurrent(p,video,legacy));assert(B.videoPreparationCurrent(p,video,modern));return {p,preview,video,legacy,modern};
}
test('no-op and rename preserve stored settings, approvals and history',()=>{
  const p=fixture(),before=structuredClone(p);F.applyFilmSettings(p,settings(p));assert.deepEqual(p,before);
  F.applyFilmSettings(p,settings(p,{title:'Переименованный фильм'}));assert.equal(p.title,'Переименованный фильм');assert.deepEqual(p.items,before.items);assert.deepEqual(p.directing,before.directing);assert.equal(p.configVersion,before.configVersion);assert.equal(p.creativeHistory,undefined);
});
test('new settings UI does not initialize directing on an unchanged legacy film',()=>{
  const p=D.newProject('Прежний фильм'),before=structuredClone(p);F.applyFilmSettings(p,settings(p,{durationMode:'free',productionOrder:'voice-first',framePolicy:''}));assert.deepEqual(p,before);
});
test('free decimal target preserves approved scenes, plans and reviewed materials',()=>{
  const p=fixture(),old=structuredClone(p);F.applyFilmSettings(p,settings(p,{seconds:64.17,durationMode:'free'}));
  assert.equal(p.seconds,64.17);assert.equal(p.directing.brief.targetSeconds,64.17);assert.equal(p.configVersion,old.configVersion);assert.deepEqual(p.items,old.items);
  assert.equal(p.directing.scenesApproved,R.scenesBasis(p));const scene=p.directing.scenes[0];assert(R.shotApproved(scene,scene.shots[0],p));assert(P.planSetApproved(p,scene));assert.equal(scene.shots[0].promptBasis,R.shotPromptBasis(p,scene,scene.shots[0]));assert.equal(p.directing.editorBasis,R.editorBasis(p));assert.equal(p.directing.patchesBasis,R.editorBasis(p));assert.equal(p.creativeHistory.length,1);
});
test('free target never approves previously stale scene or plan',()=>{
  const p=fixture(),d=p.directing;d.scenesApproved='stale';d.scenes[0].shots[0].approvedFoundation='stale';d.scenes[0].shots[0].promptBasis='stale';d.shotPlanning.scenes[0].approved='stale';d.editorBasis='stale';
  F.applyFilmSettings(p,settings(p,{seconds:90,durationMode:'free'}));assert.equal(p.directing.scenesApproved,'stale');assert.equal(p.directing.scenes[0].shots[0].approvedFoundation,'stale');assert.equal(p.directing.scenes[0].shots[0].promptBasis,'stale');assert.equal(p.directing.shotPlanning.scenes[0].approved,'stale');assert.equal(p.directing.editorBasis,'stale');
});
test('combined target and frame-policy change does not re-sign reviewed scenes',()=>{
  const p=fixture(),before=structuredClone(p.directing);F.applyFilmSettings(p,settings(p,{seconds:90,durationMode:'free',framePolicy:'pair'}));
  assert.equal(p.directing.scenesApproved,before.scenesApproved);assert.notEqual(p.directing.scenesApproved,R.scenesBasis(p));assert.equal(p.directing.scenes[0].shots[0].approvedFoundation,before.scenes[0].shots[0].approvedFoundation);assert.equal(p.directing.shotPlanning.scenes[0].approved,before.shotPlanning.scenes[0].approved);assert.equal(p.directing.editorBasis,before.editorBasis);
});
test('runtime switches retain strict limits and normalize only runtime issues',()=>{
  const p=fixture();p.directing.issues=[{id:'target',category:'runtime_target',severity:'note',resolved:true,message:'Длиннее ориентира'},{id:'metadata',category:'runtime_metadata',severity:'conflict',message:'Старое время'},{id:'speech',category:'speech_fit',severity:'conflict',message:'Речь не помещается'}];p.directing.acceptedRuntime={seconds:6,basis:T.runtimeAcceptanceBasis(p)};
  F.applyFilmSettings(p,settings(p,{seconds:20,durationMode:'strict'}));assert.equal(T.runtimeLimit(p),20);assert.throws(()=>T.checkRuntime(21,T.runtimeLimit(p)),/Строгий/);assert.deepEqual(p.directing.issues.map(i=>i.severity),['conflict','note','conflict']);assert.equal(p.directing.issues[0].resolved,false);assert.equal(p.directing.editorBasis,undefined);assert.equal(p.directing.acceptedRuntime,undefined);
  F.applyFilmSettings(p,settings(p,{durationMode:'free'}));assert.equal(T.runtimeLimit(p),undefined);assert.doesNotThrow(()=>T.checkRuntime(200,T.runtimeLimit(p)));assert.deepEqual(p.directing.issues.map(i=>i.severity),['note','note','conflict']);
});
test('frame policy freezes existing image sets and explicit empty value restores legacy policy',()=>{
  const p=fixture(),frame=p.items.find(i=>i.stage===5);frame.variants[0].kind='image';frame.variants[0].assetId=D.id();p.directing.brief.framePolicy='pair';
  assert.equal(K.planKeyframeMode(p,frame),'pair');F.applyFilmSettings(p,settings(p,{framePolicy:'single'}));let updated=p.items.find(i=>i.id===frame.id);assert.equal(updated.keyframePolicy,'pair');assert.equal(K.planKeyframeMode(p,updated),'pair');assert.equal(p.directing.brief.framePolicy,'single');
  F.applyFilmSettings(p,settings(p,{framePolicy:''}));assert.equal(p.directing.brief.framePolicy,undefined);updated=p.items.find(i=>i.id===frame.id);assert.equal(K.planKeyframeMode(p,updated),'pair');
});
test('technical saves preserve creative fields and omitted optional settings',()=>{
  const p=fixture();Object.assign(p.directing.brief,{genre:'Хоррор',audience:'Взрослые',locked:'Не менять героя',cameraPolicy:'dynamic',framePolicy:'auto'});p.productionOrder='video-first';p.directing.durationMode='strict';const before=structuredClone(p.directing.brief);
  F.applyFilmSettings(p,settings(p,{seconds:80}));assert.deepEqual(p.directing.brief,{...before,targetSeconds:80});assert.equal(p.productionOrder,'video-first');assert.equal(p.directing.durationMode,'strict');
  F.applyFilmSettings(p,settings(p,{seconds:90,durationMode:'free',productionOrder:'voice-first',framePolicy:'pair'}));assert.deepEqual(p.directing.brief,{...before,targetSeconds:90,framePolicy:'pair'});
});
test('rejected active production-order change is atomic',()=>{
  const p=fixture();p.jobs.push({id:D.id(),status:'pending',kind:'video',itemId:p.items.find(i=>i.stage===7).id});const before=structuredClone(p);
  assert.throws(()=>F.applyFilmSettings(p,settings(p,{title:'Не сохранять',seconds:99,productionOrder:'video-first',framePolicy:'pair'})),/Дождитесь текущих генераций/);assert.deepEqual(p,before);
});
test('format still invalidates dependency snapshots; new UI bounds and legacy duration remain compatible',()=>{
  const p=fixture(),before=structuredClone(p);F.applyFilmSettings(p,settings(p,{format:'9:16'}));assert.equal(p.configVersion,before.configVersion+1);assert.notEqual(p.items[0].variants[0].deps,D.dependencies(p,0));
  const valid=structuredClone(p);for(const seconds of [9,3601,NaN]){assert.throws(()=>F.applyFilmSettings(p,settings(p,{seconds,durationMode:'free'})));assert.deepEqual(p,valid);}
  const legacy=D.newProject('Старый короткий фильм');F.applyFilmSettings(legacy,settings(legacy,{seconds:5}));assert.equal(legacy.seconds,5);assert.equal(legacy.directing.brief.targetSeconds,10);
});
test('free target retains a valid animatic, its manifest and already paid legacy/modern video bases',()=>{
  const {p,preview,video,legacy,modern}=movieFixture(),old=structuredClone(p),beforePlan=editPlan(p,true);
  const stale={...structuredClone(preview),id:D.id(),animaticBasis:'stale'},invalid={...structuredClone(preview),id:D.id(),animaticManifest:{...structuredClone(preview.animaticManifest),seconds:999}};p.animatic.variants.push(stale,invalid);
  F.applyFilmSettings(p,settings(p,{seconds:120,durationMode:'free'}));assert.deepEqual(editPlan(p,true),beforePlan);assert(A.animaticApproved(p));assert.equal(p.animatic.approvedId,preview.id);assert.equal(V.selectedAnimaticManifest(p).manifest.basis,A.animaticBasis(p));
  const updated=p.items.find(i=>i.id===video.id);assert.equal(V.videoPreparationIssue(p,updated),'');assert(B.videoPreparationCurrent(p,updated,legacy));assert(B.videoPreparationCurrent(p,updated,modern));assert.deepEqual(updated.variants,old.items.find(i=>i.id===video.id).variants);assert.deepEqual(p.jobs,old.jobs);
  assert.deepEqual(p.animatic.variants.find(v=>v.id===stale.id),stale);assert.deepEqual(p.animatic.variants.find(v=>v.id===invalid.id),invalid);
});
test('legacy seconds/brief mismatch can be aligned without rebuilding a current animatic',()=>{
  const {p,preview}=movieFixture();p.directing.brief.targetSeconds=120;assert.equal(p.seconds,50);assert(A.animaticApproved(p));F.applyFilmSettings(p,settings(p,{seconds:120,durationMode:'free'}));assert(A.animaticApproved(p));assert.equal(p.animatic.approvedId,preview.id);assert.equal(V.selectedAnimaticManifest(p).manifest.seconds,6);
});
test('stale sources and invalid video preparation are never blessed by timing edits',()=>{
  const {p,video}=movieFixture();video.videoPreparation.manifestBasis='invalid';const invalidPreparation=structuredClone(video.videoPreparation);F.applyFilmSettings(p,settings(p,{seconds:80,durationMode:'free'}));assert.deepEqual(p.items.find(i=>i.id===video.id).videoPreparation,invalidPreparation);assert(V.videoPreparationIssue(p,p.items.find(i=>i.id===video.id)));
  const before=structuredClone(p.animatic);p.items.find(i=>i.stage===5).variants[0].duration=7;F.applyFilmSettings(p,settings(p,{seconds:100,durationMode:'free'}));assert.deepEqual(p.animatic,before);assert(!A.animaticApproved(p));
});
console.log(`${passed} film settings tests passed; no provider calls.`);
