import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as M from './lib/animatic-manifest';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/animatic-manifest.mjs'});
const {D,K,M,ensureDirecting}=await import('../work/tests/animatic-manifest.mjs');
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
K.setKeyframeMode(p,item.id,'triple');assert.throws(()=>M.frameSchedule(p,item,5),/промежуточный/);K.setKeyframeMode(p,item.id,'single');assert.equal(M.frameSchedule(p,item,5).length,1);
assert.equal(M.animaticMotionFilter(undefined,1920,1080,5),'');assert.equal(M.animaticMotionFilter({cameraMovement:{type:'static',description:''}},1920,1080,5),'');assert.match(M.animaticMotionFilter(shot.direction,1920,1080,5),/zoompan.*s=1920x1080/);assert.equal(M.animaticMotionFilter({cameraMovement:{type:'orbit',description:'Вокруг'}},1920,1080,5),'');
console.log('PASS animatic manifest: original files, pair timing, immutable copy, stale sources, project/order isolation, legacy single, camera sketch');
