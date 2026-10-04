import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/media-base64.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/media-base64.mjs'});
const {decodeMediaBase64}=await import('../work/tests/media-base64.mjs');
for(const size of [0,1,2,3,24575,24576,24577,49153,2*1024*1024]){
  const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%251;
  assert.deepEqual(Buffer.from(decodeMediaBase64(bytes.toString('base64'))),bytes);
  assert.deepEqual(Buffer.from(decodeMediaBase64(bytes.toString('base64').replace(/=+$/,''))),bytes);
}
assert.deepEqual([...decodeMediaBase64(' A A\n== ')],[0]);
for(const input of ['A','AA=','A===','AA==BBBB','data:image/png;base64,AA==','!!!!'])assert.throws(()=>decodeMediaBase64(input));
// Standalone runs in Node. The hosted repository additionally executes this
// large-response scenario in the actual Cloudflare runtime via Miniflare.
await build({entryPoints:['lib/providers.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/media-memory-providers.mjs'});
const {generate}=await import('../work/tests/media-memory-providers.mjs');
const encoded=Buffer.alloc(6*1024*1024,123).toString('base64'),originalFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.body.getAll('image[]').length,2);assert.equal(options.body.getAll('image[]')[0].size,2*1024*1024);return Response.json({data:[{b64_json:encoded}]},{headers:{'x-request-id':'memory-test'}});};
try{const ref='data:image/png;base64,'+Buffer.alloc(2*1024*1024,120).toString('base64');const out=await Promise.all([1,2,3].map(()=>generate({kind:'image',model:'gpt-image-2.5-sunburst',prompt:'Test'},'test-key',[ref,ref],'16:9')));assert.equal(calls,3);for(const r of out){assert.equal(r.bytes.length,6*1024*1024);assert.equal(r.bytes[0],123);assert.equal(r.bytes[r.bytes.length-1],123);assert.equal(r.requestId,'memory-test');}}finally{globalThis.fetch=originalFetch;}
console.log('PASS: chunked binary decoding and three simultaneous GPT Image edits with large references/responses in standalone Node runtime. No paid calls or retries.');
