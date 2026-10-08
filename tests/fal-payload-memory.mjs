import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
await build({entryPoints:['lib/provider-http.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/fal-payload-memory-http.mjs'});
const {call}=await import('../work/tests/fal-payload-memory-http.mjs');
const originalRequest=globalThis.Request,originalFetch=globalThis.fetch;
let validations=0,calls=0,serialized=0,lastBody;
try{
  globalThis.Request=class extends originalRequest{constructor(url,options){assert.equal(options?.body,undefined,'Preflight must not create a second media body');super(url,options);validations++;}};
  globalThis.fetch=async(url,options)=>{calls++;lastBody=options.body;assert.equal(options.redirect,'manual');assert(options.signal instanceof AbortSignal);return Response.json({ok:true});};
  const payload={toJSON(){serialized++;return {image_url:'data:image/png;base64,AA==',prompt:'Keep exact framing'};}};
  await call('https://queue.fal.run/minimax/h3-max/image-to-video',{'Authorization':'Key mock','Content-Type':'application/json'},payload);
  assert.equal(serialized,1);assert.equal(calls,1);assert.equal(validations,1);assert.equal(lastBody,JSON.stringify({image_url:'data:image/png;base64,AA==',prompt:'Keep exact framing'}));
  const form=new FormData();form.append('image[]',new Blob(['image bytes'],{type:'image/png'}),'ref.png');await call('https://api.openai.com/v1/images/edits',{Authorization:'Bearer mock'},form);assert.equal(lastBody,form,'Multipart keeps the same body object');
  const circular={};circular.self=circular;
  const before=calls;
  for(const [url,headers,body] of [['not a valid URL',{},{}],['https://example.test',{'Authorization':'invalid\nheader'},{}],['https://example.test',{},circular],['https://example.test',{},{invalid:1n}]])await assert.rejects(()=>call(url,headers,body),e=>e.definite&&e.notSent);
  assert.equal(calls,before,'URL, headers and serialization errors still fail before transport');
  globalThis.fetch=async()=>{calls++;throw Error('Transport interrupted');};
  await assert.rejects(()=>call('https://queue.fal.run/minimax/h3-max/image-to-video',{},{}),e=>!e.definite&&!e.notSent);assert.equal(calls,before+1,'A paid POST is never retried');
}finally{globalThis.Request=originalRequest;globalThis.fetch=originalFetch;}

// Representative size of the real 2K PNG incident, manufactured locally. The
// actual Workers transport must retain every reference byte and request field.
const imageBytes=7_758_875,receipt='764cabcf-b745-4b3e-ae38-1200304cf45b';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import {generateFal} from './lib/fal-provider';
export default {async fetch(){
  const ref='data:image/png;base64,'+btoa('x'.repeat(${imageBytes}));
  const result=await generateFal({model:'fal-minimax-h3-max',kind:'video',prompt:'x'.repeat(9657),duration:6},'mock-key',[ref],'16:9');
  return Response.json({pending:result.pending,requestId:result.requestId,actual:result.actual});
}};`},bundle:true,write:false,format:'esm',platform:'browser'});
let workerCalls=0;
const worker=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:bundle.outputFiles[0].text,outboundService:async req=>{
  workerCalls++;assert.equal(req.url,'https://queue.fal.run/minimax/h3-max/image-to-video');assert.equal(req.method,'POST');assert.equal(req.headers.get('authorization'),'Key mock-key');
  const body=await req.json(),data=body.image_url.split(',')[1],bytes=Buffer.from(data,'base64');
  assert.equal(bytes.length,imageBytes);assert(bytes.every(value=>value===120),'Reference bytes remain exact');
  assert.deepEqual({...body,image_url:'reference'}, {prompt:'x'.repeat(9657),image_url:'reference',duration:6,resolution:'768P',prompt_expansion_mode:'disabled',enable_safety_checker:true,sync_mode:false});
  return Response.json({request_id:receipt});
}});
try{const response=await worker.dispatchFetch('http://worker.test');assert.equal(response.status,200);assert.deepEqual(await response.json(),{pending:true,requestId:receipt,actual:null});assert.equal(workerCalls,1);}finally{await worker.dispose();}
console.log('PASS fal payload memory: no duplicate preflight body, exact 7,758,875-byte reference in workerd, unchanged H3 request/receipt, local validation and no POST retries. All provider calls mocked.');
