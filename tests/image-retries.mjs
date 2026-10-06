import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {resolve} from 'node:path';
const errorPath=JSON.stringify(resolve('lib/provider-http.ts').replaceAll('\\','/'));
const server=`export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}};export const api=f=>f;export const owner=async()=> 'owner';
export const loadProject=async()=>structuredClone(state);export const saveProject=async(_,p,rev)=>{await Promise.resolve();if(rev!==state.revision)throw Object.assign(Error('conflict'),{status:409});p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(u,id,fn)=>{for(let n=0;n<5;n++){const p=await loadProject(),rev=p.revision;fn(p);try{return await saveProject(u,p,rev)}catch(e){if(e.status!==409||n===4)throw e}}};
export const getKey=async()=> 'mock';export const asset=async()=>({mime:'image/png',size:100});export const imageData=async()=> 'data:image/png;base64,AA==';export const storeAsset=async(_,id)=>id;export const runtime={FILES:{}};`;
const provider=`import {ProviderError} from ${errorPath};export {ProviderError};
export const generate=async j=>{calls.push({id:j.id,model:j.model,prompt:j.prompt,refs:j.refs});const value=outcomes.shift();if(value==='unknown')throw new ProviderError('Network unknown');if(value==='401')throw new ProviderError('HTTP401',true,false,false,401);if(value==='429')throw new ProviderError('HTTP429',true,false,true,429);if(value==='pending')return {pending:true,requestId:'receipt'};if(value==='failed')return {error:'generation failed',requestId:'failed-receipt',actual:'5'};return {bytes:new Uint8Array([1]),mime:'image/png',actual:'7'};};
export const poll=async()=>{polls++;if(pollOutcome==='429')throw new ProviderError('HTTP429',true,false,true,429);return {error:'generation failed',actual:'5'};};export const retrieve=async()=>{throw Error('Unexpected retrieval')};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/image-retries';export * as Q from './lib/queue-policy';export {POST as create} from './app/api/projects/[id]/generate/route';export {executeMediaJob as tick} from './lib/media-job-runner';export * as H from './lib/provider-http';export * as K from './lib/keyframes';export {ensureDirecting} from './lib/directing';export {stampGenerationVersions as stamp} from './lib/creative-versions';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/image-retries.mjs',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/providers$/},a=>a.importer.endsWith('media-job-runner.ts')?{path:'providers',namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server'?server:provider,resolveDir:process.cwd()}));}}]});
const {D,R,Q,create,tick,H,K,ensureDirecting,stamp}=await import('../work/tests/image-retries.mjs');
function fixture(){const p=D.newProject('Retry');for(const i of p.items.filter(i=>D.precedesStage(i.stage,1)).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:'Basis'});D.approve(p,i.id);}return p;}
async function start(policy={maxAttempts:3,fallbackModel:'gpt-image-2.5-sunburst'}){globalThis.state=fixture();globalThis.calls=[];globalThis.polls=0;const item=state.items.find(i=>i.stage===1);const body={revision:state.revision,batchId:D.id(),itemId:item.id,models:['gpt-image-2.5-flare'],count:1,prompt:'Animated portrait, blue coat and curly hair.',refs:[],referenceMode:'selected',dialogue:'',voiceId:'',estimates:{'gpt-image-2.5-flare':'10'},...(policy?{imageRetry:policy}:{})};await create(new Request('http://test',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:state.id})});return state.jobs[0];}
async function runLatest(){const j=state.jobs.at(-1);if(j.imageRetry)j.imageRetry.notBefore=undefined;await tick('owner',state.id,j.id);}
globalThis.outcomes=['failed','failed','success'];await start();await runLatest();assert.equal(state.jobs.length,2);assert.equal(Q.queueRunnableJobs(state,new Set(),new Map()).length,0,'15 second backoff');await runLatest();await runLatest();assert.equal(state.jobs.length,3);assert.equal(state.jobs.at(-1).status,'done');assert.equal(calls.length,3);assert(calls.every(c=>c.model==='gpt-image-2.5-flare'));assert.equal(D.totals(state).actual,'17');assert(state.jobs.slice(0,2).every(j=>j.status==='failed'&&j.requestId==='failed-receipt'));assert.equal(state.items.find(i=>i.stage===1).variants.filter(v=>v.kind==='image').length,1);
globalThis.outcomes=['failed','failed','failed','success'];await start();for(let n=0;n<4;n++)await runLatest();assert.equal(state.jobs.length,4);assert.equal(calls.at(-1).model,'gpt-image-2.5-sunburst');assert(state.jobs.at(-1).imageRetry.fallbackAttempt);assert.equal(new Set(state.jobs.map(j=>j.id)).size,4);assert.equal(new Set(state.jobs.map(j=>j.imageRetry.rootId)).size,1);assert.equal(state.jobs.at(-1).compilation.modelId,'gpt-image-2.5-sunburst');assert(state.jobs.at(-1).prompt.includes('blue coat'));
globalThis.outcomes=['failed','failed','failed','failed'];await start();for(let n=0;n<4;n++)await runLatest();assert.equal(state.jobs.length,4);assert.match(state.jobs.at(-1).imageRetry.haltReason,/Резервная/);
for(const failure of ['unknown','401']){globalThis.outcomes=[failure];await start();await runLatest();assert.equal(state.jobs.length,1);assert.equal(calls.length,1);assert.equal(state.jobs[0].status,failure==='unknown'?'unknown':'failed');}
globalThis.outcomes=['failed'];await start(null);await runLatest();assert.equal(state.jobs.length,1,'Legacy jobs never repeat');
globalThis.outcomes=['failed'];await start();state.limit='5';await runLatest();assert.equal(state.jobs.length,1);assert.match(state.jobs[0].imageRetry.haltReason,/лимит/);
globalThis.outcomes=['429'];await start();state.limit='100';await runLatest();assert.equal(state.jobs.length,1);assert.match(state.jobs[0].imageRetry.haltReason,/сверка/);
globalThis.outcomes=['failed'];await start();D.addVariant(state,state.items.find(i=>i.stage===0).id,{text:'Changed basis'});D.approve(state,state.items.find(i=>i.stage===0).id);await runLatest();assert.equal(calls.length,0);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].status,'cancelled');
await start();const j=state.jobs[0];j.status='failed';R.enqueueImageRetry(state,j,true);const length=state.jobs.length;R.enqueueImageRetry(state,j,true);assert.equal(state.jobs.length,length,'CAS-safe next pointer');
await start();state.jobs[0].status='failed';state.jobs[0].status='cancelled';R.enqueueImageRetry(state,state.jobs[0],true);assert.equal(state.jobs.length,1,'Cancelled chain not restarted');
globalThis.outcomes=['pending'];await start();await runLatest();globalThis.pollOutcome='429';await runLatest();assert.equal(state.jobs[0].status,'pending');assert.equal(state.jobs.length,1);assert.equal(calls.length,1,'Polling 429 must not resend accepted generation');
const pollsBeforeRetry=polls,nextPollAt=Date.parse(state.jobs[0].pollRetry.nextPollAt);
assert(nextPollAt>Date.now());globalThis.pollOutcome='failed';await runLatest();
assert.equal(polls,pollsBeforeRetry,'A durable read pause must not poll the provider early');
assert.equal(state.jobs.length,1);
const realNow=Date.now;Date.now=()=>nextPollAt;
try{await runLatest();}finally{Date.now=realNow;}
assert.equal(state.jobs.length,2,'Confirmed terminal provider failure may create the next permitted image attempt');
assert.equal(calls.length,1,'Polling the existing task must not resend its paid POST');
assert.equal(state.jobs[1].pollRetry,undefined,'A new attempt must not inherit the old polling pause');
assert.deepEqual(state.jobs[1].timings,{queuedAt:state.jobs[1].created},'Each paid attempt owns its own timing history');
// Validate error classification at the real HTTP boundary without contacting any service.
globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(()=>H.call('https://test.invalid',{},{}),e=>e.retryable&&e.httpStatus===429&&e.definite);
for(const status of [400,401,402,403,422,500]){fetch=async()=>new Response('{}',{status});await assert.rejects(()=>H.call('https://test.invalid',{},{}),e=>!e.retryable&&e.definite===(status<500));}
await assert.rejects(()=>start({maxAttempts:4}));await assert.rejects(()=>start({maxAttempts:3,fallbackModel:'grok-4.6'}));
{
 const p=D.newProject('Fallback final frame');ensureDirecting(p);
 const shot={id:'shot-1',title:'Close-up',description:'Boy at water',duration:5,camera:'Close-up',continuity:'Still at shore',speechType:'none',speaker:'',dialogue:'',stateIn:'Standing',stateOut:'Holding frog',continuityChanges:'Frog in hands',direction:{startFrame:'Standing',endFrame:'Holding frog'}};
 for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{kind:'text',text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Basis'});D.approve(p,item.id);}
 const item=p.items.find(i=>i.stage===5);item.title=shot.title;item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:shot.title,shotId:shot.id};
 const v=D.makeVariant(p,item,{kind:'image',assetId:D.id(),model:'grok-imagine-image-2.0',jobId:D.id(),imageSettings:{quality:'medium',resolution:'2k'}});item.variants.push(v);item.selectedId=v.id;
 const prep=K.prepareKeyframeGeneration(p,item.id,'end',{model:v.model,refs:[v.assetId],imageSettings:v.imageSettings});
 const job=R.prepareImageRetries(p,{...prep,id:D.id(),batchId:D.id(),itemId:item.id,kind:'image',model:v.model,refs:prep.refs,brief:'Boy gently holding frog',prompt:'Original prompt',deps:D.dependencies(p,5),created:D.now(),actual:'5',estimate:'10',status:'queued'}, {maxAttempts:1,fallbackModel:'gpt-image-2.5-sunburst'}, {keyframe:'end',keyframeInstruction:prep.roleInstruction});
 stamp(p,[job]);p.jobs.push(job);job.status='failed';R.enqueueImageRetry(p,job,true);assert.equal(p.jobs.length,2,job.imageRetry.haltReason);assert.equal(K.keyframeQueueIssue(p,p.jobs[1]),'');assert(p.jobs[1].refs.includes(v.assetId));assert.equal(p.jobs[1].sourceFrameVariantId,v.id);
 // A changed source must still stop a fallback; the model switch isn't permission to rebase.
 item.selectedId=undefined;item.keyframeSelection={startId:'missing'};assert(K.keyframeQueueIssue(p,p.jobs[1]));
}
console.log('PASS: third-attempt success, exactly one fallback, immutable compiled prompts, costs/history, 15s backoff, budget/unknown-cost stops, ambiguous/permanent errors, accepted-task polling, stale basis, idempotence, cancellation, legacy isolation, API schema and HTTP classification.');

