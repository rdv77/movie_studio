import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/provider-http.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/provider-forbidden.mjs'});
const {call}=await import('../work/tests/provider-forbidden.mjs');
const old=globalThis.fetch,key='test_private_key_do_not_expose';let count=0,status=403,body;
try {
 globalThis.fetch=async()=>{count++;return typeof body==='string'?new Response(body,{status}):Response.json(body,{status});};
 for(const data of [{error:'Permission denied for model grok-imagine-image-2.0'},{error:{message:'Input image was rejected'}},{error:{code:'forbidden'},message:'Image endpoint permission missing'},{detail:'Team is blocked'}]) {
  body=data;const expected=data.error?.message??data.message??data.detail??data.error;
  await assert.rejects(()=>call('https://api.x.ai/v1/images/edits',{Authorization:'Bearer '+key},{prompt:'test'}),e=>e.definite&&!e.notSent&&e.message.includes(expected)&&!e.message.includes('Проверьте API-ключ'));
 }
 body={error:`Access denied ${key}\nBearer another_secret data:image/png;base64,AAAA`};
 await assert.rejects(()=>call('https://api.x.ai/v1/images/edits',{Authorization:'Bearer '+key},{}),e=>!e.message.includes(key)&&!e.message.includes('another_secret')&&!e.message.includes('AAAA')&&!e.message.includes('\n'));
 body='Forbidden';await assert.rejects(()=>call('https://api.x.ai/v1/images/edits',{}),/права API-ключа на изображения/);
 body={error:'x'.repeat(20000)};await assert.rejects(()=>call('https://api.x.ai/v1/images/edits',{}),e=>e.message.length<800);
 body={message:'Denied'};await assert.rejects(()=>call('https://example.test/api',{}),e=>e.message.includes('Denied')&&!e.message.includes('console.x.ai'));
 status=401;body={message:'private diagnostic'};await assert.rejects(()=>call('https://api.x.ai/v1/images/edits',{}),e=>!e.message.includes('private diagnostic'));
 assert.equal(count,9,'Never retry paid requests while reporting a refusal');
} finally {globalThis.fetch=old;}
console.log('PASS 403 diagnostics: provider explanation retained, no invented cause, keys and base64 redacted, bounded malformed/oversized body, no retry, 401 unchanged.');
