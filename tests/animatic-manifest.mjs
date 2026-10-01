import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as M from './lib/animatic-manifest';export * as S from './lib/soundscape';export {projectAssetIds} from './lib/project-assets';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/animatic-manifest.mjs'});
const {D,K,M,S,ensureDirecting,projectAssetIds}=await import('../work/tests/animatic-manifest.mjs');
const p=D.newProject('Манифест');ensureDirecting(p);
const shot={id:'s1',title:'План 01',description:'Корона открыта',duration:5,camera:'Наезд',continuity:'Не менять реквизит',speechType:'none',dialogue:'',stateIn:'Камыш скрывает корону',stateOut:'Корона видна',direction:{framingStart:'wide',framingEnd:'close-up',startFrame:'Общий вид',endFrame:'Корона',timing:{endingHold:2},cameraMovement:{type:'push-in',description:'Небольшой наезд'}}};
for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{kind:'text',text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Основа'});D.approve(p,item.id);}
const item=p.items.find(i=>i.stage===5);item.title=shot.title;item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:shot.title,shotId:shot.id};
const first=D.makeVariant(p,item,{kind:'image',assetId:'first',model:'grok-imagine-image-2.0'});item.variants.push(first);item.selectedId=first.id;K.setKeyframeMode(p,item.id,'pair');
const data=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model});const last=D.makeVariant(p,item,{...data,kind:'image',assetId:'last',model:first.model});item.variants.push(last);K.chooseKeyframe(p,item.id,'end',last.id);
const frames=M.frameSchedule(p,item,5);assert.deepEqual(frames.map(f=>[f.role,f.at,f.duration,f.assetId]),[['start',0,3,'first'],['end',3,2,'last']]);assert.equal(frames.reduce((s,f)=>s+f.duration,0),5);
const plan={clips:[{...first,duration:5}],audio:[],seconds:5};const manifest=M.buildAnimaticManifest(p,plan,'input-basis');assert.deepEqual(M.validateAnimaticManifest(p,manifest,'input-basis'),manifest);assert.deepEqual(M.manifestAssets(manifest),['first','last']);
const old=structuredClone(manifest);last.assetId='new-last';assert.throws(()=>M.validateAnimaticManifest(p,manifest,'input-basis'),/Ключевые кадры/);assert.equal(old.clips[0].frames[1].assetId,'last');last.assetId='last';
const wrong=structuredClone(manifest);wrong.projectId='other';assert.throws(()=>M.validateAnimaticManifest(p,wrong,'input-basis'),/другой версии/);
const order=structuredClone(manifest);order.clips[0].itemId='other-plan';assert.throws(()=>M.validateAnimaticManifest(p,order,'input-basis'),/Порядок/);
// Soundscape sources use the measured assembly timeline, selected approved
// files and every delivery setting, rather than the initial film-duration brief.
const soundProject=structuredClone(p),soundItem=soundProject.items.find(i=>i.id===item.id);
soundItem.sourceShot.sceneId='scene-1';soundProject.directing.scenes=[{id:'scene-1',shots:[shot]}];soundProject.animaticSettings={sound:'silent',music:true};S.soundscape(soundProject).enabled=true;
const addSound=(name,scope,settings)=>{const layer=S.saveSoundLayer(soundProject,{name,kind:'ambience',scope,settings}),v={id:D.id(),assetId:D.id(),model:'Uploaded',created:D.now(),mime:'audio/wav',prompt:'',seconds:2};layer.variants.push(v);S.chooseSoundVariant(soundProject,layer.id,v.id);S.approveSoundLayer(soundProject,layer.id);return layer;};
const ambience=addSound('Атмосфера',{type:'film'},{loop:true,offset:.25,trim:.2,volume:.4,speechVolume:.05,fadeIn:.1,fadeOut:.2});
const accent=addSound('Акцент',{type:'plan',itemId:soundItem.id},{loop:false,offset:1.25,trim:.2,duration:.5,volume:.5,speechVolume:.08});
const sceneSound=addSound('Сцена',{type:'scene',sceneId:'scene-1'},{loop:true,volume:.25,speechVolume:.03});
const soundPlan={...plan,clips:[{...first,duration:6}],seconds:6},soundTimeline={seconds:6,clips:[{itemId:soundItem.id,shotId:shot.id,sceneId:'scene-1',offset:0,duration:6}]};
soundPlan.soundscape=S.buildSoundscapeMix(soundProject,soundTimeline);
const soundManifest=M.buildAnimaticManifest(soundProject,soundPlan,'sound-input-basis'),frozenSoundProject=structuredClone(soundProject);
assert.deepEqual(M.validateAnimaticManifest(soundProject,soundManifest,'sound-input-basis'),soundManifest);assert.equal(soundManifest.seconds,6);assert.equal(soundProject.seconds,50);
assert.deepEqual(soundManifest.soundscape.map(s=>[s.layerId,s.start,s.duration,s.trim]),[[ambience.id,.25,5.75,.2],[accent.id,1.25,.5,.2],[sceneSound.id,0,6,0]]);
assert.deepEqual(new Set(M.manifestAssets(soundManifest)),new Set(['first','last',...soundPlan.soundscape.map(s=>s.assetId)]));
for(const [field,value] of [['assetId',D.id()],['variantId',D.id()],['volume',.9],['speechVolume',.7],['loop',false],['trim',.3],['start',.5],['duration',5],['fadeIn',.4],['duckSpeech',false]]){
 const tampered=structuredClone(soundManifest);tampered.soundscape[0][field]=value;assert.throws(()=>M.validateAnimaticManifest(soundProject,tampered,'sound-input-basis'),/Звуковые слои/,field);assert.deepEqual(soundProject,frozenSoundProject);
}
const missingSounds=structuredClone(soundManifest);delete missingSounds.soundscape;assert.throws(()=>M.validateAnimaticManifest(soundProject,missingSounds,'sound-input-basis'),/Звуковые слои/);
const wrongScene=structuredClone(soundManifest);wrongScene.clips[0].sceneId='foreign-scene';assert.throws(()=>M.validateAnimaticManifest(soundProject,wrongScene,'sound-input-basis'),/Порядок/);
const changedSettings=structuredClone(soundProject);changedSettings.soundscape.layers[0].settings.speechVolume=.1;assert.throws(()=>M.validateAnimaticManifest(changedSettings,soundManifest,'sound-input-basis'),/утвердите/);
const changedChoice=structuredClone(soundProject),changedLayer=changedChoice.soundscape.layers[0],alternate={...changedLayer.variants[0],id:D.id(),assetId:D.id()};changedLayer.variants.push(alternate);S.chooseSoundVariant(changedChoice,changedLayer.id,alternate.id);assert.throws(()=>M.validateAnimaticManifest(changedChoice,soundManifest,'sound-input-basis'),/утвердите/);
const noOptionalSound=structuredClone(soundProject);noOptionalSound.animaticSettings.music=false;const silentManifest=M.buildAnimaticManifest(noOptionalSound,{...soundPlan,soundscape:[]},'silent-basis');assert.deepEqual(M.validateAnimaticManifest(noOptionalSound,silentManifest,'silent-basis').soundscape,[]);
// A trusted saved historical manifest preserves its original file membership
// after the live layer has been removed. A different project never grants it.
const history=structuredClone(soundProject);history.soundscape=undefined;history.animatic={variants:[],removedVariants:[{id:D.id(),kind:'video',assetId:D.id(),animaticManifest:structuredClone(soundManifest)}]};
const historicalAssets=projectAssetIds(history);for(const sound of soundManifest.soundscape)assert(historicalAssets.has(sound.assetId));assert(!historicalAssets.has(ambience.id));
const foreignSoundId=D.id(),foreignManifest=structuredClone(soundManifest);foreignManifest.projectId=D.id();foreignManifest.soundscape[0].assetId=foreignSoundId;history.animatic.removedVariants.push({id:D.id(),kind:'video',assetId:D.id(),animaticManifest:foreignManifest});assert(!projectAssetIds(history).has(foreignSoundId));
K.setKeyframeMode(p,item.id,'triple');assert.throws(()=>M.frameSchedule(p,item,5),/промежуточный/);K.setKeyframeMode(p,item.id,'single');assert.equal(M.frameSchedule(p,item,5).length,1);
assert.equal(M.animaticMotionFilter(undefined,1920,1080,5),'');assert.equal(M.animaticMotionFilter({cameraMovement:{type:'static',description:''}},1920,1080,5),'');assert.match(M.animaticMotionFilter(shot.direction,1920,1080,5),/zoompan.*s=1920x1080/);assert.equal(M.animaticMotionFilter({cameraMovement:{type:'orbit',description:'Вокруг'}},1920,1080,5),'');
console.log('PASS animatic manifest: original files, pair timing, immutable copy, stale sources, project/order/scene isolation, legacy single, camera sketch; approved sound sources on actual timing, tampered asset/settings/timing rejection, explicit optional sound, historical membership scoped to own project.');
