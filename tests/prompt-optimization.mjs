import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/prompt-optimization-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-optimization.mjs',plugins:[{name:'mock-storage',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function getKey(_,provider){globalThis.keyReads++;if(provider!=='xai')throw Error('Missing key');return 'test-secret'};export async function mutate(_,__,fn){const copy=structuredClone(globalThis.film);fn(copy);globalThis.film=copy;return structuredClone(copy);}`}));
}}]});
const {prepareMediaPrompt}=await import('../work/tests/prompt-optimization.mjs');
const original=globalThis.fetch;globalThis.keyReads=0;
let calls=0,responseMode='ok',release;
const reset=(extra={})=>{const job={id:'media',itemId:'shot',batchId:'batch',model:'fal-kling-3.0-pro',kind:'video',prompt:'длинное описание '.repeat(300),refs:['start'],duration:6,created:new Date().toISOString(),status:'dispatching',estimate:'6720000000',actual:null,promptSections:[{key:'face',label:'Лицо',text:'Preserve face, blue eyes and red cloak.',required:true,priority:100},{key:'action',label:'Действие',text:'Raise arrow, mouth closed.',required:true,priority:100}],...extra};globalThis.film={id:'film',jobs:[job],limit:null};return structuredClone(job)};
globalThis.fetch=async(url,init)=>{
 calls++;if(String(url).endsWith(':countTokens'))return responseMode==='counter-unsupported'?Response.json({}, {status:404}):Response.json({totalTokens:600});
 assert.equal(url,'https://api.x.ai/v1/chat/completions');
 const body=JSON.parse(init.body);assert.equal(body.model,'grok-4.6');assert(body.messages[1].content.includes('required:true'));
 if(responseMode==='wait')await new Promise(r=>release=r);
 if(responseMode==='network')throw Error('offline');
 return Response.json({id:'llm-receipt',usage:{cost_in_usd_ticks:'12345'},choices:[{message:{content:responseMode==='bad'?'not JSON':JSON.stringify({sections:responseMode==='whole'?[{key:'prompt',text:'Keep blue eyes, red cloak and face. Raise arrow. Mouth closed.'}]:[{key:'face',text:'Keep blue eyes, red cloak and face.'},{key:'action',text:'Raise arrow. Mouth closed.'}]})}}]});
};
try{
 let j=reset({prompt:'Short prompt.'});assert.equal(await prepareMediaPrompt('owner','film',j,'media-key'),undefined);assert.equal(calls,0);assert.equal(globalThis.keyReads,0);
 for(const model of ['grok-imagine-video-1.5','grok-imagine-video-1.5-1080p']){
   const before=calls;j=reset({model,prompt:'a'.repeat(4096)});assert.equal(await prepareMediaPrompt('owner','film',j,'media-key'),undefined);assert.equal(calls,before);
   responseMode='whole';j=reset({model,prompt:'я'.repeat(4097),promptSections:undefined,compilation:{budget:{limit:60000,needsOptimization:false},compression:{shortened:false}}});
   const repaired=await prepareMediaPrompt('owner','film',j,'media-key');assert.equal(calls,before+1);assert.equal(repaired.jobs[0].status,'queued');assert(repaired.jobs[0].prompt.length<=4096);assert.equal(repaired.jobs[1].status,'done');
   await prepareMediaPrompt('owner','film',repaired.jobs[0],'media-key');assert.equal(calls,before+1,'Existing queued Grok job is optimized once despite obsolete snapshot');
 }
 calls=0;responseMode='ok';
 j=reset();const p=await prepareMediaPrompt('owner','film',j,'media-key');assert.equal(calls,1);assert.equal(p.jobs[0].status,'queued');assert(p.jobs[0].prompt.length<=2500);assert.equal(p.jobs[0].promptOptimization.state,'done');
 assert.equal(p.jobs[1].purpose,'prompt-optimization');assert.equal(p.jobs[1].actual,'12345');assert.equal(p.jobs[1].requestId,'llm-receipt');assert.equal(p.jobs[1].status,'done');assert(!p.jobs[0].requestId,'Media provider not called during optimization');
 await prepareMediaPrompt('owner','film',p.jobs[0],'media-key');assert.equal(calls,1,'A completed prompt is not optimized twice');
 j=reset();responseMode='bad';await assert.rejects(()=>prepareMediaPrompt('owner','film',j,'media-key'),/JSON/);assert.equal(globalThis.film.jobs[1].actual,'12345');assert.equal(globalThis.film.jobs[1].status,'failed');
 responseMode='network';j=reset();await assert.rejects(()=>prepareMediaPrompt('owner','film',j,'media-key'),/не запрашивалось/);assert.equal(globalThis.film.jobs[1].status,'unknown');const old=calls;await assert.rejects(()=>prepareMediaPrompt('owner','film',structuredClone(globalThis.film.jobs[0]),'media-key'),/уже выполнялась/);assert.equal(calls,old);
 responseMode='ok';j=reset();globalThis.film.limit='999999999999';const n=calls;await assert.rejects(()=>prepareMediaPrompt('owner','film',j,'media-key'),/оценки всех попыток/);assert.equal(calls,n);assert.equal(globalThis.film.jobs.length,1,'Unknown LLM cost cannot bypass hard budget');
 j=reset({model:'veo-3.1-generate-preview',prompt:'Русский промпт '.repeat(110)});const before=calls;assert.equal(await prepareMediaPrompt('owner','film',j,'google-key'),undefined);assert.equal(calls,before+1);assert.equal(globalThis.film.jobs.length,1);assert.equal(j.promptTokenCount.count,600,'Actual API count below limit skips LLM even when byte bound exceeds it');
 responseMode='counter-unsupported';j=reset({model:'veo-3.1-generate-preview'});const conservative=await prepareMediaPrompt('owner','film',j,'google-key');assert.equal(conservative.jobs[0].promptTokenCount.method,'utf8-upper-bound');assert(conservative.jobs[0].promptTokenCount.count<=1024);
 responseMode='wait';j=reset();const first=prepareMediaPrompt('owner','film',j,'media-key');while(!release)await new Promise(r=>setTimeout(r,1));const last=calls;await assert.rejects(()=>prepareMediaPrompt('owner','film',structuredClone(globalThis.film.jobs[0]),'media-key'),/уже выполнялась/);assert.equal(calls,last);globalThis.film.jobs[0].status='cancelled';release();await first;assert.equal(globalThis.film.jobs[0].status,'cancelled');assert.equal(globalThis.film.jobs[1].status,'done');
 console.log('PASS conditional LLM, durable receipts/costs, malformed/unknown responses, no duplicate dispatch, hard budget, exact token count, disclosed conservative fallback, late cancellation. No paid API calls.');
}finally{globalThis.fetch=original}
