import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const server=`export const api=f=>f;export const owner=async()=> 'owner';
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p)=>{p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(u,id,fn)=>{const p=await loadProject();fn(p);return saveProject(u,p)};
export const getKey=async(_,provider)=>{if(provider!=='google')throw Error('Wrong credential');return 'mock-google-key'};
export const asset=async()=>({mime:'image/png',size:100});
export const imageData=async()=> 'data:image/png;base64,AA==';
export const storeAsset=async(_,id)=>{if(globalThis.storageFailure)throw Error('storage unavailable');globalThis.saved++;return id};export const runtime={FILES:{}};`;
await build({entryPoints:['lib/providers.ts','lib/google-provider.ts','lib/google-models.ts','lib/domain.ts','lib/video-readiness.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-remaining/route.ts','app/api/projects/[id]/jobs/[jobId]/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/google-video',outExtension:{'.js':'.mjs'},plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const root='../work/tests/google-video/',P=await import(root+'lib/providers.mjs'),G=await import(root+'lib/google-provider.mjs'),M=await import(root+'lib/google-models.mjs'),D=await import(root+'lib/domain.mjs'),R=await import(root+'lib/video-readiness.mjs');
const {POST:single}=await import(root+'app/api/projects/[id]/generate/route.mjs'),{POST:batch}=await import(root+'app/api/projects/[id]/generate-remaining/route.mjs'),{POST:tick}=await import(root+'app/api/projects/[id]/jobs/[jobId]/route.mjs');
const base='https://generativelanguage.googleapis.com/v1beta',frame='data:image/png;base64,AA==',key='mock-google-key';
const previous=globalThis.fetch;let calls=[];
const mock=handler=>{calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return handler(String(url),options)};};
try {
 for(const model of M.GOOGLE_MODELS) {
  const omni=model.id===M.GOOGLE_OMNI,requestId=omni?'v1_test':`models/${model.id}/operations/test`;
  const j={kind:'video',model:model.id,prompt:'Камера приближается. Рты закрыты.',duration:7,refs:['ref']};
  mock((url,o)=>{assert.equal(o.headers['x-goog-api-key'],key);assert.equal(o.redirect,'manual');const b=JSON.parse(o.body);
   if(omni){assert.equal(url,base+'/interactions');assert(b.background&&b.store);assert.equal(b.response_format.delivery,'uri');assert.equal(b.input[0].data,'AA==');assert(b.input[1].text.includes(j.prompt));}
   else {assert.equal(url,base+`/models/${model.id}:predictLongRunning`);assert.equal(b.parameters.durationSeconds,8);assert.deepEqual(b.instances[0].image,{bytesBase64Encoded:'AA==',mimeType:'image/png'});assert.equal(b.instances[0].prompt,j.prompt);}
   return Response.json(omni?{id:requestId,status:'in_progress'}:{name:requestId});});
  const queued=await P.generate(j,key,[frame],'16:9');assert(queued.pending);assert.equal(queued.requestId,requestId);assert.equal(calls.length,1);
  assert.equal(j.estimate,model.estimate);
  mock(()=>Response.json(omni?{id:requestId,status:'in_progress'}:{name:requestId,done:false}));
  assert((await P.poll({...j,requestId},key)).pending);assert(calls.every(c=>c.options.method==='GET'));
  mock(()=>Response.json(omni?{id:requestId,status:'completed',steps:[{type:'thought',content:[{type:'text',text:'secret'}]},{type:'model_output',content:[{type:'video',mime_type:'video/mp4',data:'AAEC'}]}],usage:{total_tokens:123,raw:'secret'}}:{name:requestId,done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:base+'/files/video:download?alt=media'}}]}}}));
  const result=await P.poll({...j,requestId},key);assert.equal(result.actual,null);if(omni){assert.equal(result.bytes.length,3);assert.deepEqual(result.usage,{total_tokens:123});assert(!JSON.stringify(result).includes('secret'));}else assert.equal(result.url,base+'/files/video:download?alt=media');
  mock(()=>Response.json(omni?{id:requestId,status:'failed',error:{message:'bad'}}:{name:requestId,done:true,error:{code:3}}));assert((await P.poll({...j,requestId},key)).error);
  mock(()=>{throw Error('network')});await assert.rejects(()=>P.generate(j,key,[frame],'16:9'),e=>!e.definite&&!e.notSent);assert.equal(calls.length,1);
  for(const refs of [[],[frame,frame],['data:image/gif;base64,AA==']]) {mock(()=>{throw Error('Must not send')});await assert.rejects(()=>P.generate(j,key,refs,'16:9'),e=>e.notSent);assert.equal(calls.length,0);}
  mock(()=>{throw Error('Must not send')});await assert.rejects(()=>P.generate({...j,duration:11},key,[frame],'16:9'),e=>e.notSent);assert.equal(calls.length,0);
  await assert.rejects(()=>P.poll({...j,requestId:'https://evil.example/task'},key),e=>e.notSent);assert.equal(calls.length,0);
 }
 // Authenticated Google download may redirect to Google CDN without the key.
 mock((url,o)=>url.includes('googleapis.com/v1beta')?new Response(null,{status:302,headers:{location:'https://storage.googleapis.com/bucket/video.mp4?signature=example'}}):new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4'}}));
 assert.equal((await G.retrieveGoogle(base+'/files/test:download?alt=media',key)).bytes.length,2);
 assert.equal(calls[0].options.headers['x-goog-api-key'],key);assert.deepEqual(calls[1].options.headers,{});
 for(const location of ['https://evil.example/a','http://storage.googleapis.com/a','https://127.0.0.1/a','https://generativelanguage.googleapis.com/v1beta/models']){
  mock(()=>new Response(null,{status:302,headers:{location}}));await assert.rejects(()=>G.retrieveGoogle(base+'/files/test',key));assert.equal(calls.length,1);
 }
 mock(()=>new Response('oops',{headers:{'content-type':'text/html'}}));await assert.rejects(()=>G.retrieveGoogle(base+'/files/test',key),/другой формат/);
 mock(()=>Response.json({error:{message:key}},{status:403}));await assert.rejects(()=>P.generate({kind:'video',model:M.GOOGLE_OMNI,prompt:'Test',duration:5,refs:['r']},key,[frame],'16:9'),e=>!e.message.includes(key));
 assert.equal(R.videoDurationIssue('План',7,['veo-3.1-generate-preview']),'');assert(R.videoDurationIssue('План',9,['veo-3.1-generate-preview']));
 assert.equal(R.videoDurationIssue('План',10,[M.GOOGLE_OMNI]),'');assert(R.videoDurationIssue('План',7,[M.GOOGLE_OMNI,'grok-imagine-video-1.5']));
 // Both entry points admit a 7-second plan, enforce budget and preserve idempotency.
 const p=D.newProject('Google'),shots=Array.from({length:10},(_,n)=>({title:'План '+n,description:'Лес',duration:n===0?7:n===1?3:5,camera:'Наезд',dialogue:'',speechType:'none',continuity:'Склейка'}));
 for(const i of p.items.filter(i=>i.stage<7)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
 const item=p.items.find(i=>i.stage===7);item.title='План 0';item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:'План 0'};
 const ctx={params:Promise.resolve({id:p.id})},req=b=>new Request('https://test/api',{method:'POST',body:JSON.stringify(b)});
 const body={revision:p.revision,batchId:D.id(),itemId:item.id,models:['veo-3.1-fast-generate-preview'],count:1,prompt:'Лес',refs:[D.id()],dialogue:'',voiceId:'',estimates:{'veo-3.1-fast-generate-preview':'1'}};
 globalThis.state=structuredClone(p);await single(req(body),ctx);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].estimate,'8000000000');await single(req(body),ctx);assert.equal(state.jobs.length,1);
 globalThis.state={...structuredClone(p),limit:'100'};await assert.rejects(()=>single(req({...body,batchId:D.id()}),ctx),/лимит/);assert.equal(state.jobs.length,0);
 globalThis.state=structuredClone(p);const example={id:D.id(),stage:7,title:'Пример',variants:[]};state.items.push(example);D.addVariant(state,example.id,{kind:'video',assetId:D.id(),model:'veo-3.1-fast-generate-preview'});
 await batch(req({revision:state.revision,batchId:D.id(),sourceItemId:example.id,sourceVariantId:example.selectedId,estimate:'1',plans:[{itemId:item.id,ref:D.id(),prompt:'Лес'}]}),ctx);assert.equal(state.jobs[0].estimate,'8000000000');
 // Run real adapter through worker: media download/storage retry is GET-only.
 const job=state.jobs[0],task=`models/${job.model}/operations/test`,jobCtx={params:Promise.resolve({id:p.id,jobId:job.id})};let posts=0;
 globalThis.saved=0;globalThis.storageFailure=false;
 mock((url,o)=>{
  assert.equal(o.headers['x-goog-api-key'],key);
  if(o.method==='POST'){posts++;return Response.json({name:task});}
  if(url.includes('/operations/'))return Response.json({name:task,done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:base+'/files/test'}}]}}});
  return new Response(new Uint8Array([1]),{headers:{'content-type':'video/mp4'}});
 });
 await tick(req({}),jobCtx);assert.equal(state.jobs[0].status,'pending');assert.equal(posts,1);
 globalThis.storageFailure=true;await tick(req({}),jobCtx);assert.equal(state.jobs[0].status,'saving');assert(state.jobs[0].output.url);assert.equal(posts,1);
 globalThis.storageFailure=false;await tick(req({}),jobCtx);assert.equal(state.jobs[0].status,'done');assert.equal(posts,1);assert.equal(saved,1);
 assert.equal(D.getItem(state,item.id).variants.filter(v=>v.jobId===job.id).length,1);await tick(req({}),jobCtx);assert.equal(posts,1);
 // Omni inline result also survives storage failure by rereading the interaction.
 globalThis.state=structuredClone(p);await single(req({...body,batchId:D.id(),models:[M.GOOGLE_OMNI],estimates:{}}),ctx);
 const oj=state.jobs[0],oc={params:Promise.resolve({id:p.id,jobId:oj.id})};posts=0;
 mock((url,o)=>{if(o.method==='POST'){posts++;return Response.json({id:'v1_test',status:'in_progress'});}return Response.json({id:'v1_test',status:'completed',steps:[{type:'model_output',content:[{type:'video',data:'AAEC'}]}]});});
 await tick(req({}),oc);globalThis.storageFailure=true;await tick(req({}),oc);assert.equal(state.jobs[0].status,'pending');globalThis.storageFailure=false;await tick(req({}),oc);assert.equal(state.jobs[0].status,'done');assert.equal(posts,1);assert(!JSON.stringify(state).includes('AAEC'));
 console.log('PASS Google video: 3 model contracts, duration and budget on both APIs, background polling, credential-isolated downloads, worker storage retries without duplicate POST, inline media never persisted to D1. All requests mocked.');
}finally{globalThis.fetch=previous;}
