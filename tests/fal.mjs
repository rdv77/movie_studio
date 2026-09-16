import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({entryPoints:['lib/providers.ts','lib/fal-models.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/fal',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/fal/providers.mjs'),M=await import('../work/tests/fal/fal-models.mjs');
const key='fal_test_secret_only',requestId='764cabcf-b745-4b3e-ae38-1200304cf45b',root='https://queue.fal.run/fal-ai/qwen-image-edit-2511';
const job={model:M.FAL_QWEN,kind:'image',prompt:'Герой в сцене',refs:['photo']},ref='data:image/png;base64,AA==';
let requests=[],mode='ok',state='IN_QUEUE',resultUrl;
const old=globalThis.fetch;
try {
 globalThis.fetch=async(url,init)=>{
  requests.push({url,method:init.method,body:init.body});assert.equal(init.headers.Authorization,'Key '+key);assert.equal(init.redirect,'manual');
  if(mode==='timeout')throw Error('network');
  if(mode==='400')return Response.json({detail:'bad '+key},{status:400});
  if(mode==='401')return Response.json({detail:key},{status:401});
  if(url===root){const body=JSON.parse(init.body);assert.deepEqual(body.image_urls,[ref]);assert.equal(body.enable_safety_checker,true);assert.equal(body.num_images,1);assert.equal(body.output_format,'png');assert.equal(body.sync_mode,false);return Response.json({request_id:mode==='missing'?undefined:requestId});}
  if(url===root+'/requests/'+requestId+'/status')return Response.json({status:state,response_url:resultUrl});
  if([root+'/requests/'+requestId,root+'/requests/'+requestId+'/response'].includes(url))return Response.json({images:[{url:'https://v3.fal.media/test.png',width:1024,height:576}],seed:123,has_nsfw_concepts:[mode==='blocked']});
  throw Error('Unexpected URL '+url);
 };
 for(const [format,w,h] of [['16:9',1024,576],['9:16',576,1024],['1:1',1024,1024]]){
  const r=await P.generate(job,key,[ref],format);assert.equal(r.requestId,requestId);assert(r.pending);assert.equal(r.actual,null);
  assert.deepEqual(JSON.parse(requests.at(-1).body).image_size,{width:w,height:h});
 }
 let before=requests.length;
 for(const [j,refs] of [[job,[]],[job,['https://untrusted.test/x.png']],[{...job,prompt:'a'.repeat(5001)},[ref]]])await assert.rejects(()=>P.generate(j,key,refs,'16:9'),e=>e.notSent);
 assert.equal(requests.length,before);
 assert.throws(()=>M.prepareFalJobs([job],[]),/референс/);
 assert.throws(()=>M.prepareFalJobs([job],[{mime:'image/png',size:21*1024*1024}]),/20 МБ/);
 for(const m of ['timeout','missing']){mode=m;before=requests.length;await assert.rejects(()=>P.generate(job,key,[ref],'16:9'),e=>!e.definite&&!e.notSent);assert.equal(requests.length,before+1);}
 for(const m of ['400','401']){mode=m;await assert.rejects(()=>P.generate(job,key,[ref],'16:9'),e=>e.definite&&!e.message.includes(key));}
 mode='ok';const pollJob={...job,requestId},posts=requests.filter(r=>r.method==='POST').length;
 for(const s of ['IN_QUEUE','IN_PROGRESS']){state=s;assert((await P.poll(pollJob,key)).pending);}
 state='COMPLETED';for(const url of [undefined,root+'/requests/'+requestId,root+'/requests/'+requestId+'/response']){resultUrl=url;const out=await P.poll(pollJob,key);assert.equal(out.url,'https://v3.fal.media/test.png');assert.equal(out.actual,null);assert.equal(out.usage.seed,123);}
 resultUrl='https://evil.test/steal';before=requests.length;await assert.rejects(()=>P.poll(pollJob,key),/адрес/);assert.equal(requests.length,before+1);
 before=requests.length;await assert.rejects(()=>P.poll({...job,requestId:'../x'},key),e=>e.notSent);assert.equal(requests.length,before);
 resultUrl=undefined;mode='blocked';assert((await P.poll(pollJob,key)).error);
 assert.equal(requests.filter(r=>r.method==='POST').length,posts);
} finally {globalThis.fetch=old;}
console.log('PASS fal Qwen: ordered references, dimensions, safety, queue lifecycle, private auth, no resubmission, malformed receipts, result URL guard, redacted errors, estimates separate from actual.');
