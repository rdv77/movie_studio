import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
// Node's production route intentionally has no Workers isolate gate. This
// shared test verifies the preserved hosted route instead of changing Node's
// execution semantics merely to satisfy a Workers memory fixture.
const hostedRoute=await readFile('platform/hosted/jobs-route.ts.template','utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as S from './lib/media-work-slot';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/memory-fixture.mjs'});
const {D,S}=await import('../work/tests/memory-fixture.mjs');
let release;const first=S.withMediaWorkSlot(()=>new Promise(r=>release=r));
await assert.rejects(()=>S.withMediaWorkSlot(()=>assert.fail('Busy work must never load the project')),e=>e.code==='MEDIA_WORKER_BUSY');release();await first;
await assert.rejects(()=>S.withMediaWorkSlot(()=>Promise.reject(Error('failure'))));assert.equal(await S.withMediaWorkSlot(async()=>42),42,'Capacity released after failure');
// A suspended/cancelled Workers request cannot occupy local admission forever.
const realNow=Date.now;let time=realNow(),oldRelease,newRelease;Date.now=()=>time;
try{
 const orphan=S.withMediaWorkSlot(()=>new Promise(r=>oldRelease=r));
 time+=S.MEDIA_WORK_LEASE_MS-1;
 await assert.rejects(()=>S.withMediaWorkSlot(()=>assert.fail('Lease still active')),e=>e.code==='MEDIA_WORKER_BUSY');
 time+=1;const next=S.withMediaWorkSlot(()=>new Promise(r=>newRelease=r));
 oldRelease();await orphan;
 await assert.rejects(()=>S.withMediaWorkSlot(()=>assert.fail('Late finally cannot release a newer lease')),e=>e.code==='MEDIA_WORKER_BUSY');
 newRelease();await next;assert.equal(await S.withMediaWorkSlot(async()=>43),43);
}finally{Date.now=realNow;}
const p=D.newProject('Большой фильм');for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{text:'Утверждённая основа'});D.approve(p,i.id);}
const item=p.items.find(i=>i.stage===5);
p.jobs=Array.from({length:3},()=>({id:D.id(),batchId:D.id(),itemId:item.id,kind:'image',model:'gpt-image-2.5-flare',brief:'Сохранить внешность',prompt:'One end frame',refs:['reference-a','reference-b'],status:'queued',deps:D.dependencies(p,5),created:D.now(),actual:null,estimate:null,duration:5}));
// Different cards/batches keep the ordinary admission rules independent.
p.jobs.forEach((j,n)=>{if(n){const i={...item,id:D.id(),variants:[]};p.items.push(i);j.itemId=i.id;}});
p.memoryTestArchive='История '.repeat(1_300_000);assert(Buffer.byteLength(JSON.stringify(p))>18_000_000);
const server=`import {env} from 'cloudflare:workers';import {encodeProjectState,decodeProjectState} from './lib/project-state';import {MediaWorkBusyError} from './lib/media-work-slot';
export const runtime=env;export class HttpError extends Error{};export const owner=async()=> 'owner';
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message,code:e.code},{status:e instanceof MediaWorkBusyError?503:400})}};
export async function loadProject(user,id){const pointer=await (await env.FILES.get('current')).json();return decodeProjectState(env.FILES,user,id,pointer.state,pointer.revision)};
export async function saveProject(user,p,expected){p.revision=expected+1;const encoded=await encodeProjectState(env.FILES,user,p);await env.FILES.put('current',JSON.stringify({state:encoded.state,revision:p.revision}));return p};
export async function mutate(user,id,fn){const p=await loadProject(user,id);fn(p);return saveProject(user,p,p.revision)};
export const getKey=async()=> 'test-key';export const imageData=async()=>{throw Error('Base64 image path must not run')};
export async function asset(user,id,p){if(user!=='owner'||!['reference-a','reference-b'].includes(id))throw Error('Ownership');const file=await env.FILES.head(id);return {id,size:file.size,mime:'image/png',project_id:p.id}};
export async function storeAsset(user,id,name,mime,bytes,pid){await env.FILES.put(id,bytes,{httpMetadata:{contentType:mime}});return id};`;
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:`import {POST} from './app/api/projects/[id]/jobs/[jobId]/route';export default {fetch(req){const [id,jobId]=new URL(req.url).pathname.split('/').filter(Boolean);return POST(req,{params:Promise.resolve({id,jobId})})}};`},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],plugins:[{name:'storage',setup(b){
 if(hostedRoute)b.onLoad({filter:/[\\/]app[\\/]api[\\/]projects[\\/]\[id\][\\/]jobs[\\/]\[jobId\][\\/]route\.ts$/},()=>({contents:hostedRoute,loader:'ts',resolveDir:process.cwd()}));
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'storage',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server,resolveDir:process.cwd()}));
}}]});
let calls=0;const png=Buffer.alloc(6*1024*1024,123).toString('base64');
const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',r2Buckets:['FILES'],outboundService:async req=>{
 calls++;assert.equal(req.url,'https://api.openai.com/v1/images/edits');const form=await req.formData();assert.equal(form.get('quality'),'high');assert.equal(form.getAll('image[]').length,2);assert(form.getAll('image[]').every(b=>b.size===3*1024*1024));
 await new Promise(r=>setTimeout(r,50));return Response.json({data:[{b64_json:png}],usage:{output_tokens:123}},{headers:{'x-request-id':'receipt-memory'}});
}});
try{
 const files=await mf.getR2Bucket('FILES');await files.put('current',JSON.stringify({state:JSON.stringify(p),revision:p.revision}));for(const id of ['reference-a','reference-b'])await files.put(id,Buffer.alloc(3*1024*1024,17));
 const responses=await Promise.all(p.jobs.map(j=>mf.dispatchFetch('http://test/'+p.id+'/'+j.id,{method:'POST'}).then(async r=>({status:r.status,body:await r.json()}))));
 assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===503).length,2);assert.equal(calls,1,'Only one paid-request mock; other jobs unclaimed');
 for(const r of responses){const body=r.body;if(r.status===503){assert.equal(body.code,'MEDIA_WORKER_BUSY');continue;}assert.equal(body.jobs.filter(j=>j.status==='done').length,1);assert.equal(body.jobs.filter(j=>j.status==='queued').length,2);const job=body.jobs.find(j=>j.status==='done');assert.equal(job.requestId,'receipt-memory');assert.equal(job.usage.output_tokens,123);assert.equal((await files.head(job.id)).size,6*1024*1024);assert.equal(body.memoryTestArchive,p.memoryTestArchive);}
 // A finished ID is idempotent after capacity becomes available.
 const pointer=await (await files.get('current')).json();const latest=pointer.state.includes('$kadrProjectState')?JSON.parse(await (await files.get(JSON.parse(pointer.state).key)).text()):JSON.parse(pointer.state);const done=latest.jobs.find(j=>j.status==='done');
 const again=await mf.dispatchFetch('http://test/'+p.id+'/'+done.id,{method:'POST'});assert.equal(again.status,200);await again.body.cancel();assert.equal(calls,1);
}finally{await mf.dispose();}
console.log('PASS hosted media: >18 MB project, 6 MB exact binary references, 6 MB result, native Workers R2 snapshot storage, one admitted/2 safely deferred requests, receipt/archive preserved, idempotence and capacity release. No paid requests.');
