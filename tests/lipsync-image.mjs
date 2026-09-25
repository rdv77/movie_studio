import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {ProviderHarness as Miniflare} from './provider-harness.mjs';
const server=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};
export const owner=async req=>{if(req.headers.get('test-owner')!=='owner')throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(user,p,revision)=>{if(revision!==globalThis.state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(user,id,fn)=>{const p=structuredClone(globalThis.state);fn(p);return saveProject(user,p,p.revision)};
export const getKey=async()=> 'test-key';
export const asset=async(user,id)=>{const a=globalThis.assets.get(id);if(!a)throw new Error('Foreign asset');return a};
export const storeAsset=async(user,id,name,mime,bytes)=>{globalThis.assets.set(id,{id,name,mime,size:bytes.length});return id};
export const imageData=async()=>{throw new Error('No data URLs')};
export const runtime={FILES:{get:async()=>new Blob(['media'])}};
`;
await build({entryPoints:['lib/domain.ts','lib/lipsync.ts','app/api/projects/[id]/generate-lipsync/route.ts','app/api/projects/[id]/jobs/[jobId]/route.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/lipsync-image',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'server',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));
}}]});
const D=await import('../work/tests/lipsync-image/lib/domain.mjs'),L=await import('../work/tests/lipsync-image/lib/lipsync.mjs');
const {POST:queue}=await import('../work/tests/lipsync-image/app/api/projects/[id]/generate-lipsync/route.mjs');
const {POST:tick}=await import('../work/tests/lipsync-image/app/api/projects/[id]/jobs/[jobId]/route.mjs');
const p=D.newProject('Image test');p.speechMode='plans';
for(const item of p.items.filter(i=>i.stage<7).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
 if(item.stage>=5)item.sourceShot={scriptId:p.items[4].id,title:'План 1'};
 D.addVariant(p,item.id,{text:'Основа',dialogue:'Привет',speechType:'character',speaker:'Петя',duration:4,kind:item.stage===5?'image':item.stage===6?'audio':'text',assetId:item.stage>=5?D.id():undefined});D.approve(p,item.id);
}
p.items[7].sourceShot={scriptId:p.items[4].id,title:'План 1'};
const source=L.lipsyncImageSource(p,p.items[7].id);assert.equal(p.items[7].variants.length,0,'No generated footage is necessary');
const newFrame=structuredClone(p);D.addVariant(newFrame,newFrame.items[5].id,{kind:'image',assetId:D.id()});
assert.throws(()=>L.lipsyncImageSource(newFrame,newFrame.items[7].id),/выбран новый кадр/);
const newVoice=structuredClone(p);D.addVariant(newVoice,newVoice.items[6].id,{kind:'audio',assetId:D.id()});
assert.throws(()=>L.lipsyncImageSource(newVoice,newVoice.items[7].id),/Выбран новый голос/);
const promptProject=structuredClone(p);D.chosen(promptProject.items[4]).text=JSON.stringify({shots:Array.from({length:10},(_,n)=>({title:'План '+(n+1),description:'Мальчик держит карту. Рты всех персонажей закрыты, речь звучит только за кадром голосом Кати.',duration:5,camera:'Средний план',continuity:'Прямая склейка',dialogue:'Привет'}))});
assert.match(L.lipsyncImagePrompt(promptProject,p.items[7]),/Мальчик держит карту/);
assert.doesNotMatch(L.lipsyncImagePrompt(promptProject,p.items[7]),/рты.*закрыты|за кадром/i);
const imageAssetId=D.id(),audioAssetId=D.id();globalThis.assets=new Map([[imageAssetId,{id:imageAssetId,mime:'image/png',size:100}],[audioAssetId,{id:audioAssetId,mime:'audio/wav',size:100}]]);
const row={inputType:'image',itemId:p.items[7].id,imageVariantId:source.image.id,imageItemId:source.imageItem.id,imageAssetId,imageWidth:1024,imageHeight:768,
 audioAssetId,audioVariantId:source.audio.id,seconds:4.625,speaker:{x:.75,y:.25},prompt:'The selected character speaks naturally. Keep the camera still.'};
const body={revision:0,batchId:D.id(),model:'sync-3',rate:D.ticks('.133'.replace(/^\./,'0.')),plans:[row]};
const req=(data,user='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'content-type':'application/json','test-owner':user},body:JSON.stringify(data)});
const ctx={params:Promise.resolve({id:p.id})};
for(const bad of [{...body,model:'lipsync-2-pro'},{...body,plans:[{...row,imageVariantId:D.id()}]},{...body,plans:[{...row,imageAssetId:D.id()}]},
 {...body,plans:[{...row,speaker:{x:1.1,y:0}}]},{...body,plans:[{...row,prompt:'x'.repeat(2001)}]},{...body,plans:[{...row,seconds:3}]}]){
 globalThis.state=structuredClone(p);assert.equal((await queue(req(bad),ctx)).status,400);assert.equal(state.jobs.length,0);
}
state=structuredClone(p);assert.equal((await queue(req(body,'other'),ctx)).status,400);
assert.equal((await queue(req(body),ctx)).status,200);assert.equal(state.jobs.length,1);
assert.equal((await queue(req(body),ctx)).status,200);assert.equal(state.jobs.length,1);
const queued=structuredClone(state),job=state.jobs[0],jobctx={params:Promise.resolve({id:p.id,jobId:job.id})};
assert.equal(job.lipsync.inputType,'image');assert.equal(job.duration,4.625);assert.equal(job.estimate,L.lipsyncEstimate(body.rate,4.625,'image'));
assert.throws(()=>D.deleteVariant(state,source.imageItem.id,source.image.id),/используется текущей генерацией/);
let calls=0;
globalThis.fetch=async(url,options)=>{
 calls++;
 if(url==='https://files.example/result.mp4')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
 const form=options.body;assert.equal(form.get('model'),'sync-3');assert.equal(form.get('image').type,'image/png');assert.equal(form.get('audio').type,'audio/wav');
 assert.equal(form.get('video'),null);assert.equal(form.get('input'),null);
 assert.deepEqual(JSON.parse(form.get('options')),{i2v_prompt:row.prompt,active_speaker_detection:{auto_detect:false,frame_number:0,coordinates:[768,192]}});
 return Response.json({id:'receipt',status:'COMPLETED',outputDuration:4.625,outputUrl:'https://files.example/result.mp4'});
};
await tick(req({}),jobctx);assert.equal(state.jobs[0].status,'done');assert.equal(calls,2);
const result=state.items[7].variants[0];assert.match(result.title,/из кадра/);assert.equal(result.duration,4.625);assert.equal(result.trim,0);
assert.equal(result.lipsync.imageVariantId,source.image.id);assert.equal(result.lipsync.audioVariantId,source.audio.id);assert.equal(state.items[7].approvedId,undefined);
assert.deepEqual(D.makeVariant(state,state.items[7],{assetId:result.assetId}).lipsync,result.lipsync);
D.approve(state,state.items[7].id);assert.equal(state.items[7].approvedId,result.id);
state=structuredClone(queued);state.items[5].approvedId=D.id();calls=0;await tick(req({}),jobctx);assert.equal(state.jobs[0].status,'cancelled');assert.equal(calls,0);
// Recover an already completed provider job with a one-frame duration rounding.
// No second paid POST, no duplicate variant, and no creative auto-approval.
state=structuredClone(queued);state.jobs[0].status='failed';state.jobs[0].requestId='existing-receipt';
let recoverySeconds=4.6;const recoveryCalls=[];
globalThis.fetch=async(url,options={})=>{
 recoveryCalls.push({url,method:options.method??'GET'});
 if(url==='https://files.example/result.mp4')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
 assert.equal(url,'https://api.sync.so/v2/generate/existing-receipt');assert.equal(options.method,'GET');
 return Response.json({id:'existing-receipt',status:'COMPLETED',outputDuration:recoverySeconds,outputUrl:'https://files.example/result.mp4'});
};
assert.equal((await tick(req({action:'recover-result'},'other'),jobctx)).status,400);assert.equal(recoveryCalls.length,0);
await tick(req({action:'recover-result'}),jobctx);assert.equal(state.jobs[0].status,'done');assert.equal(state.items[7].variants.length,1);assert.equal(state.items[7].approvedId,undefined);
assert.equal(state.jobs[0].usage.outputDuration,4.6);assert(recoveryCalls.every(c=>c.method==='GET'));
await tick(req({action:'recover-result'}),jobctx);assert.equal(recoveryCalls.length,2);assert.equal(state.items[7].variants.length,1);
state=structuredClone(queued);state.jobs[0].status='failed';state.jobs[0].requestId='existing-receipt';recoverySeconds=4.5;
await tick(req({action:'recover-result'}),jobctx);assert.equal(state.jobs[0].status,'failed');assert.match(state.jobs[0].error,/4\.500 сек вместо 4\.625/);assert.equal(state.jobs[0].usage.outputDuration,4.5);assert.equal(state.items[7].variants.length,0);
state=structuredClone(queued);state.jobs[0].status='failed';const beforeNoReceipt=recoveryCalls.length;
await tick(req({action:'recover-result'}),jobctx);assert.equal(recoveryCalls.length,beforeNoReceipt);assert.equal(state.jobs[0].status,'failed');
const worker=await build({stdin:{resolveDir:process.cwd(),contents:`import {generateSync} from './lib/sync-provider';export default {async fetch(){
 const job=${JSON.stringify(job)};
 return Response.json(await generateSync(job,'key',new Blob(['image'],{type:'image/png'}),new Blob(['audio'],{type:'audio/wav'})));
}}`},bundle:true,write:false,format:'esm',platform:'browser'});
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:worker.outputFiles[0].text,outboundService:async req=>{
 const form=await req.formData();assert.equal(form.get('image').name,'frame.png');assert.equal(form.get('video'),null);
 assert.deepEqual(JSON.parse(form.get('options')).active_speaker_detection.coordinates,[768,192]);return Response.json({id:'receipt',status:'PENDING'});
}});
try{assert((await(await mf.dispatchFetch('http://test/')).json()).pending)}finally{await mf.dispose()}
console.log('PASS direct sync-3 image generation: no source video, manual face mapping, i2v prompt, real Worker multipart, budget/duration/ownership validation, stale cancellation, immutable approvals, and image/audio provenance. Zero paid calls.');
