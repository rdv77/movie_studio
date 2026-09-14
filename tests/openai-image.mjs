import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {ProviderHarness as Miniflare} from './provider-harness.mjs';
await build({entryPoints:['lib/providers.ts','lib/openai-image.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/openai-image',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/openai-image/providers.mjs'),I=await import('../work/tests/openai-image/openai-image.mjs');
const usage={input_tokens:300,input_tokens_details:{text_tokens:100,image_tokens:200},output_tokens:300,total_tokens:600};
assert.equal(I.openAIImageTariff(usage),'111000000');assert.equal(I.openAIImageTariff({...usage,input_tokens:301}),null);assert.equal(I.openAIImageTariff({}),null);assert.equal(I.openAIImageTariff({...usage,output_tokens_details:{text_tokens:1,image_tokens:299}}),null);
const models=['gpt-image-2.5-sunburst','gpt-image-2.5-flare'],job={kind:'image',prompt:'Один герой на простом фоне.'};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=';
const originalFetch=globalThis.fetch;let calls=0;
try {
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(options.headers.Authorization,'Bearer test-secret');assert.equal(options.redirect,'manual');
    if(String(url).endsWith('/generations')){
      const body=JSON.parse(options.body);assert(models.includes(body.model));assert.equal(body.n,1);assert.equal(body.quality,'high');assert.equal(body.size,'1536x864');assert.equal(body.output_format,'png');assert(!('response_format' in body));
    }else{
      assert(String(url).endsWith('/edits'));assert(options.body instanceof FormData);assert(!('content-type' in options.headers));
      assert.equal(options.body.get('size'),'864x1536');assert.equal(options.body.getAll('image[]').length,2);assert.equal(options.body.get('quality'),'high');
      assert.deepEqual(new Uint8Array(await options.body.getAll('image[]')[0].arrayBuffer()),new Uint8Array(Buffer.from(png,'base64')));
    }
    return Response.json({data:[{b64_json:png}],usage},{headers:{'x-request-id':'request-test'}});
  };
  for(const model of models){const result=await P.generate({...job,model},'test-secret',[],'16:9');assert.equal(result.mime,'image/png');assert.equal(result.actual,null);assert.deepEqual(result.usage,usage);assert.equal(result.requestId,'request-test');assert(result.bytes.length>30);
    await P.generate({...job,model},'test-secret',['data:image/png;base64,'+png,'data:image/png;base64,'+png],'9:16');}
  assert.equal(calls,4);const count=calls;
  for(const [prompt,refs] of [['x'.repeat(32001),[]],['x',Array(9).fill('data:image/png;base64,'+png)],['x',['data:image/png;base64,A']],['x',['https://invalid.example/image.png']]])
    await assert.rejects(()=>P.generate({...job,model:models[0],prompt},'test-secret',refs,'16:9'),e=>e.definite&&e.notSent);
  assert.equal(calls,count,'Invalid requests never reach the provider');
  globalThis.fetch=async()=>Response.json({data:[],usage},{headers:{'x-request-id':'empty'}});const empty=await P.generate({...job,model:models[0]},'test-secret',[],'1:1');assert(empty.error);assert.deepEqual(empty.usage,usage);assert.equal(empty.actual,null);
  globalThis.fetch=async()=>Response.json({error:{message:'test-secret'}},{status:401});await assert.rejects(()=>P.generate({...job,model:models[0]},'test-secret',[],'16:9'),e=>e.definite&&!e.message.includes('test-secret'));
}finally{globalThis.fetch=originalFetch;}
// Confirm multipart encoding with the actual Cloudflare Worker fetch implementation.
const result=await build({stdin:{contents:`import {generate} from './lib/providers';export default {async fetch(){const r=await generate({kind:'image',model:'gpt-image-2.5-sunburst',prompt:'Один герой'},'test-key',['data:image/png;base64,${png}'],'16:9');return Response.json({mime:r.mime,bytes:r.bytes.length,actual:r.actual})}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
let workerCalls=0;const mf=new Miniflare({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-05-15',outboundService:async request=>{
  workerCalls++;assert.equal(request.url,'https://api.openai.com/v1/images/edits');assert.match(request.headers.get('content-type'),/^multipart\/form-data; boundary=/);const form=await request.formData();assert.equal(form.get('model'),models[0]);assert.equal(form.getAll('image[]').length,1);return Response.json({data:[{b64_json:png}],usage});
}});
try{const out=await(await mf.dispatchFetch('http://worker.test')).json();assert.equal(out.mime,'image/png');assert(out.bytes>30);assert.equal(out.actual,null);assert.equal(workerCalls,1);}finally{await mf.dispose();}
console.log('PASS GPT Image 2.5: both models, generation/edit endpoints, actual Worker multipart bytes, format/high-quality settings, ownership-independent local validation, usage and request IDs, tariff estimates separated from billing and safe errors. No paid calls.');
