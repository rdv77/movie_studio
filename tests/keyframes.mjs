import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export {ensureDirecting} from './lib/directing';export * as K from './lib/keyframes';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/keyframes.mjs'});
const {D,K,ensureDirecting}=await import('../work/tests/keyframes.mjs');
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS keyframes:',name);};
const fixture=(direction)=>{
 const p=D.newProject('Ключевые кадры');ensureDirecting(p);
 const shot={id:'shot-1',title:'План 01 — Находка',description:'Мальчик на берегу',duration:5,camera:'Средний план',continuity:'Стоит у воды',speechType:'none',speaker:'',dialogue:'',stateIn:'Мальчик смотрит на воду',stateOut:'Мальчик держит лягушку',continuityChanges:'Лягушка на ладонях',direction};
 for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{kind:'text',text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Утверждённая основа'});D.approve(p,item.id);}
 const item=p.items.find(i=>i.stage===5);item.title=shot.title;item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:shot.title,shotId:shot.id};
 return {p,item,shot};
};
const start=(p,item,asset='first-file',extra={})=>{const v=D.makeVariant(p,item,{kind:'image',assetId:asset,title:'Первый кадр',model:'grok-imagine-image-2.0',jobId:'first-job',imageSettings:{quality:'medium',resolution:'2k'},...extra});item.variants.push(v);item.selectedId=v.id;return v;};
const endpoint=(p,item,role='end')=>{const first=K.selectedKeyframe(item,'start'),data=K.prepareKeyframeGeneration(p,item.id,role,{model:first.model,refs:['hero-ref',first.assetId],imageSettings:first.imageSettings});const v=D.makeVariant(p,item,{...data,kind:'image',title:role==='end'?'Последний кадр':'Промежуточный кадр',assetId:role+'-file',jobId:role+'-job'});item.variants.push(v);K.chooseKeyframe(p,item.id,role,v.id);return v;};
const updateShot=(p,change)=>{const script=p.items.find(i=>i.stage===4),v=script.variants.find(v=>v.id===script.approvedId),data=JSON.parse(v.text);change(data.shots[0],data);v.text=JSON.stringify(data);};

