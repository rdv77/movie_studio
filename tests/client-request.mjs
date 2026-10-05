import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['lib/client-request.ts','lib/provider-http.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/client-request',outExtension:{'.js':'.mjs'}});
const C=await import('../work/tests/client-request/client-request.mjs');
const P=await import('../work/tests/client-request/provider-http.mjs');
const oldFetch=globalThis.fetch;
const route='/api/projects/film/jobs/attempt';
const html='<!DOCTYPE html><html>Internal page private-key-and-scenario</html>';
const broken=(status=502)=>new Response(html,{status,headers:{'content-type':'text/html'}});
let calls=[];
const replies=(...responses)=>{calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});const next=responses.shift();if(next instanceof Error)throw next;if(!next)throw Error('Unexpected extra request');return next;};};
const safe=e=>e instanceof C.ApiResponseError&&!e.message.includes('Unexpected token')&&!e.message.includes('private-key')&&!e.message.includes('<!DOCTYPE');
try{
  replies(Response.json({revision:12,jobs:[]}));
  assert.deepEqual(await C.request(route),{revision:12,jobs:[]});
  assert.equal(calls[0].opts.headers.accept,'application/json');
  replies(broken(),Response.json({revision:13}));
  assert.equal((await C.request(route)).revision,13);
  assert.equal(calls.length,2,'One safe GET reread recovers a gateway HTML response');
  assert(calls.every(c=>c.opts.method==='GET'));
  replies(new TypeError('private-key-network'),Response.json([]));
  assert.deepEqual(await C.request('/api/projects'),[]);
  assert.equal(calls.length,2);
  replies(broken(200),broken(200));
  await assert.rejects(()=>C.request(route+'?token=private-key'),e=>safe(e)&&e.status===200&&e.endpoint===route&&!e.message.includes('token='));
  assert.equal(calls.length,2,'Repeated invalid reads are bounded');
  for(const status of [401,403,404]){
    replies(broken(status));
    await assert.rejects(()=>C.request(route),e=>safe(e)&&e.status===status);
    assert.equal(calls.length,1,'No authorization/not-found retry');
  }
  for(const method of ['POST','PATCH','DELETE']){
    replies(broken(524));
    await assert.rejects(()=>C.request(route,method,{batchId:'stable-id'}),e=>safe(e)&&e.status===524&&e.uncertain&&e.message.includes('журнал'));
    assert.equal(calls.length,1,'Ambiguous writes never replay');
    assert.equal(calls[0].opts.body,JSON.stringify({batchId:'stable-id'}));
  }
  replies(new TypeError('private-key-network'));
  await assert.rejects(()=>C.request(route,'POST'),e=>safe(e)&&e.status===0&&e.uncertain);
  assert.equal(calls.length,1);
  replies(Response.json({error:'Проверьте заполненные поля.'},{status:400}));
  await assert.rejects(()=>C.request(route,'PATCH',{}),e=>e.message==='Проверьте заполненные поля.'&&e.status===400&&!e.uncertain);
  assert.equal(calls.length,1);
  replies(Response.json({error:{message:'Не удалось сохранить результат.'}}));
  await assert.rejects(()=>C.request(route,'POST',{}),/Не удалось сохранить результат/);
  replies(Response.json({error:`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`},{status:400}));
  await assert.rejects(()=>C.request(route,'POST',{}),safe);
  for(const response of [new Response(html,{headers:{'content-type':'application/json'}}),Response.json(null),Response.json('unexpected'),new Response('')]){
    replies(response);
    await assert.rejects(()=>C.request(route,'POST',{}),e=>safe(e)&&e.uncertain);
    assert.equal(calls.length,1,'Invalid 2xx data is not a successful save');
  }
  const form=new FormData();form.set('projectId','film');
  replies(Response.json({id:'asset'}));
  assert.equal((await C.request('/api/assets','POST',form)).id,'asset');
  assert.equal(calls[0].opts.body,form);
  assert.equal(calls[0].opts.headers['content-type'],undefined,'Browser supplies the multipart boundary');
  for(const response of [broken(200),new Response(html,{headers:{'content-type':'application/json'}}),Response.json(null),Response.json([])]){
    await assert.rejects(()=>P.json(response),e=>e instanceof P.ProviderError&&!e.definite&&!e.notSent&&!e.message.includes('Unexpected token')&&!e.message.includes('private-key')&&e.message.includes('Исход запроса неизвестен'));
  }
  assert.deepEqual(await P.json(Response.json({id:'receipt',data:[]})),{id:'receipt',data:[]});
  await assert.rejects(()=>P.json(Response.json({base_resp:{status_code:1001,status_msg:'Invalid params'}})),e=>e instanceof P.ProviderError&&e.definite&&e.message.includes('Invalid params'));
  const ui=await readFile('app/studio.tsx','utf8');
  assert.match(ui,/import \{request,ApiResponseError\} from '@\/lib\/client-request'/);
  replies(Response.json({error:'Capacity',code:'MEDIA_WORKER_BUSY'},{status:503}));
  await assert.rejects(()=>C.request(route,'POST'),e=>e.code==='MEDIA_WORKER_BUSY'&&!e.uncertain);
  assert.equal(calls.length,1,'A capacity response does not replay the POST');
  assert.match(ui,/e\.code==='MEDIA_WORKER_BUSY'\)return/);
  assert.match(ui,/Read saved state; never create a replacement attempt\.[\s\S]*invalidateQueries/);
  console.log('PASS client responses: HTML/malformed/network recovery for GET, bounded rereads, status/endpoint diagnostics without response disclosure, zero write retries, multipart and JSON API errors; provider invalid success remains ambiguous. No paid requests.');
}finally{globalThis.fetch=oldFetch;}
