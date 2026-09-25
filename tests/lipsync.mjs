import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { ProviderHarness as Miniflare } from './provider-harness.mjs';
const fakeServer=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};
export const owner=async(req)=>{if(req.headers.get('test-owner')!=='owner')throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(user,p,revision)=>{if(revision!==globalThis.state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(user,id,fn)=>{const p=structuredClone(globalThis.state);fn(p);return saveProject(user,p,p.revision)};
export const getKey=async()=> 'test-key';
export const asset=async(user,id)=>{const a=globalThis.assets.get(id);if(!a)throw new Error('Foreign asset');return a};
export const storeAsset=async(user,id,name,mime,bytes)=>{globalThis.assets.set(id,{id,name,mime,size:bytes.length});return id};
export const imageData=async()=>{throw new Error('Sync must not read image data')};
export const runtime={FILES:{get:async()=>new Blob(['media'])}};
`;
await build({entryPoints:['lib/domain.ts','lib/lipsync.ts','lib/sync-provider.ts','app/api/projects/[id]/generate-lipsync/route.ts','app/api/projects/[id]/jobs/[jobId]/route.ts'],
  bundle:true,platform:'node',format:'esm',outdir:'work/tests/lipsync',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'fake-server',setup(b){
    b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:fakeServer}));
  }}]});
const D=await import('../work/tests/lipsync/lib/domain.mjs'), L=await import('../work/tests/lipsync/lib/lipsync.mjs');
const {POST:queue}=await import('../work/tests/lipsync/app/api/projects/[id]/generate-lipsync/route.mjs');
const {POST:tick}=await import('../work/tests/lipsync/app/api/projects/[id]/jobs/[jobId]/route.mjs');
function fixture(){
 const p=D.newProject('Test');p.speechMode='plans';
 const script=p.items[4].id;
 for(const item of p.items.filter(i=>i.stage<8).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
  if(item.stage>=5)item.sourceShot={scriptId:script,title:'План 1'};
  D.addVariant(p,item.id,{text:'Реплика',dialogue:'Привет',speechType:'character',speaker:'Катя',duration:4,kind:item.stage===5?'image':item.stage===6?'audio':item.stage===7?'video':'text',assetId:item.stage>=5?D.id():undefined});D.approve(p,item.id);
 }
 return p;
}
const initial=fixture(), item=initial.items[7],source=L.lipsyncSource(initial,item.id);
assert.equal(L.originalLipsyncVideo(item),source.video.id);
const syncedItem=structuredClone(item);
syncedItem.variants.push({...source.video,id:'sync-result',lipsync:{videoVariantId:source.video.id,audioVariantId:source.audio.id,audioItemId:source.audioItem.id}});
syncedItem.selectedId='sync-result';
assert.equal(L.originalLipsyncVideo(syncedItem),source.video.id,'Retry defaults to the original clip, not another processed copy');
assert.equal(syncedItem.selectedId,'sync-result','Picking a dialog input does not change selection or approval');
const changedVoice=structuredClone(initial),voiceItem=changedVoice.items[6];
D.addVariant(changedVoice,voiceItem.id,{kind:'audio',assetId:D.id(),text:'New voice',dialogue:'Привет',speechType:'character',speaker:'Катя',voiceId:'new',duration:4});
assert.throws(()=>L.lipsyncSource(changedVoice,item.id),/Выбран новый голос/);
D.approve(changedVoice,voiceItem.id);
const reused=L.lipsyncSource(changedVoice,item.id);
assert.equal(reused.video.id,source.video.id,'Source footage is reused after voice replacement without a manual copy');
assert.equal(reused.audio.id,voiceItem.approvedId);assert.notEqual(reused.audio.id,source.audio.id);
assert(!D.isApproved(changedVoice,changedVoice.items[7]),'Reusing footage does not reapprove an old result');
assert.equal(L.hasCurrentLipsyncVisuals(changedVoice,reused.video),true);
const changedFrame=structuredClone(changedVoice);changedFrame.items[5].approvedId=D.id();
assert.equal(L.hasCurrentLipsyncVisuals(changedFrame,reused.video),false);
const changedConfig=structuredClone(changedVoice);changedConfig.configVersion++;
assert.equal(L.hasCurrentLipsyncVisuals(changedConfig,reused.video),false);
assert.equal(L.hasCurrentLipsyncVisuals(changedVoice,{...reused.video,deps:'malformed'}),false);
assert.equal(L.lipsyncSeconds(source.video,source.audio,6,4.6),4.625);
assert.throws(()=>L.lipsyncSeconds(source.video,source.audio,4,4.6),/Не хватает/);
assert.equal(L.lipsyncSeconds({...source.video,trim:1},{...source.audio,trim:.6},6,4.6),4);
assert.equal(L.lipsyncEstimate(D.ticks('.05'.replace(/^\./,'0.')),4.625),'2220000000');
assert.throws(()=>L.lipsyncSource({...initial,speechMode:'track'},item.id),/по планам/);
const preparedVideo=D.id(),preparedAudio=D.id();
globalThis.assets=new Map([[preparedVideo,{id:preparedVideo,mime:'video/mp4',size:100}],[preparedAudio,{id:preparedAudio,mime:'audio/wav',size:100}]]);
globalThis.state=structuredClone(initial);
const body={revision:initial.revision,batchId:D.id(),model:'lipsync-2',rate:D.ticks('0.05'),plans:[{itemId:item.id,videoVariantId:source.video.id,audioVariantId:source.audio.id,videoAssetId:preparedVideo,audioAssetId:preparedAudio,seconds:4.625}]};
const request=(body,owner='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'test-owner':owner,'content-type':'application/json'},body:JSON.stringify(body)});
const ctx={params:Promise.resolve({id:initial.id})};
assert.equal((await queue(request({...body,model:'sync-3',rate:D.ticks('0.133')}),ctx)).status,200);
assert.equal(state.jobs[0].model,'sync-3');
assert.equal(state.jobs[0].estimate,L.lipsyncEstimate(D.ticks('0.133'),4.625));
state=structuredClone(changedVoice);
assert.equal((await queue(request({...body,plans:[{...body.plans[0],audioVariantId:voiceItem.approvedId}]}),ctx)).status,200);
assert.equal(state.jobs[0].lipsync.videoVariantId,source.video.id);
assert.equal(state.jobs[0].lipsync.audioVariantId,voiceItem.approvedId);
state=structuredClone(initial);
assert.equal((await queue(request(body,'foreign'),ctx)).status,400);
assert.equal((await queue(request({...body,revision:99}),ctx)).status,400);
assert.equal((await queue(request({...body,plans:[{...body.plans[0],audioAssetId:D.id()}]}),ctx)).status,400);
state.limit='0';assert.equal((await queue(request(body),ctx)).status,400);state.limit=null;
assert.equal((await queue(request(body),ctx)).status,200);assert.equal(state.jobs.length,1);const jobId=state.jobs[0].id;
assert.equal((await queue(request(body),ctx)).status,200);assert.equal(state.jobs.length,1,'Same batch never charges twice');
const queued=structuredClone(state), approved=item.approvedId;
let mode='pending',calls=[];
globalThis.fetch=async(url,options)=>{
 calls.push({url,options});
 if(url==='https://assets.example/result.mp4') {
  assert.equal(options.headers,undefined);
  if(mode==='save-failure')throw new Error('Download interrupted');
  return new Response(null,{status:302,headers:{location:'https://cdn.example/output.mp4?signature=test'}});
 }
 if(url==='https://cdn.example/output.mp4?signature=test') {
  assert.equal(options.headers,undefined);
  return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
 }
 assert(String(url).startsWith('https://api.sync.so/v2/generate'));
 assert.equal(options.headers['x-api-key'],'test-key');assert.equal(options.redirect,'manual');
 if(mode==='network')throw new Error('Transport');
 if(options.method==='POST'){
  assert(options.body instanceof FormData);assert.equal(options.body.get('model'),'lipsync-2');
  assert.equal(options.body.get('audio').type,'audio/wav');assert.equal(options.body.get('video').type,'video/mp4');
  assert.deepEqual(JSON.parse(options.body.get('options')),{sync_mode:'silence'});
  assert.equal(options.body.get('input'),null,'Private assets use direct files, no public URLs');
 }
 return Response.json(mode==='complete'?{id:'receipt',status:'COMPLETED',outputDuration:4.625,outputUrl:'https://assets.example/result.mp4'}:{id:'receipt',status:'PENDING'});
};
const jobctx={params:Promise.resolve({id:initial.id,jobId})};
await tick(request({}),jobctx);assert.equal(state.jobs[0].status,'pending');assert.equal(calls.length,1);
mode='network';await tick(request({}),jobctx);assert.equal(state.jobs[0].status,'pending','Polling network failure does not repeat generation');
mode='complete';await tick(request({}),jobctx);assert.equal(state.jobs[0].status,'done');
const after=state.items[7];assert.equal(after.approvedId,approved);assert.equal(after.selectedId,item.selectedId);assert.equal(after.variants.length,2);
const synced=after.variants[1];assert.equal(synced.trim,0);assert.equal(synced.duration,4);assert.equal(synced.lipsync.audioVariantId,source.audio.id);assert.equal(state.jobs[0].actual,null);
assert.deepEqual(D.makeVariant(state,after,{assetId:synced.assetId}).lipsync,synced.lipsync,'Editing or copying the file preserves speech provenance');
after.selectedId=synced.id;D.approve(state,after.id);assert.equal(after.approvedId,synced.id);
synced.trim=.5;assert.throws(()=>D.approve(state,after.id),/уже обрезан/);
state=structuredClone(queued);calls=[];state.items[6].approvedId=D.id();await tick(request({}),jobctx);assert.equal(state.jobs[0].status,'cancelled');assert.equal(calls.length,0);
state=structuredClone(queued);calls=[];mode='network';await tick(request({}),jobctx);assert.equal(state.jobs[0].status,'unknown');await tick(request({}),jobctx);assert.equal(calls.length,1);

// An already generated result resumes saving through redirects, without another API generation or poll.
state=structuredClone(queued);state.jobs[0].status='saving';state.jobs[0].requestId='existing-receipt';
state.jobs[0].output={url:'https://assets.example/result.mp4',mime:'video/mp4'};
calls=[];mode='save-failure';await tick(request({}),jobctx);
assert.equal(state.jobs[0].status,'saving');assert.equal(state.items[7].variants.length,1);
mode='complete';await tick(request({}),jobctx);
assert.equal(state.jobs[0].status,'done');assert.equal(state.jobs[0].error,undefined);
assert.equal(state.items[7].variants.length,2);assert.equal(state.items[7].approvedId,approved);
assert(calls.every(c=>!String(c.url).startsWith('https://api.sync.so/')), 'Saving recovery never resubmits paid generation');
const savedCalls=calls.length;await tick(request({}),jobctx);
assert.equal(calls.length,savedCalls);assert.equal(state.items[7].variants.length,2,'Completed recovery is idempotent');

// Check the actual Worker runtime accepts multipart without a manual Content-Type boundary.
const worker=await build({stdin:{resolveDir:process.cwd(),contents:`import {generateSync,pollSync} from './lib/sync-provider';export default {async fetch(){
 const j={id:'test',model:'lipsync-2',lipsync:{seconds:4},requestId:'id'};
 return Response.json(await generateSync(j,'test-key',new Blob(['video'],{type:'video/mp4'}),new Blob(['audio'],{type:'audio/wav'})));
}};`},bundle:true,write:false,format:'esm',platform:'browser'});
let sent=0;const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:worker.outputFiles[0].text,outboundService:async req=>{
 sent++;assert.equal(req.headers.get('x-api-key'),'test-key');assert(req.headers.get('content-type').includes('boundary='));
 const form=await req.formData();assert.equal(form.get('video').name,'video.mp4');assert.equal(form.get('audio').size,5);
 return Response.json({id:'id',status:'PENDING'});
}});
try{assert((await(await mf.dispatchFetch('http://test/')).json()).pending);assert.equal(sent,1)}finally{await mf.dispose()}
console.log('PASS sync: authorized queue, file ownership, budget, idempotence, immutable approvals, duration validation, stale cancellation, unknown outcome protection, polling recovery and workerd multipart. Zero paid calls.');
