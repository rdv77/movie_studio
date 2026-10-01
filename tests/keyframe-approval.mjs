import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`
export const api=f=>f;
export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p)=>{p.revision++;globalThis.state=p;return p};
export const asset=async(user,id,p)=>{globalThis.assetChecks.push(id);const a=globalThis.files.get(id);if(!a||a.owner!==user||a.projectId!==p.id)throw Error('Foreign or missing asset');return a};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as B from './lib/bulk-approval';export * as C from './lib/review-center';export * as S from './lib/storyboard-approval';export {projectAssetIds} from './lib/project-assets';export {ensureDirecting} from './lib/directing';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/keyframe-approval.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,K,B,C,S,projectAssetIds,ensureDirecting,PATCH}=await import('../work/tests/keyframe-approval.mjs');
let checks=0;const test=async(name,fn)=>{await fn();checks++;console.log('PASS keyframe approvals:',name);};
const fixture=()=>{
 const p=D.newProject('Наборы раскадровки');ensureDirecting(p);
 const shots=Array.from({length:3},(_,n)=>({id:D.id(),title:`План ${n+1}`,description:'Герой на берегу',duration:5,camera:'Средний план',continuity:'Прямая склейка',stateIn:'Герой стоит',stateOut:'Герой держит стрелу',continuityChanges:'Стрела в руке',speechType:'none',dialogue:'',speaker:''}));
 for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots}):'Утверждённая основа'});D.approve(p,i.id);}
 const script=p.items.find(i=>i.stage===4),items=shots.map((shot,n)=>{const item=n===0?p.items.find(i=>i.stage===5):{id:D.id(),stage:5,title:shot.title,variants:[]};if(n)p.items.push(item);item.title=shot.title;item.sourceShot={scriptId:script.id,title:shot.title,shotId:shot.id};return item;});
 return {p,items,script};
};
const start=(p,item)=>{
 const v=D.makeVariant(p,item,{kind:'image',assetId:D.id(),title:'Начало',model:'grok-imagine-image-2.0',jobId:D.id(),keyframe:'start',pairId:D.id(),imageSettings:{quality:'medium',resolution:'2k'}});
 item.variants.push(v);K.chooseKeyframe(p,item.id,'start',v.id);v.keyframeReviewBasis=K.keyframeFoundationBasis(p,item,'start',v);return v;
};
const endpoint=(p,item,role='end')=>{
 const first=K.selectedKeyframe(item,'start'),data=K.prepareKeyframeGeneration(p,item.id,role,{model:first.model,refs:[first.assetId],imageSettings:first.imageSettings});
 const v=D.makeVariant(p,item,{...data,kind:'image',assetId:D.id(),jobId:D.id(),title:role==='end'?'Окончание':'Середина'});item.variants.push(v);K.chooseKeyframe(p,item.id,role,v.id);return v;
};
const pair=(p,item,mode='pair')=>{K.setKeyframeMode(p,item.id,mode);const first=start(p,item),end=endpoint(p,item);return {first,end};};
const selections=(p)=>B.approvalBatch(p,5).filter(r=>!r.reason).map(({itemId,variantId,keyframes})=>({itemId,variantId,keyframes}));
const setup=p=>{globalThis.state=structuredClone(p);globalThis.denied=false;globalThis.assetChecks=[];globalThis.files=new Map([...projectAssetIds(p)].map(id=>[id,{mime:'image/png',owner:'owner',projectId:p.id}]));};
const request=(action,data,itemId,revision=state.revision)=>PATCH(new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({revision,action,itemId,data})}),{params:Promise.resolve({id:state.id})});

await test('mass approval includes only complete current selected role sets and retains legacy singles',()=>{
 const {p,items}=fixture();pair(p,items[0]);K.setKeyframeMode(p,items[1].id,'pair');start(p,items[1]);
 const legacy=D.makeVariant(p,items[2],{kind:'image',assetId:D.id()});items[2].variants.push(legacy);items[2].selectedId=legacy.id;
 assert.equal(selections(p).length,2);assert.match(B.approvalBatch(p,5).find(r=>r.itemId===items[1].id).reason,/Последний кадр/);
 assert.equal(C.reviewRows(p).find(r=>r.itemId===items[1].id).status,'missing');
 B.approveBatch(p,5,selections(p));assert(K.keyframesApproved(p,items[0]));assert(D.isApproved(p,items[2]));assert(!D.isApproved(p,items[1]));
 const snapshot=structuredClone(p);assert.throws(()=>B.approveBatch(p,5,[{itemId:items[1].id,variantId:items[1].selectedId}]),/Последний кадр/);assert.deepEqual(p,snapshot);
});
await test('a triple has one approval only after start, middle and end are ready',()=>{
 const {p,items}=fixture(),item=items[0];pair(p,item,'triple');assert(!selections(p).some(s=>s.itemId===item.id));endpoint(p,item,'middle');
 const selection=selections(p).find(s=>s.itemId===item.id);assert(selection.keyframes.middleId);B.approveBatch(p,5,[selection]);assert(K.keyframesApproved(p,item));
 assert.equal(item.approvedId,selection.keyframes.startId);assert.equal(item.variants.length,3);
});
await test('wrong sources, repeated files and stale role selections fail atomically',()=>{
 const {p,items}=fixture();pair(p,items[0]);const {end}=pair(p,items[1]);const selected=selections(p);
 for(const mutate of [p=>K.selectedKeyframe(p.items.find(i=>i.id===items[1].id),'end').sourceFrameVariantId=D.id(),p=>{const i=p.items.find(i=>i.id===items[1].id);K.selectedKeyframe(i,'end').assetId=K.selectedKeyframe(i,'start').assetId;}]){
  const invalid=structuredClone(p);mutate(invalid);const before=structuredClone(invalid);assert.throws(()=>B.approveBatch(invalid,5,selected));assert.deepEqual(invalid,before);
 }
 const stale=structuredClone(p),before=structuredClone(stale);assert.throws(()=>B.approveBatch(stale,5,[{...selected[0],keyframes:{...selected[0].keyframes,endId:end.id}}]),/ключевых кадров/);assert.deepEqual(stale,before);
});
await test('an unrelated plan edit leaves pair approval valid; changed state needs explicit director review',()=>{
 const {p,items,script}=fixture(),item=items[0];pair(p,item);B.approveBatch(p,5,selections(p));const saved=structuredClone(item.approvedKeyframes),ids=item.variants.map(v=>v.id);
 let data=JSON.parse(D.chosen(script).text);data.shots[2].description='Другой дальний план';D.chosen(script).text=JSON.stringify(data);
 assert(K.keyframesApproved(p,item));assert.deepEqual(item.approvedKeyframes,saved);assert(!B.approvalBatch(p,5).some(r=>r.itemId===item.id));
 data.shots[0].stateOut='Герой поднял стрелу';D.chosen(script).text=JSON.stringify(data);assert(!K.keyframesApproved(p,item));
 assert.equal(C.reviewRows(p).find(r=>r.itemId===item.id).status,'review');assert.match(B.approvalBatch(p,5).find(r=>r.itemId===item.id).reason,/Основа/);
 const selection={itemId:item.id,variantId:item.selectedId,keyframes:K.keyframeSelection(item)},before=structuredClone(p);
 assert.throws(()=>C.approveReview(p,[selection]),/отметьте/);assert.deepEqual(p,before);
 C.approveReview(p,[{...selection,reviewed:true}]);const current=p.items.find(i=>i.id===item.id);assert(K.keyframesApproved(p,current));assert.deepEqual(current.variants.map(v=>v.id),ids);assert.deepEqual(p.jobs,before.jobs);
});
await test('legacy starts with stale dependencies do not become current merely by changing frame mode',async()=>{
 const {p,items}=fixture(),item=items[0],v=D.makeVariant(p,item,{kind:'image',assetId:D.id()});delete v.reviewBasis;delete v.basisVersion;v.deps='old';item.variants=[v];item.selectedId=v.id;K.setKeyframeMode(p,item.id,'single');
 assert.equal(C.reviewRows(p).find(r=>r.itemId===item.id).status,'review');assert(!selections(p).some(s=>s.itemId===item.id));
 setup(p);await assert.rejects(()=>request('approve',{},item.id),/Основа/);assert.deepEqual(state,p);
 S.reapproveStoryboard(p,item.id,v.id);assert(K.keyframesApproved(p,item));
});
await test('mock changed-set review needs an explicit flag and never changes IDs, jobs or expenses',async()=>{
 const {p,items,script}=fixture(),item=items[0];pair(p,item);B.approveBatch(p,5,selections(p));
 const scriptData=JSON.parse(D.chosen(script).text);scriptData.shots[0].stateOut='Стрела поднята над головой';D.chosen(script).text=JSON.stringify(scriptData);setup(p);
 const selection={itemId:item.id,variantId:item.selectedId,keyframes:K.keyframeSelection(item)},cost=D.totals(p),ids=item.variants.map(v=>v.id);
 await assert.rejects(()=>request('approveReview',{selections:[selection]}),/отметьте/);assert.deepEqual(state,p);
 await request('approveReview',{selections:[{...selection,reviewed:true}]});const current=state.items.find(i=>i.id===item.id);
 assert(K.keyframesApproved(state,current));assert.deepEqual(current.variants.map(v=>v.id),ids);assert.deepEqual(state.jobs,p.jobs);assert.deepEqual(D.totals(state),cost);
});
await test('mock PATCH validates endpoint asset ownership, whole set choices and revision before saving',async()=>{
 const {p,items}=fixture();const {end}=pair(p,items[0]);pair(p,items[1]);const selected=selections(p);setup(p);
 await request('approveBatch',{stage:5,selections:selected});assert(K.keyframesApproved(state,state.items.find(i=>i.id===items[0].id)));assert(assetChecks.includes(end.assetId));
 const approved=structuredClone(state);await assert.rejects(()=>request('approveBatch',{stage:5,selections:selected},undefined,p.revision),/Проект изменился/);assert.deepEqual(state,approved);
 for(const change of [()=>files.get(end.assetId).owner='another',()=>files.get(end.assetId).mime='audio/mpeg',()=>files.delete(end.assetId),()=>globalThis.denied=true]){
  setup(p);change();const before=structuredClone(state);await assert.rejects(()=>request('approveBatch',{stage:5,selections:selected}));assert.deepEqual(state,before);
 }
 setup(p);await assert.rejects(()=>request('approveBatch',{stage:5,selections:[{...selected[0],keyframes:{...selected[0].keyframes,endId:D.id()}}]}),/ключевых кадров/);assert.deepEqual(state,p);
});
await test('mock select updates a role, unapprove clears the set, delete/restore retain sources and costs without autoapproval',async()=>{
 const {p,items}=fixture(),item=items[0],{first,end}=pair(p,item);B.approveBatch(p,5,selections(p));
 p.jobs.push({id:D.id(),itemId:item.id,status:'done',kind:'image',refs:[first.assetId],actual:'2500000000',estimate:'2500000000'});setup(p);
 await request('select',{variantId:end.id},item.id);assert.equal(state.items.find(i=>i.id===item.id).selectedId,first.id);assert.equal(state.items.find(i=>i.id===item.id).keyframeSelection.endId,end.id);
 await request('unapprove',{},item.id);let current=state.items.find(i=>i.id===item.id);assert.equal(current.approvedKeyframes,undefined);assert(!D.isApproved(state,current));
 await request('approve',{},item.id);assert(D.isApproved(state,state.items.find(i=>i.id===item.id)));const costs=D.totals(state);
 state.mediaReviews=[{id:D.id(),jobId:D.id(),itemId:item.id,variantId:end.id,basis:'old',kind:'image',model:'mock',created:D.now(),samples:[{assetId:end.assetId,role:'target'}],removedAt:D.now()}];
 await request('deleteVariant',{variantId:end.id},item.id);current=state.items.find(i=>i.id===item.id);assert.equal(current.approvedKeyframes,undefined);assert.equal(current.keyframeSelection.endId,end.id);assert(projectAssetIds(state).has(end.assetId));assert.deepEqual(D.totals(state),costs);
 await request('restoreVariant',{variantId:end.id},item.id);current=state.items.find(i=>i.id===item.id);assert.equal(current.approvedKeyframes,undefined);assert(!D.isApproved(state,current));assert.equal(current.variants.length,2);assert.deepEqual(D.totals(state),costs);
 await request('approveBatch',{stage:5,selections:selections(state)});assert(K.keyframesApproved(state,state.items.find(i=>i.id===item.id)));
});
await test('explicit multi-card review cannot override a structurally mismatched pair or running plan',()=>{
 const {p,items}=fixture(),item=items[0],{end}=pair(p,item);end.sourceFrameVariantId=D.id();const before=structuredClone(p);
 assert.throws(()=>C.approveReview(p,[{itemId:item.id,variantId:item.selectedId,reviewed:true}]),/другого первого/);assert.deepEqual(p,before);
 end.sourceFrameVariantId=K.selectedKeyframe(item,'start').id;p.jobs.push({id:D.id(),itemId:item.id,status:'pending'});const active=structuredClone(p);
 assert.throws(()=>B.approveBatch(p,5,[{itemId:item.id,variantId:item.selectedId}]),/завершения/);assert.deepEqual(p,active);
});
await test('an advisory visual review does not block director approval of a ready pair',()=>{
 const {p,items}=fixture(),item=items[0];pair(p,item);p.jobs.push({id:D.id(),itemId:item.id,status:'pending',purpose:'media-review'});
 assert.equal(C.reviewRows(p).find(r=>r.itemId===item.id).status,'ready');B.approveBatch(p,5,selections(p));assert(K.keyframesApproved(p,item));assert.equal(p.jobs[0].status,'pending');
});
await test('historical manifest, pair snapshots, endpoint sources and review samples recover only explicit asset fields',()=>{
 const {p,items}=fixture(),item=items[0],{first,end}=pair(p,item);const historyAsset=D.id(),sampleAsset=D.id(),musicAsset=D.id(),audioAsset=D.id(),middleAsset=D.id();
 const v=D.makeVariant(p,item,{kind:'video',assetId:D.id(),endFrameAssetId:historyAsset});
 v.animaticManifest={schemaVersion:1,projectId:p.id,clips:[{itemId:D.id(),frames:[{role:'start',variantId:D.id(),assetId:first.assetId},{role:'end',variantId:D.id(),assetId:end.assetId}]}],audio:[{variantId:D.id(),assetId:audioAsset}],music:{variantId:D.id(),assetId:musicAsset}};
 const extraId=D.id();v.animaticBasis=JSON.stringify([0,'16:9',5,'plans',[],[],[],[{id:D.id(),mode:'triple',selection:{startId:D.id()},frames:[[D.id(),middleAsset,'source','review'],null,null],assetId:extraId}]]);
 p.animatic={variants:[],removedVariants:[v]};p.mediaReviews=[{id:D.id(),jobId:D.id(),itemId:item.id,variantId:end.id,basis:'old',kind:'image',model:'mock',created:D.now(),samples:[{assetId:sampleAsset,role:'reference'}],result:{assetId:extraId},removedAt:D.now()}];
 const snapshot=structuredClone(p),assets=projectAssetIds(p);for(const id of [first.assetId,end.assetId,historyAsset,sampleAsset,musicAsset,audioAsset,middleAsset])assert(assets.has(id));assert(!assets.has(extraId));assert(!assets.has(first.id));assert(!assets.has(end.sourceFrameVariantId));assert.deepEqual(p,snapshot);
 const foreign=D.id();v.animaticManifest.projectId=foreign;v.animaticManifest.audio=[{assetId:foreign}];assert(!projectAssetIds(p).has(foreign));assert.equal(projectAssetIds(D.newProject('Пустой фильм')).size,0);
});
console.log(`PASS ${checks} keyframe approval/recovery groups. Local helpers and mocked authenticated route only; no paid API calls.`);
