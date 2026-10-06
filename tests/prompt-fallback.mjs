import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/prompt-optimization-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-fallback.mjs',plugins:[{name:'store',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function loadProject(){return structuredClone(globalThis.film)};export async function getKey(_,p){return p+'-test-key'}; export async function mutate(_,__,fn){const p=structuredClone(globalThis.film);fn(p);globalThis.film=p;return structuredClone(p);}`}));
}}]});
const {prepareMediaPrompt,recoverPromptPreparation}=await import('../work/tests/prompt-fallback.mjs');
const reset=()=>globalThis.film={id:'film',limit:null,jobs:[{id:'video',itemId:'item',batchId:'batch',status:'dispatching',kind:'video',model:'grok-imagine-video-1.5',deps:'d',prompt:'я'.repeat(2500),refs:[],duration:5,estimate:null,actual:null,created:new Date().toISOString(),zenCreditsEstimate:29,promptSections:[{key:'identity',required:true,text:'Keep face, red coat, closed mouth.',label:'Identity'},{key:'motion',required:true,text:'Raise arrow.',label:'Motion'}]}]};
const compact=JSON.stringify({sections:[{key:'identity',text:'Keep face, red coat, closed mouth.'},{key:'motion',text:'Raise arrow.'}]});
let mode='fallback',calls=[],release;
const original=fetch;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);calls.push({url,body});
 if(mode==='late')await new Promise(r=>release=r);
 if(mode==='fail'||mode==='fallback'&&url.includes('api.openai.com'))throw new DOMException('Timeout','TimeoutError');
 if(mode==='malformed')return url.includes('api.openai.com')?Response.json({id:'paid-bad',status:'completed',output:[{role:'assistant',type:'message',content:[{type:'output_text',text:'invalid JSON'}]}]}):Response.json({id:'paid-bad',usage:{cost_in_usd_ticks:'42'},choices:[{message:{content:'invalid JSON'}}]});
 return url.includes('api.openai.com')?Response.json({id:'openai-paid',status:'completed',output:[{role:'assistant',type:'message',content:[{type:'output_text',text:compact}]}]}):Response.json({id:'paid-good',choices:[{message:{content:compact}}],usage:{cost_in_usd_ticks:'123'}});
};
const advance=()=>{globalThis.film.jobs[0].status='dispatching';return prepareMediaPrompt('owner','film',structuredClone(globalThis.film.jobs[0]),'video-key')};
try{
 reset();let p=await advance();assert.equal(p.jobs[0].status,'queued');assert.equal(p.jobs[0].promptOptimization.state,'retrying');assert.equal(p.jobs[1].status,'unknown');assert(!p.jobs[1].zenCreditsEstimate);assert(!p.jobs[0].error);
 p=await advance();assert.equal(p.jobs[0].promptOptimization.state,'done');assert.equal(p.jobs[0].status,'queued');assert.match(p.jobs[0].warning,/Grok/);assert.equal(p.jobs[1].optimizationRecovered,true);assert(p.jobs[1].newSeriesAllowedAt);assert.equal(p.jobs[1].actual,null);assert.equal(p.jobs[2].requestId,'paid-good');assert.deepEqual(p.jobs[0].promptOptimization.triedModels,['gpt-6-astra','grok-4.6']);assert(calls.every(r=>!r.url.includes('/videos/')));
 const n=calls.length;await prepareMediaPrompt('owner','film',p.jobs[0],'video-key');assert.equal(calls.length,n);
 reset();mode='fail';await advance();await advance();await assert.rejects(advance,/не запрашивалось/);assert.equal(globalThis.film.jobs.length,4);assert.equal(globalThis.film.jobs[0].promptOptimization.state,'failed');assert.equal(new Set(calls.slice(-3).map(x=>x.body.model)).size,3);
 reset();mode='malformed';p=await advance();assert.equal(p.jobs[1].actual,null);assert.equal(p.jobs[1].requestId,'paid-bad');assert.equal(p.jobs[0].status,'queued');
 reset();globalThis.film.limit='999999999999';const old=calls.length;await assert.rejects(advance,/оценки/);assert.equal(calls.length,old);
 reset();mode='late';const first=advance();while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(advance,/уже выполнялась/);assert(recoverPromptPreparation(globalThis.film,globalThis.film.jobs[0]));const previousAudit=globalThis.film.jobs[0].promptOptimization.auditId;
 // A late first answer retains its receipt but cannot replace the next attempt.
 globalThis.film.jobs[0].promptOptimization.auditId='next-audit';release();await first;assert.equal(globalThis.film.jobs[0].promptOptimization.auditId,'next-audit');assert.equal(globalThis.film.jobs[0].prompt.length,2500);assert.equal(globalThis.film.jobs.find(j=>j.id===previousAudit).requestId,'openai-paid');
 reset();globalThis.film.jobs[0].waitStoppedAt='manual';assert.equal(recoverPromptPreparation(globalThis.film,globalThis.film.jobs[0]),false);
 console.log('PASS 3-model bounded fallback, unknown costs, recovered warnings, UTF-8 optimization, CAS duplicates, budget, malformed receipt, orphan recovery and late result guard; no paid API calls.');
}finally{globalThis.fetch=original}
