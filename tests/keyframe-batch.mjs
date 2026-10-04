import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};export const loadProject=async(_,id)=>{if(id!==state.id)throw Error('Wrong project');return structuredClone(state)};export const saveProject=async(_,p,r)=>{if(state.revision!==r||globalThis.conflict)throw Error('CAS conflict');p.revision++;globalThis.state=structuredClone(p);return p};export const asset=async()=>({mime:'image/png',size:10});export const getKey=async()=>{keyCalls++;return 'mock'};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as B from './lib/keyframe-batch';export * as K from './lib/keyframes';export * as Q from './lib/queue-policy';export {KeyframeBatchEditor} from './app/keyframe-batch-editor';export {PATCH} from './app/api/projects/[id]/route';export {POST as generate} from './app/api/projects/[id]/generate-storyboard/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/keyframe-batch.mjs',external:['react','react-dom','@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,B,K,Q,KeyframeBatchEditor,PATCH,generate}=await import('../work/tests/keyframe-batch.mjs');
function fixture(){
 const p=D.newProject('Шесть окончаний');p.items=p.items.filter(i=>i.stage!==5);
 const items=Array.from({length:16},(_,n)=>({id:D.id(),title:'План '+String(n+1).padStart(2,'0'),stage:5,variants:[],keyframeMode:'pair'}));p.items.push(...items);
 const shots=items.map(i=>({id:D.id(),title:i.title,description:'Герой ждёт на берегу',duration:5,camera:'Статично',continuity:'Склейка',speechType:'none',speaker:'',dialogue:'',stateIn:'Стоит',stateOut:'Держит стрелу'}));
 for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots}):'Утверждённая основа'});D.approve(p,item.id);}
 const missing=new Set([0,1,6,7,12,15]);
 for(const [n,item] of items.entries()){
  item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,shotId:shots[n].id,title:shots[n].title};
  const first=D.makeVariant(p,item,{kind:'image',assetId:D.id(),model:'gpt-image-2.5-flare',jobId:D.id(),keyframe:'start',pairId:D.id()});first.keyframeReviewBasis=K.keyframeFoundationBasis(p,item,'start',first);item.variants.push(first);K.chooseKeyframe(p,item.id,'start',first.id);
  if(missing.has(n))p.jobs.push({id:D.id(),itemId:item.id,model:first.model,kind:'image',keyframe:n===0?'start':'end',status:'unknown',created:D.now(),actual:'123',requestId:'provider-receipt',prompt:'Historical',estimate:'456'});
  else {const prep=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model});const end=D.makeVariant(p,item,{...prep,kind:'image',assetId:D.id(),jobId:D.id(),model:first.model});end.keyframeReviewBasis=K.keyframeFoundationBasis(p,item,'end',end);item.variants.push(end);K.chooseKeyframe(p,item.id,'end',end.id);K.approveKeyframes(p,item.id);}
 }
 return {p,ids:items.filter((_,n)=>missing.has(n)).map(i=>i.id),items};
}
const patch=(ids,role='end',revision=state.revision)=>PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify({revision,action:'allowMissingAdditionalFrames',data:{itemIds:ids,role}})}),{params:Promise.resolve({id:state.id})});
const markup=p=>renderToStaticMarkup(createElement(KeyframeBatchEditor,{p,busy:false,initiallyOpen:true,permitMissingFrames:()=>{throw Error('Permission needs a click')},submit:()=>{throw Error('Generation needs a click')}})).replace(/<!--.*?-->/g,'');
const send=ids=>generate(new Request('http://test',{method:'POST',body:JSON.stringify({revision:state.revision,batchId:D.id(),keyframe:'end',model:'gpt-image-2.5-flare',refs:[],referenceMode:'selected',estimate:null,imageRetry:{maxAttempts:3},plans:ids.map(itemId=>({itemId,prompt:'Конечный кадр: герой держит стрелу',refs:[]}))})}),{params:Promise.resolve({id:state.id})});
globalThis.fetch=()=>{throw Error('No provider requests in permission/enqueue tests')};globalThis.keyCalls=0;
let f=fixture();globalThis.state=f.p;const before=structuredClone(state);let html=markup(state);
assert.match(html,/Недостающих изображений: 6/);assert.match(html,/Выбрать все недостающие · 6/);assert.match(html,/Разрешить повтор для выбранных/);
const checks=[...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(m=>m[0]);assert.equal(checks.length,6);assert(checks.every(s=>s.includes('checked=""')&&!s.includes('disabled')),'All six missing ends are selectable, including unknown old starts');
assert.equal((html.match(/Последний кадр: изображения нет/g)??[]).length,6);assert.deepEqual(state,before,'Opening the list changes no project data');
await assert.rejects(()=>send(f.ids),/неизвестным исходом/);assert.equal(keyCalls,0);
for(const args of [[f.ids,'end',-1],[[f.ids[0],D.id()]],[[f.ids[0],f.ids[0]]],[f.ids,'middle'],[[f.items[2].id]]]){await assert.rejects(()=>patch(...args));assert.deepEqual(state,before);}
globalThis.denied=true;await assert.rejects(()=>patch(f.ids),/Unauthorized/);globalThis.denied=false;globalThis.conflict=true;await assert.rejects(()=>patch(f.ids),/CAS/);globalThis.conflict=false;assert.deepEqual(state,before);
await patch(f.ids);assert.equal(state.jobs.length,6);assert.equal(keyCalls,0);assert.deepEqual(state.items,before.items);for(const [n,j] of state.jobs.entries()){assert(j.newSeriesAllowedAt);const {newSeriesAllowedAt,...old}=j;assert.deepEqual(old,before.jobs[n]);assert.equal(Q.queueAdmissionIssue(state,j.itemId),'');}
const dates=state.jobs.map(j=>j.newSeriesAllowedAt);await patch(f.ids);assert.deepEqual(state.jobs.map(j=>j.newSeriesAllowedAt),dates);
html=markup(state);assert(!html.includes('Разрешить повтор для выбранных'));const launch=html.match(/<button[^>]*>Создать ключевые кадры · 6<\/button>/)?.[0];assert(launch&&!/\sdisabled(?:=|\s|>)/.test(launch), 'Generate six is enabled after explicit permission');
await send(f.ids);assert.equal(state.jobs.length,12);assert(state.jobs.slice(6).every(j=>j.status==='queued'&&j.keyframe==='end'&&f.ids.includes(j.itemId)&&j.refs.includes(K.selectedKeyframe(state.items.find(i=>i.id===j.itemId),'start').assetId)));assert.deepEqual(state.items,before.items);assert(state.jobs.slice(0,6).every(j=>j.status==='unknown'&&j.requestId==='provider-receipt'&&j.actual==='123'));
// Newly running requests, arrived images and mixed-stage IDs invalidate the whole permission set.
for(const mutate of [f=>f.p.jobs.push({...f.p.jobs[1],id:D.id(),status:'pending'}),f=>f.items[1].variants.push(D.makeVariant(f.p,f.items[1],{kind:'image',keyframe:'end',assetId:D.id()})),f=>{f.items[1].keyframeMode='single'},f=>{f.items[1].removedAt=D.now()},f=>{f.p.jobs[1].kind='text'},f=>{f.items[1].keyframeSelection.startId='missing'}]){f=fixture();mutate(f);state=f.p;const snapshot=structuredClone(state);await assert.rejects(()=>patch(f.ids));assert.deepEqual(state,snapshot);}
// Existing unselected endpoints do not count as missing, and middle frames remain separately scoped.
f=fixture();state=f.p;const item=f.items[0];item.variants.push(D.makeVariant(state,item,{kind:'image',keyframe:'end',assetId:D.id()}));assert(!B.additionalFrameAdmission(state,item,'end').missing);await assert.rejects(()=>patch([item.id]),/уже появилось/);
f=fixture();state=f.p;f.items[0].keyframeMode='triple';assert.equal(B.additionalFrameItems(state,'middle').length,1);await patch([f.items[0].id],'middle');assert(state.jobs[0].newSeriesAllowedAt);assert(!state.jobs[1].newSeriesAllowedAt);
console.log('PASS: 6 missing selectable endpoints / 10 complete sets, explicit bulk permission, no payment or autoapproval, API admission after permission, unknown receipts/billing preserved, old-start blockers, scope/role/ownership/revision/CAS, arrival and active-job races, idempotence, missing vs unselected image, middle frames.');
