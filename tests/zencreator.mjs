import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/providers.ts','lib/zencreator-provider.ts','lib/zencreator-models.ts','lib/models.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/zencreator',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/zencreator/providers.mjs'),Z=await import('../work/tests/zencreator/zencreator-provider.mjs'),M=await import('../work/tests/zencreator/zencreator-models.mjs');
const id='8f468298-48ca-4c8f-bebe-1300f558a620',a='180c1e98-8779-477b-a7bc-cc62145c1c38',b='b9a5e4c3-0e48-4a18-8436-fb080e3853dc',task='82c5083e-f191-4d8f-8daa-75d9cc192ab0';
const root='https://api.zencreator.pro/api/public/v1',key='zc_live_test_only',image='data:image/png;base64,AA==';
const catalog={tools:['run_any_llm','image_editor','by_prompt','videogen'].map(name=>({name,input_schema:{properties:{model:{enum:M.ZEN_MODELS.filter(m=>M.zenTool(m.id,name==='image_editor'?1:0)===name).map(m=>M.zenProfile(m.id).native)}}}}))};
let requests=[],uploads=0,mode='success',status='succeeded',missingDownload=false,downloadVersion=0;
const old=globalThis.fetch;
try{
 globalThis.fetch=async(url,opt)=>{
  requests.push({url,method:opt.method});assert.equal(opt.headers.Authorization,`Bearer ${key}`);assert.equal(opt.redirect,'manual');
  if(mode==='auth')return Response.json({error:key},{status:401});
  if(url===root+'/tools')return Response.json(mode==='no-model'?{tools:[]}:catalog);
  if(url===root+'/balance')return Response.json({credits:250});
  if(url===root+'/assets'){
   if(mode==='upload-failure')throw Error('timeout');
   assert(opt.body instanceof FormData);assert(!opt.headers['content-type']);assert.equal(opt.body.get('media_type'),'image/png');
   assert.equal(opt.body.get('file').size,1);return Response.json({asset_id:uploads++%2===0?a:b});
  }
  if(url===root+'/generations'){
   if(mode==='timeout')throw Error('timeout');
   assert.equal(opt.headers['Idempotency-Key'],id);
   const body=JSON.parse(opt.body),input=body.input;
   assert(!JSON.stringify(body).includes('data:'));
   if(body.tool==='image_editor'){assert.deepEqual(input.image_assets,[a,b]);assert.equal(input.batch_mode,false);assert.equal(input.number_of_images,1);assert.equal(input.ratio,'16:9');}
   if(body.tool==='by_prompt'){assert.equal(input.batch_size,1);assert.equal(input.positive_prompt,'Задача');assert(!input.image_assets);}
   if(body.tool==='videogen'){assert.equal(input.ref_asset,a);assert.equal(input.duration,10);assert.equal(input.resolution,'720p');assert.equal(input.generate_audio,false);assert.equal(input.prompt_extend,false);assert.match(input.prompt,/10-секундного/);}
   if(body.tool==='run_any_llm'){assert.equal(input.max_tokens,4096);assert(!input.image_assets);}
   return Response.json({id:task,status:'queued'},{status:202});
  }
  if(url===root+'/generations/'+task)return Response.json({id:task,status,error:status==='failed'?'failed '+key:null});
  if(url===root+'/generations/'+task+'/result')return Response.json({id:task,status,text:'Готовый сценарий',outputs:[{url:'https://cdn.example/preview',download_url:missingDownload?null:`https://cdn.example/original-${downloadVersion++}`} ]});
  throw Error('Unexpected test URL '+url);
 };
 const check=await Z.checkZenConnection(key);assert.equal(check.credits,250);assert.equal(check.models.length,22);assert(check.models.every(m=>m.available));assert(requests.every(r=>r.method==='GET'));
 const job={id,kind:'image',model:'zencreator:image:SEEDREAM_5_PRO',prompt:'Задача',refs:[a,b],duration:5};
 const editor=catalog.tools.find(t=>t.name==='image_editor');
 editor.input_schema.$defs={Model:editor.input_schema.properties.model};editor.input_schema.properties.model={$ref:'#/$defs/Model'};
 let sent=await P.generate(job,key,[image,image],'16:9');assert.equal(sent.requestId,task);assert(sent.pending);assert.equal(sent.actual,null);assert.equal(sent.usage.credits_estimate,3);
 await P.generate({...job,refs:[]},key,[],'16:9');
 uploads=0;await P.generate({...job,kind:'video',model:'zencreator:video:kling@2.6',refs:[a],prompt:'Рты закрыты до конца 6-секундного клипа'},key,[image],'16:9');
 await P.generate({...job,kind:'text',model:'zencreator:text:grok',refs:[]},key,[],'16:9');
 let count=requests.length;await assert.rejects(()=>P.generate({...job,kind:'text',model:'zencreator:text:grok',refs:[],prompt:'a'.repeat(32001)},key,[],'16:9'),e=>e.notSent);assert.equal(requests.length,count);
 await assert.rejects(()=>P.generate({...job,prompt:'a'.repeat(5001)},key,[image,image],'16:9'),e=>e.notSent&&e.definite&&e.message.includes('5000'));assert.equal(requests.length,count,'Oversized old jobs are stopped even when the catalog omits maxLength');
 await assert.rejects(()=>P.generate(job,key,[image],'16:9'),e=>e.notSent);assert.equal(requests.length,count);
 for(const fail of ['auth','no-model','upload-failure']){
  mode=fail;count=requests.filter(r=>r.url===root+'/generations').length;
  await assert.rejects(()=>P.generate(job,key,[image,image],'16:9'),e=>e.definite&&e.notSent&&!e.message.includes(key));
  assert.equal(requests.filter(r=>r.url===root+'/generations').length,count);
 }
 mode='timeout';count=requests.filter(r=>r.url===root+'/generations').length;
 await assert.rejects(()=>P.generate(job,key,[image,image],'16:9'),e=>!e.definite&&!e.notSent);assert.equal(requests.filter(r=>r.url===root+'/generations').length,count+1);
 mode='success';const pollJob={...job,requestId:task,zenCreditsEstimate:3};count=requests.filter(r=>r.method==='POST').length;
 for(const s of ['queued','processing']){status=s;assert((await P.poll(pollJob,key)).pending);}
 status='succeeded';let out=await P.poll(pollJob,key);assert.equal(out.url,'https://cdn.example/original-0');assert.equal(out.actual,null);
 out=await P.poll({...pollJob,status:'saving'},key);assert.equal(out.url,'https://cdn.example/original-1');
 missingDownload=true;await assert.rejects(()=>P.poll(pollJob,key),e=>!e.definite);missingDownload=false;
 assert.equal((await P.poll({...pollJob,kind:'text'},key)).text,'Готовый сценарий');
 status='partial';assert((await P.poll(pollJob,key)).url);
 status='failed';out=await P.poll(pollJob,key);assert(out.error);assert(!out.error.includes(key));assert.equal(out.actual,null);
 status='unknown';await assert.rejects(()=>P.poll(pollJob,key),/неизвестный статус/);
 assert.equal(requests.filter(r=>r.method==='POST').length,count,'Polling and refreshed URLs never restart paid generation');
 assert.equal(M.zenCredits('zencreator:image:NANO_BANANA',2),4);assert.equal(M.zenCredits('zencreator:video:wan@2.7',1),20);
 assert(M.ZEN_MODELS.every(m=>m.estimate===null));
}finally{globalThis.fetch=old;}
console.log('PASS ZenCreator: 22 task-specific profiles; catalog/balance; ordered multipart references; image/text/video contracts; credits separate from USD; idempotency; safe errors; polling originals and URL refresh without resubmission.');
