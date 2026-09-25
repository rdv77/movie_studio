import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({entryPoints:['lib/providers.ts','lib/fal-models.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/fal-video',outExtension:{'.js':'.mjs'}});
const P=await import('../work/tests/fal-video/providers.mjs'),M=await import('../work/tests/fal-video/fal-models.mjs');
const key='fal_mock_private_key',id='764cabcf-b745-4b3e-ae38-1200304cf45b',ref='data:image/png;base64,AA==';
const original=globalThis.fetch;
try {
 for(const model of [M.FAL_H3,M.FAL_WAN]) {
  const job={model,kind:'video',prompt:'A slow camera push. Keep the mouth closed.',duration:6,refs:['frame']};
  const endpoint='https://queue.fal.run/'+M.FAL_ENDPOINTS[model];
  const queue='https://queue.fal.run/'+M.FAL_ENDPOINTS[model].split('/').slice(0,2).join('/')+'/requests/'+id;
  let calls=[],state='IN_QUEUE',resultUrl=queue,mode='ok',missingVideo=false;
  globalThis.fetch=async(url,init)=>{
   calls.push({url,method:init.method});
   assert.equal(init.headers.Authorization,'Key '+key);assert.equal(init.redirect,'manual');
   if(mode==='network')throw Error('connection interrupted');
   if(mode==='401')return Response.json({detail:key},{status:401});
   if(url===endpoint){
    assert.equal(init.method,'POST');const b=JSON.parse(init.body);
    assert.equal(b.image_url,ref);assert.equal(b.prompt,job.prompt);assert.equal(b.enable_safety_checker,true);
    if(model===M.FAL_H3){assert.equal(b.duration,6);assert.equal(b.resolution,'768P');assert.equal(b.prompt_expansion_mode,'disabled');assert.equal(b.sync_mode,false);}
    else {assert.equal(b.num_frames,97);assert.equal(b.frames_per_second,16);assert.equal(b.resolution,'720p');assert.equal(b.aspect_ratio,'9:16');assert.equal(b.enable_prompt_expansion,false);assert.equal(b.enable_output_safety_checker,true);assert.equal(b.adjust_fps_for_interpolation,true);}
    return Response.json({request_id:mode==='missing'?undefined:id,status_url:queue+'/status'});
   }
   assert.equal(init.method,'GET');
   if(url===queue+'/status')return Response.json({status:state,response_url:resultUrl});
   if(url===queue)return Response.json(missingVideo?{}:{video:{url:'https://v3.fal.media/test.mp4'},seed:42});
   throw Error('Unexpected URL '+url);
  };
  const result=await P.generate(job,key,[ref],'9:16');assert(result.pending);assert.equal(result.requestId,id);assert.equal(result.actual,null);
  const before=calls.length;
  for(const [j,refs] of [[job,[]],[job,[ref,ref]],[job,['https://foreign.test/x.png']],[{...job,duration:7},[ref]],[{...job,prompt:'x'.repeat(5001)},[ref]],[{...job,kind:'image'},[ref]]])
   await assert.rejects(()=>P.generate(j,key,refs,'9:16'),e=>e.notSent);
  assert.equal(calls.length,before);
  assert.throws(()=>M.prepareFalJobs([job],[{mime:'image/png',size:21*1024*1024}]),/20 МБ/);
  const polling={...job,requestId:id};
  for(const status of ['IN_QUEUE','IN_PROGRESS']){state=status;assert((await P.poll(polling,key)).pending);}
  state='COMPLETED';const video=await P.poll(polling,key);assert.equal(video.mime,'video/mp4');assert.equal(video.url,'https://v3.fal.media/test.mp4');assert.equal(video.actual,null);
  for(const hostile of ['https://evil.test/steal',queue+'?key=exfiltrate',queue.replace('/requests/'+id,'/requests/ffffffff-ffff-ffff-ffff-ffffffffffff')]) {
   resultUrl=hostile;const n=calls.length;await assert.rejects(()=>P.poll(polling,key),/адрес/);assert.equal(calls.length,n+1);
  }
  resultUrl=queue;missingVideo=true;await assert.rejects(()=>P.poll(polling,key),/не содержит видео/);missingVideo=false;
  state='UNKNOWN';await assert.rejects(()=>P.poll(polling,key),/статус/);
  assert.equal(calls.filter(c=>c.method==='POST').length,1,'Polling never submits a new generation');
  for(const failure of ['network','missing']) {mode=failure;const n=calls.length;await assert.rejects(()=>P.generate(job,key,[ref],'9:16'),e=>!e.notSent&&!e.definite);assert.equal(calls.length,n+1);}
  mode='401';await assert.rejects(()=>P.generate(job,key,[ref],'9:16'),e=>e.definite&&!e.message.includes(key));
 }
} finally {globalThis.fetch=original;}
console.log('PASS fal video: H3/Wan contracts, safe parent queue paths, video output, budgets remain estimates, invalid inputs before POST, redacted errors, no retries after ambiguous receipt.');
