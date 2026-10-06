import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({entryPoints:['lib/provider-http.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/provider-diagnostics.mjs'});
const {call}=await import('../work/tests/provider-diagnostics.mjs');
const original=fetch,key='private-test-secret';let body,calls=0;
globalThis.fetch=async()=>{calls++;return Response.json(body,{status:422})};
try{
 body={detail:[{loc:['body','prompt'],msg:'String should have at most 5000 characters',input:'я'.repeat(60000)}]};
 await assert.rejects(()=>call('https://queue.fal.run/test',{Authorization:'Key '+key},{prompt:'x'}),e=>e.httpStatus===422&&e.message.includes('body.prompt: String should')&&!e.message.includes('яяя'));
 body={detail:[{loc:['body','image_url'],msg:`Invalid image ${key} https://signed.example/file?token=private data:image/png;base64,AAAA`,input:'SECRET'}]};
 await assert.rejects(()=>call('https://queue.fal.run/test',{Authorization:'Key '+key},{}),e=>e.message.includes('body.image_url')&&!/SECRET|private|AAAA/.test(e.message));
 assert.equal(calls,2,'Validation diagnostics do not retry generation');
 console.log('PASS bounded fal error arrays, truncated body recovery, field names, redaction, no paid retries.');
}finally{globalThis.fetch=original}
