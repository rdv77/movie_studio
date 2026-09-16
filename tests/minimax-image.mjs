import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/providers.ts','lib/minimax-image.ts','lib/models.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/minimax-image',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/minimax-image/providers.mjs'),I=await import('../work/tests/minimax-image/minimax-image.mjs'),M=await import('../work/tests/minimax-image/models.mjs');
assert.equal(M.model('image-01').kind,'image');assert.equal(M.model('image-01').provider,'minimax');assert.equal(M.model('image-01').estimate,I.MINIMAX_IMAGE_ESTIMATE);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=';
const job={model:'image-01',kind:'image',prompt:'Один герой у моря.'},key='test-minimax-secret';
const original=globalThis.fetch;let calls=0;
try {
  for(const refs of [[],[png],[png,png]]) {
    globalThis.fetch=async(url,options)=>{
      calls++;assert.equal(url,'https://api.minimax.io/v1/image_generation');assert.equal(options.headers.Authorization,`Bearer ${key}`);assert.equal(options.redirect,'manual');
      const body=JSON.parse(options.body);assert.equal(body.model,'image-01');assert.equal(body.n,1);assert.equal(body.aspect_ratio,'16:9');assert.equal(body.response_format,'url');assert.equal(body.prompt_optimizer,false);assert.equal(body.prompt,job.prompt);
      assert.deepEqual(body.subject_reference,refs.length?refs.map(image_file=>({type:'character',image_file})):undefined);
      return Response.json({id:'trace-image',base_resp:{status_code:0},data:{image_urls:['https://cdn.example/image.png']},metadata:{success_count:1,failed_count:0}});
    };
    const result=await P.generate(job,key,refs,'16:9');assert.equal(result.url,'https://cdn.example/image.png');assert.equal(result.requestId,'trace-image');assert.equal(result.actual,null);assert.equal(result.usage.success_count,1);assert(!result.pending);
  }
  const before=calls;
  for(const [prompt,refs,format] of [['x'.repeat(1501),[],'16:9'],['',[],'16:9'],['x',Array(9).fill(png),'16:9'],['x',[png.replace('png','webp')],'16:9'],['x',['https://example.com/portrait.png'],'16:9'],['x',[],'bad']])
    await assert.rejects(()=>P.generate({...job,prompt},key,refs,format),e=>e.definite&&e.notSent);
  assert.equal(calls,before,'Invalid inputs rejected before paid call');
  globalThis.fetch=async()=>Response.json({base_resp:{status_code:1008,status_msg:'insufficient balance'}});
  await assert.rejects(()=>P.generate(job,key,[],'16:9'),e=>e.definite&&/balance/.test(e.message));
  globalThis.fetch=async()=>Response.json({error:{message:key}},{status:401});
  await assert.rejects(()=>P.generate(job,key,[],'16:9'),e=>e.definite&&!e.message.includes(key));
  globalThis.fetch=async()=>{calls++;throw new TypeError('network')};const sent=calls;
  await assert.rejects(()=>P.generate(job,key,[],'16:9'),e=>!e.definite&&!e.notSent);assert.equal(calls,sent+1,'No paid automatic retries');
  globalThis.fetch=async()=>Response.json({id:'empty',base_resp:{status_code:0},data:{image_urls:[]},metadata:{success_count:0,failed_count:1}});
  const empty=await P.generate(job,key,[],'16:9');assert(empty.error);assert.equal(empty.requestId,'empty');assert.equal(empty.usage.failed_count,1);assert.equal(empty.actual,null);
} finally {globalThis.fetch=original;}
assert(I.miniMaxImageRefIssue([{mime:'image/png',size:10*1024*1024}]));
assert(I.miniMaxImageRefIssue(Array(3).fill({mime:'image/jpeg',size:8*1024*1024})));
assert.equal(I.miniMaxImageRefIssue([{mime:'image/png',size:100}]),'');
console.log('PASS MiniMax image-01: direct image endpoint, shared Bearer key, ordered portrait references, one image, receipt/estimate separation, local caps, safe errors, no automatic paid retries.');
