import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('work/tests',{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as C from './lib/prompt-compiler';export {POST as generate} from './app/api/projects/[id]/generate/route';export {POST as frames} from './app/api/projects/[id]/keyframes/route';export {POST as review} from './app/api/projects/[id]/media-review/route';export {POST as step} from './app/api/projects/[id]/jobs/[jobId]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/keyframe-api.mjs',plugins:[{name:'owned-mock',setup(b){
  b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
    export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}};
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
    export const owner=async()=> 'test';export const loadProject=async()=>structuredClone(globalThis.kState);
    export const saveProject=async(_,p,rev)=>{if(rev!==globalThis.kState.revision)throw Error('CAS');p.revision++;globalThis.kState=structuredClone(p);return p};
    export const mutate=async(_,id,fn)=>{const p=structuredClone(globalThis.kState);fn(p);return saveProject('',p,p.revision)};
    export const getKey=async()=> 'mock';export const runtime={FILES:{head:async()=>true}};
    export const asset=async(_,id,p)=>{const a=globalThis.kAssets.get(id);if(!a||a.projectId!==p.id)throw Error('Foreign asset');return a};
    export const imageData=async(_,id,p)=>{await asset('',id,p);return 'data:image/png;base64,AA=='};
    export const storeAsset=async(_,id,name,mime,bytes,projectId)=>{globalThis.kAssets.set(id,{id,name,mime,size:bytes.length,projectId});return id};
  `}));
  b.onResolve({filter:/^@\/lib\/providers$/},()=>({path:'provider',namespace:'fake-provider'}));
  b.onLoad({filter:/.*/,namespace:'fake-provider'},()=>({contents:`export {ProviderError} from '../../lib/provider-http';export const generate=async(j,key,refs)=>{globalThis.kDispatch.push(structuredClone(j));return {bytes:new Uint8Array([0]),mime:'image/png',requestId:'receipt-'+j.id,actual:'12'}};export const poll=async()=>{throw Error('unexpected poll')};export const retrieve=async()=>{throw Error('unexpected retrieve')};`,resolveDir:process.cwd()+'/work/tests'}));
}}]});
const {D,K,C,generate,frames,review,step}=await import('../work/tests/keyframe-api.mjs');
globalThis.kAssets=new Map();globalThis.kDispatch=[];
const post=(handler,body,id)=>handler(new Request('http://localhost/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:globalThis.kState.id,...(id?{jobId:id}:{})})});
const p=D.newProject('Парная раскадровка');p.seconds=5;
for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{text:stage===4?JSON.stringify({shots:[{id:'shot-one',title:'Один план',description:'Мальчик поднимает письмо',stateIn:'Письмо на столе',stateOut:'Письмо в руках',duration:5,camera:'Средний',continuity:'Та же комната',speechType:'none',dialogue:''}]}):'Основа'});D.approve(p,i.id);}
const item=p.items.find(i=>i.stage===5);item.title='Один план';item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,shotId:'shot-one',title:item.title};K.setKeyframeMode(p,item.id,'pair');globalThis.kState=p;
const body=role=>({revision:globalThis.kState.revision,batchId:D.id(),itemId:item.id,models:['grok-imagine-image-2.0'],count:1,prompt:'Сохрани комнату и письмо.',keyframe:role,refs:[],referenceMode:'selected',dialogue:'',voiceId:'',estimates:{}});
let response=await post(generate,body('start'));assert.equal(response.status,200,await response.clone().text());const firstJob=globalThis.kState.jobs[0];assert.equal(firstJob.keyframe,'start');assert(firstJob.keyframeReviewBasis);await post(step,{},firstJob.id);
let current=globalThis.kState.items.find(i=>i.id===item.id),first=D.chosen(current);assert.equal(first.assetId,firstJob.id);assert.equal(first.keyframe,'start');assert.equal(current.keyframeSelection.startId,first.id);
response=await post(frames,{revision:globalThis.kState.revision,itemId:item.id,action:'approve',data:{selection:{startId:first.id}}});assert.equal(response.status,400,'Incomplete pair cannot be approved');
response=await post(generate,body('end'));assert.equal(response.status,200,await response.clone().text());const endJob=globalThis.kState.jobs.at(-1);assert(endJob.refs.includes(first.assetId));assert.equal(endJob.sourceFrameVariantId,first.id);assert.deepEqual(endJob.imageSettings,first.imageSettings);assert.equal(endJob.keyframeSourceBasis,K.keyframeSourceBasis(first));assert(endJob.prompt.includes('последний кадр'));
await post(step,{},endJob.id);current=globalThis.kState.items.find(i=>i.id===item.id);assert.equal(D.chosen(current).id,first.id,'End completion does not replace first choice');const end=K.selectedKeyframe(current,'end');assert.equal(end.sourceFrameVariantId,first.id);
response=await post(frames,{revision:globalThis.kState.revision,itemId:item.id,action:'approve',data:{selection:K.keyframeSelection(current)}});assert.equal(response.status,200,await response.clone().text());assert(D.isApproved(globalThis.kState,globalThis.kState.items.find(i=>i.id===item.id)));
response=await post(generate,body('end'));assert.equal(response.status,200);const stale=globalThis.kState.jobs.at(-1),selectedFirst=globalThis.kState.items.find(i=>i.id===item.id).variants.find(v=>v.id===first.id);selectedFirst.imageSettings={quality:'low',resolution:'1k'};const before=globalThis.kDispatch.length;await post(step,{},stale.id);assert.equal(globalThis.kDispatch.length,before);assert.equal(globalThis.kState.jobs.find(j=>j.id===stale.id).status,'cancelled');
const savedFetch=globalThis.fetch;let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://api.x.ai/v1/responses');const payload=JSON.parse(init.body);assert(payload.input[0].content.some(c=>c.type==='input_image'));return Response.json({id:'vision-receipt',status:'completed',usage:{cost_in_usd_ticks:99},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({summary:'Проверен кадр',issues:[],checks:[{criterion:'Письмо',result:'uncertain',evidence:'Деталь мала'}],limitations:['Неподвижная картинка']})}]}]});};
try{response=await post(review,{revision:globalThis.kState.revision,itemId:item.id,variantId:end.id,kind:'image',samples:[{assetId:end.assetId,role:'target'}]});assert.equal(response.status,200,await response.clone().text());const job=globalThis.kState.jobs.at(-1);await post(step,{},job.id);assert.equal(calls,1);assert.equal(globalThis.kState.jobs.at(-1).actual,'99');assert.equal(globalThis.kState.mediaReviews.at(-1).result.summary,'Проверен кадр');await post(step,{},job.id);assert.equal(calls,1,'Completed review does not dispatch again');}finally{globalThis.fetch=savedFetch;}
console.log('PASS keyframe APIs: roles→original source/quality→selected set approval, first-file changes cancel before paid dispatch, multimodal review receipt and no retry; mocked providers only');
