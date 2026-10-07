import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as K from './lib/keyframes';export * as A from './lib/animatic';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/staging-keyframes.mjs'});
const {D,R,K}=await import('../work/tests/staging-keyframes.mjs');
const fixture=(direction)=>{
 const p=D.newProject('Новая постановка'),d=R.ensureDirecting(p);
 const shot={id:'s1',title:'Поворот',description:'Герой поворачивает голову.',duration:5,camera:'Средний план',continuity:'Стоит',dialogue:'',speechType:'none',stateIn:'Смотрит вперёд',stateOut:'Смотрит вправо',direction};
 for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{kind:'text',text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Основа'});D.approve(p,i.id);}
 const item=p.items.find(i=>i.stage===5);item.title=shot.title;item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:shot.title,shotId:shot.id};
 return {p,d,item};
};
const moving={startFrame:'Смотрит вперед',endFrame:'Смотрит вправо',cameraMovement:{type:'pan'},framingStart:'medium',framingEnd:'close-up'};
for(const [policy,expected] of [['auto','single'],['single','single'],['pair','pair'],[undefined,'pair']]){
 const {p,d,item}=fixture(moving);d.brief.framePolicy=policy;assert.equal(K.planKeyframeMode(p,item),expected);
 item.keyframeMode='single';assert.equal(K.planKeyframeMode(p,item),'single','Explicit perplan overrides film');
}
{
 const {p,d,item}=fixture({...moving,requiresEndFrame:true});d.brief.framePolicy='auto';assert.equal(K.planKeyframeMode(p,item),'pair');
}
{
 const {p,d,item}=fixture();D.addVariant(p,item.id,{kind:'image',assetId:'image',text:'Первый кадр'});D.approve(p,item.id);
 assert(D.isApproved(p,item));const basis=K.keyframeApprovalBasis(p,item);K.freezeExistingKeyframeModes(p);d.brief.framePolicy='pair';d.brief.stagingMode='readable';
 assert.equal(item.keyframePolicy,'legacy');assert.equal(K.planKeyframeMode(p,item),'single');assert(!K.hasKeyframeConfig(p,item));assert(D.isApproved(p,item),'Legacy single approval stays valid');assert.equal(K.keyframeApprovalBasis(p,item),basis);
 const fresh={...item,id:'new',variants:[],keyframePolicy:undefined,approvedId:undefined,selectedId:undefined};p.items.push(fresh);assert.equal(K.planKeyframeMode(p,fresh),'pair','New material follows new preference');
}
{
 const {p,d,item}=fixture(moving);D.addVariant(p,item.id,{kind:'image',assetId:'image',text:'Начало'});
 K.freezeExistingKeyframeModes(p);d.brief.framePolicy='auto';assert.equal(K.planKeyframeMode(p,item),'pair','Existing pair not silently downgraded');
}
{
 const {p,d,item}=fixture(moving);d.brief.framePolicy='auto';D.addVariant(p,item.id,{kind:'image',assetId:'image',text:'Начало'});D.approve(p,item.id);assert(D.isApproved(p,item));
 K.freezeExistingKeyframeModes(p);d.brief.framePolicy='pair';assert.equal(K.planKeyframeMode(p,item),'single');assert(D.isApproved(p,item));
}
{
 const {p,d,item}=fixture(moving);D.addVariant(p,item.id,{kind:'text',text:'Описание плана из сценария'});
 K.freezeExistingKeyframeModes(p);d.brief.framePolicy='auto';assert.equal(item.keyframePolicy,undefined,'A text placeholder has no old image set to preserve');
 assert.equal(K.planKeyframeMode(p,item),'single','Ungenerated storyboard cards follow the new global policy');
}
for(const status of ['queued','dispatching','pending','saving','unknown']){
 const {p,d,item}=fixture(moving);D.addVariant(p,item.id,{kind:'text',text:'Описание плана из сценария'});
 p.jobs.push({id:'pending-image',itemId:item.id,kind:'image',status});
 K.freezeExistingKeyframeModes(p);d.brief.framePolicy='auto';assert.equal(item.keyframePolicy,'legacy','Preserve the in-flight image set: '+status);
 assert.equal(K.planKeyframeMode(p,item),'pair');
}
for(const job of [{kind:'text',status:'pending'},{kind:'image',status:'failed'},{kind:'image',status:'cancelled'},{kind:'image',status:'unknown',newSeriesAllowedAt:'2026-10-07T00:00:00Z'}]){
 const {p,d,item}=fixture(moving);p.jobs.push({id:'inactive-job',itemId:item.id,...job});
 K.freezeExistingKeyframeModes(p);d.brief.framePolicy='auto';assert.equal(item.keyframePolicy,undefined,'Only active/unresolved image attempts preserve a set');
}
console.log('PASS: project frame policies, explicit endpoints, per-plan choice and legacy approval preservation');
