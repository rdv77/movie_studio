import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/providers.ts','lib/models.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/minimax-h3',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/minimax-h3/providers.mjs'),M=await import('../work/tests/minimax-h3/models.mjs');
assert.equal(M.model('MiniMax-H3').kind,'video');assert.equal(M.model('MiniMax-H3').estimate,'4800000000');
const job={kind:'video',model:'MiniMax-H3',prompt:'Камера следует за героем. Рот закрыт.',duration:4},frame='data:image/png;base64,AA==',key='fake-h3-key';
const previous=globalThis.fetch;let calls=0;
try {
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://api.minimax.io/v2/video_generation');assert.equal(options.headers.Authorization,`Bearer ${key}`);assert.equal(options.redirect,'manual');
    assert.deepEqual(JSON.parse(options.body),{model:'MiniMax-H3',content:[{type:'text',text:job.prompt},{type:'image_url',image_url:{url:frame},role:'first_frame'}],resolution:'768P',duration:6,ratio:'adaptive'});
    return Response.json({task_id:'h3-task'});
  };
  const sent=await P.generate(job,key,[frame],'16:9');assert.equal(sent.requestId,'h3-task');assert(sent.pending);assert.equal(sent.actual,null);
  for(const refs of [[],[frame,frame],['data:image/gif;base64,AA==']])await assert.rejects(()=>P.generate(job,key,refs,'16:9'),e=>e.notSent&&e.definite);
  await assert.rejects(()=>P.generate(job,key,[frame],'16:9',[frame]),e=>e.notSent);
  assert.equal(calls,1);
  for(const status of ['queued','running','succeeded','failed','cancelled','unexpected']) {
    globalThis.fetch=async(url,options)=>{
      calls++;assert.equal(url,'https://api.minimax.io/v2/query/video_generation/h3-task');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,`Bearer ${key}`);
      return Response.json({task:{id:'h3-task',status,content:{url:'https://cdn.example/h3.mp4'},usage:{output_seconds:6}}});
    };
    if(status==='unexpected'){await assert.rejects(()=>P.poll({...job,requestId:'h3-task'},key),/неизвестный статус/);continue;}
    const r=await P.poll({...job,requestId:'h3-task'},key);
    if(['queued','running'].includes(status))assert(r.pending);
    else if(status==='succeeded'){assert.equal(r.url,'https://cdn.example/h3.mp4');assert.equal(r.usage.output_seconds,6);assert.equal(r.actual,null);}
    else assert(r.error);
  }
  globalThis.fetch=async()=>Response.json({task:{id:'another-task',status:'succeeded'}});
  await assert.rejects(()=>P.poll({...job,requestId:'h3-task'},key),/неизвестной задачи/);
  globalThis.fetch=async()=>Response.json({task:{id:'h3-task',status:'succeeded'}});
  assert((await P.poll({...job,requestId:'h3-task'},key)).error);
  globalThis.fetch=async()=>Response.json({error:{message:key}},{status:401});
  await assert.rejects(()=>P.generate(job,key,[frame],'16:9'),e=>e.definite&&!e.message.includes(key));
  globalThis.fetch=async()=>{calls++;throw Error('network')};const before=calls;
  await assert.rejects(()=>P.generate(job,key,[frame],'16:9'),e=>!e.definite&&!e.notSent);assert.equal(calls,before+1);
}finally{globalThis.fetch=previous;}
console.log('PASS MiniMax H3 V2: first-frame contract, camera/speech prompt unchanged, 6s/768P budget estimate, task polling/result/errors, no duplicate paid requests.');