test('legacy single image approval and text fallback are unchanged',()=>{
 const {p,item}=fixture();const v=start(p,item);D.approve(p,item.id);const saved=structuredClone(item);
 assert.equal(K.hasKeyframeConfig(p,item),false);assert.equal(K.planKeyframeMode(p,item),'single');assert.equal(K.keyframeSelection(item).startId,v.id);assert.equal(K.keyframeOptions(item,'start').length,1);assert.equal(K.keyframeOptions(item,'end').length,0);assert(D.isApproved(p,item));assert.deepEqual(item,saved);
 item.variants.push(D.makeVariant(p,item,{kind:'text',title:'Описание плана из сценария',text:'Описание',planDraft:true}));item.selectedId=item.variants.at(-1).id;assert.equal(K.keyframeSelection(item).startId,v.id);assert.equal(K.keyframeIssues(p,item).length,0);
});
test('only explicit directing endpoints or motion recommend two frames; manual single overrides',()=>{
 assert.equal(K.recommendedKeyframeMode(), 'single');assert.equal(K.recommendedKeyframeMode({startFrame:'Мальчик стоит',endFrame:'Мальчик стоит',cameraMovement:{type:'static',description:''}}),'single');
 assert.equal(K.recommendedKeyframeMode({framingStart:'wide',framingEnd:'close-up'}),'pair');assert.equal(K.recommendedKeyframeMode({cameraMovement:{type:'push-in',description:'Приблизиться'}}),'pair');
 const {p,item}=fixture({startFrame:'Мальчик стоит',endFrame:'Мальчик держит лягушку'});assert.equal(K.planKeyframeMode(p,item),'pair');K.setKeyframeMode(p,item.id,'single');assert.equal(K.planKeyframeMode(p,item),'single');
});
test('selecting roles does not approve; explicit set approval stores the same images',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item),last=endpoint(p,item),ids=item.variants.map(v=>v.id);
 assert.equal(item.approvedId,undefined);assert.equal(item.approvedKeyframes,undefined);assert.equal(item.selectedId,first.id);assert.equal(K.keyframeOptions(item,'end')[0].id,last.id);
 const approval=K.approveKeyframes(p,item.id,{startId:first.id,endId:last.id});assert.equal(approval.endId,last.id);assert.equal(item.approvedId,first.id);assert(K.keyframesApproved(p,item));assert.deepEqual(item.variants.map(v=>v.id),ids);
});
test('a missing image, including a text draft, cannot replace a required endpoint',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');assert.throws(()=>K.prepareKeyframeGeneration(p,item.id,'end',{model:'grok-imagine-image-2.0'}),/готовый первый/);
 const text=D.makeVariant(p,item,{kind:'text',text:'Конечное состояние',keyframe:'end'});item.variants.push(text);item.keyframeSelection={startId:text.id,endId:text.id};assert(K.keyframeIssues(p,item).some(i=>i.code==='missing_start'));assert.throws(()=>K.approveKeyframes(p,item.id),/готовое изображение/);
 start(p,item);item.keyframeSelection={endId:text.id};assert(K.keyframeIssues(p,item).some(i=>i.code==='missing_end'));assert.throws(()=>K.chooseKeyframe(p,item.id,'end',text.id),/готовое изображение/);
});
test('duplicate ids/files and unexpected client selections fail before any approval mutation',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item),last=endpoint(p,item);
 assert.throws(()=>K.approveKeyframes(p,item.id,{startId:'outdated',endId:last.id}),/Выбор.*изменился/);assert.equal(item.approvedId,undefined);
 last.assetId=first.assetId;assert(K.keyframeIssues(p,item).some(i=>i.code==='duplicate_file'));assert.throws(()=>K.approveKeyframes(p,item.id),/одно изображение/);last.assetId='end-file';
 item.variants.push(structuredClone(last));assert(K.keyframeIssues(p,item).some(i=>i.code==='duplicate_variant'));assert.throws(()=>K.approveKeyframes(p,item.id),/ID варианта/);assert.equal(item.approvedKeyframes,undefined);
});
test('endpoint request pins the actual chosen first variant, ref and quality',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item),other=start(p,item,'other-file');K.chooseKeyframe(p,item.id,'start',first.id);
 const request=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model,refs:['hero-ref',first.assetId],imageSettings:first.imageSettings});assert.equal(request.sourceFrameVariantId,first.id);assert.equal(request.refs[0],first.assetId);assert.equal(request.refs.filter(x=>x===first.assetId).length,1);assert(!request.refs.includes(other.assetId));assert.deepEqual(request.imageSettings,first.imageSettings);assert.equal(request.keyframeSourceBasis,K.keyframeSourceBasis(first));
 assert.throws(()=>K.prepareKeyframeGeneration(p,item.id,'end',{model:'different-provider'}),/модель выбранного/);assert.throws(()=>K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model,imageSettings:{quality:'low',resolution:'1k'}}),/качество выбранного/);
});
test('manual change of first selection invalidates endpoint approval and queued generation',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item),last=endpoint(p,item);K.approveKeyframes(p,item.id);
 const request=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model}),job={...request,kind:'image',itemId:item.id};assert.equal(K.keyframeQueueIssue(p,job),'');
 const other=start(p,item,'other-file');K.chooseKeyframe(p,item.id,'start',other.id);assert(!K.keyframesApproved(p,item));assert(K.keyframeIssues(p,item).some(i=>i.code==='start_changed'));assert.equal(item.keyframeSelection.endId,last.id);assert.match(K.keyframeQueueIssue(p,job),/первый кадр изменился/);assert.throws(()=>K.approveKeyframes(p,item.id,undefined,{reviewChanged:true}),/другого первого кадра/);
});
test('same-id replacement of a first file invalidates the pair; a label change does not',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item);endpoint(p,item);K.approveKeyframes(p,item.id);first.title='Новое название';assert(K.keyframesApproved(p,item));first.assetId='replaced-file';assert(!K.keyframesApproved(p,item));assert(K.keyframeIssues(p,item).some(i=>i.code==='start_changed'));
});
test('pair basis follows semantic plan/files, never unrelated approvals/configuration',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');start(p,item);endpoint(p,item);K.approveKeyframes(p,item.id);const basis=K.keyframeApprovalBasis(p,item);
 p.configVersion++;p.title='Другой заголовок';p.items.push({...structuredClone(item),id:'other-plan',title:'Другой план',approvedId:'unrelated'});updateShot(p,(_shot,data)=>data.shots.push({id:'other-shot',title:'Другой план',description:'Не связан с находкой'}));
 assert.equal(K.keyframeApprovalBasis(p,item),basis);assert(K.keyframesApproved(p,item));
});
test('changed endpoint state is diagnosed and can be explicitly reviewed without duplicate media',()=>{
 const {p,item}=fixture({startFrame:'Мальчик смотрит на воду',endFrame:'Мальчик держит лягушку'});K.setKeyframeMode(p,item.id,'pair');start(p,item);endpoint(p,item);K.approveKeyframes(p,item.id);const ids=item.variants.map(v=>v.id);
 updateShot(p,shot=>{shot.direction.endFrame='Лягушка поднимает голову';shot.stateOut='Лягушка подняла голову на ладонях';});assert(!K.keyframesApproved(p,item));assert(K.keyframeIssues(p,item).some(i=>i.role==='end'&&i.code==='foundation_changed'));
 assert.throws(()=>K.approveKeyframes(p,item.id),/Основа этого кадра/);K.approveKeyframes(p,item.id,undefined,{reviewChanged:true});assert(K.keyframesApproved(p,item));assert.equal(K.keyframeIssues(p,item).length,0);assert.deepEqual(item.variants.map(v=>v.id),ids);
});
test('triple mode requires a separate middle image and one approval for all three',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'triple');start(p,item);endpoint(p,item);assert(K.keyframeIssues(p,item).some(i=>i.code==='missing_middle'));endpoint(p,item,'middle');K.approveKeyframes(p,item.id);assert(K.keyframesApproved(p,item));
 K.setKeyframeMode(p,item.id,'single');assert(!K.keyframesApproved(p,item));K.approveKeyframes(p,item.id);assert(K.keyframesApproved(p,item));assert.equal(K.keyframeOptions(item,'middle').length,1);
});
test('legacy Grok settings remain historical; endpoint queue rechecks role/ref/foundation',()=>{
 const {p,item}=fixture();K.setKeyframeMode(p,item.id,'pair');const first=start(p,item,'legacy-file',{imageSettings:undefined}),request=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model}),job={...request,kind:'image',itemId:item.id};assert.deepEqual(request.imageSettings,{quality:'low',resolution:'1k'});assert.equal(K.keyframeQueueIssue(p,job),'');assert.match(K.keyframeQueueIssue(p,{...job,refs:[]}),/нет выбранного первого/);
 updateShot(p,shot=>shot.stateOut='Новая поза');assert.match(K.keyframeQueueIssue(p,job),/Основа ключевого кадра изменилась/);K.setKeyframeMode(p,item.id,'single');assert.match(K.keyframeQueueIssue(p,job),/Режим ключевых кадров/);
});
console.log(`PASS ${checks} keyframe regression groups. Pure local helpers; no provider or paid calls.`);
