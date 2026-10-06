import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/prompt-optimization-runner';export * from './lib/prompt-optimization';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-optimization-reuse.mjs',plugins:[{name:'mock-io',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'store',namespace:'test'}));
 b.onResolve({filter:/^\.\/providers$/},()=>({path:'provider',namespace:'test'}));
 b.onLoad({filter:/store/,namespace:'test'},()=>({contents:`export async function loadProject(){if(globalThis.scoped)globalThis.assertState();return structuredClone(globalThis.film)};export async function getKey(){return 'test'};export async function mutate(_,__,fn){if(globalThis.scoped)globalThis.assertState();const p=structuredClone(globalThis.film);fn(p);if(globalThis.failWrite&&p.jobs.some(j=>j.purpose==='prompt-optimization'&&j.output)){globalThis.failWrite=false;throw Error('temporary snapshot write failure')}globalThis.film=p;return structuredClone(p)}`}));
 b.onLoad({filter:/provider/,namespace:'test'},()=>({contents:`export class ProviderError extends Error{constructor(m,definite,notSent){super(m);this.definite=definite;this.notSent=notSent}};export async function generate(job){return globalThis.generateMock(job)}`}));
}}]});
const R=await import('../work/tests/prompt-optimization-reuse.mjs');
const sections=[{key:'identity',label:'Identity',text:'Green eyes, red cloak.',required:true,priority:100},{key:'action',label:'Action',text:'Keep camera still. Raise arrow. Mouth closed.',required:true,priority:100}];
const compact=JSON.stringify({sections:sections.map(({key,text})=>({key,text}))});
const fresh=(id='media')=>({id,itemId:'shot',batchId:'batch',model:'fal-kling-3.0-pro',kind:'video',prompt:'Long shot-only prompt. '.repeat(220),promptSections:structuredClone(sections),refs:['first'],endFrameAssetId:'last',characterRefs:[],duration:6,providerDuration:6,status:'dispatching',created:new Date().toISOString(),actual:null,estimate:null});
const reset=()=>{globalThis.film={id:'project',jobs:[fresh()],limit:null};return structuredClone(globalThis.film.jobs[0])};
let calls=0,depth=0,models=[];
globalThis.assertState=()=>assert(depth>0,'Snapshot IO needs the scoped gate');
globalThis.generateMock=async j=>{assert.equal(depth,0,'No state gate is held during a paid request');calls++;models.push(j.model);return {text:compact,requestId:'paid-'+calls,actual:'123'}};
const scope=async work=>{depth++;try{return await work()}finally{depth--}};
try{
 globalThis.scoped=true;let j=reset(),p=await R.prepareMediaPrompt('u','project',j,'key',scope);
 assert.equal(models[0],'gpt-6-astra');assert(p.jobs[0].timings.preparationStartedAt&&p.jobs[0].timings.preparationFinishedAt);
 const paid=p.jobs[1],before=calls;globalThis.film.jobs.push(fresh('second'));globalThis.film.revision=987;
 p=await R.prepareMediaPrompt('u','project',fresh('second'),'key',scope);
 assert.equal(calls,before,'A queue revision does not invalidate actual creative inputs');assert.equal(p.jobs.length,3);assert.equal(p.jobs[2].promptOptimization.auditId,paid.id);assert.match(p.jobs[2].warning,/Нового списания/);
 for(const change of [{refs:['different']},{endFrameAssetId:'other-end'},{duration:7},{providerDuration:10},{model:'grok-imagine-video-1.5'},{promptSections:sections.map(s=>({...s,text:s.text+' Protect new mark.'}))}]){
   const job={...fresh('changed-'+calls),...change};globalThis.film.jobs.push(job);const count=calls;await R.prepareMediaPrompt('u','project',structuredClone(job),'key',scope);assert.equal(calls,count+1,JSON.stringify(change));
 }
 // A paid valid answer survives failure while storing its receipt.
 j=reset();globalThis.failWrite=true;p=await R.prepareMediaPrompt('u','project',j,'key',scope);
 assert.equal(p.jobs[0].promptOptimization.state,'retrying');assert.equal(p.jobs[1].actual,'123');assert.equal(p.jobs[1].output.text,compact);
 globalThis.film.jobs[0].status='dispatching';const recoveryCalls=calls;p=await R.prepareMediaPrompt('u','project',structuredClone(globalThis.film.jobs[0]),'key',scope);
 assert.equal(calls,recoveryCalls);assert.equal(p.jobs[0].promptOptimization.state,'done');assert.equal(p.jobs[1].status,'done');assert.match(p.jobs[0].warning,/восстановлен/);
 // Orphan recovery uses saved JSON before scheduling any fallback.
 j=reset();globalThis.film.jobs[0].promptOptimization={state:'running',auditId:'saved',original:j.prompt,limit:2500,unit:'characters'};
 globalThis.film.jobs.push({...fresh('saved'),model:'gpt-6-astra',kind:'text',purpose:'prompt-optimization',optimizationParentId:j.id,status:'dispatching',output:{text:compact},actual:'321'});
 assert(R.recoverPromptPreparation(globalThis.film,globalThis.film.jobs[0]));assert.equal(globalThis.film.jobs[0].status,'queued');assert.equal(globalThis.film.jobs[1].status,'done');assert.equal(globalThis.film.jobs[1].actual,'321');
 j=reset();const failures=[0,1].map(n=>({...fresh('failed-'+n),model:'gpt-6-astra',kind:'text',purpose:'prompt-optimization',status:n?'unknown':'failed',created:new Date(Date.now()-n*1000).toISOString()}));globalThis.film.jobs.push(...failures);
 const previous=calls;p=await R.prepareMediaPrompt('u','project',j,'key',scope);assert.equal(calls,previous+1);assert.equal(models.at(-1),'grok-4.6');assert.match(p.jobs[0].warning,/временно пропущены/);
 assert.deepEqual(R.coolingOptimizers(failures,Date.now()+R.OPTIMIZER_COOLDOWN_MS+1000),[]);
 assert.deepEqual(R.coolingOptimizers([...failures,{...failures[0],id:'success',status:'done',created:new Date(Date.now()+1000).toISOString()}]),[]);
 assert.equal(depth,0);
 console.log('PASS GPT-first, exact-input persisted cache, reference/timing/model/context invalidation, scoped snapshot IO, paid-output recovery, bounded failure cooldown. No API calls.');
}finally{delete globalThis.scoped;delete globalThis.failWrite}
