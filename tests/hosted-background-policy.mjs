import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
await mkdir('work/tests',{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as W from './lib/background-work';export * as P from './lib/hosted-background-policy';export * as D from './lib/domain';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/hosted-background-policy.mjs',plugins:[{name:'offline-director-store',setup(b){b.onResolve({filter:/^(?:\.\/server|@\/lib\/server)$/},()=>({path:'server',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:`export const loadProject=async()=>structuredClone(globalThis.directorState);export const mutate=async(_,__,fn)=>{const p=structuredClone(globalThis.directorState);fn(p);globalThis.directorState=p;return structuredClone(p)};export const imageData=async()=>{throw Error('Unexpected image request in text-only test')};export const getKey=async()=>{throw Error('Hosted watchdog cannot read a provider key')};`}));}}]});
const {W,P,D,runDirectorStep}=await import('../work/tests/hosted-background-policy.mjs');
const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No real provider calls in policy test')};
const job=(model,kind='image',status='queued',extra={})=>({id:D.id(),itemId:D.id(),batchId:D.id(),model,kind,status,created:'2026-10-01T10:00:00Z',estimate:'1',actual:null,refs:[],...extra});
const blocked=[job('grok-imagine-image-2.0'),job('gpt-image-2.5-sunburst'),job('image-01'),job('gpt-6-astra','text'),job('grok-4.6','text'),job('MiniMax-M2.7','text'),job('eleven_v3','audio'),job('music_v1','audio','queued',{purpose:'music'}),job('fal-qwen-image-edit-2511','image','queued',{purpose:'media-review'}),job('fal-qwen-image-edit-2511','image','queued',{purpose:'voice-design',voiceWorkflow:{provider:'elevenlabs'}}),job('MiniMax-H3','video','queued',{soundInput:{layerId:'layer'}}),job('zencreator:text:grok','text','queued',{purpose:'directing'}),job('future-model')];
const allowed=[job('fal-qwen-image-edit-2511'),job('fal-minimax-h3-max','video'),job('fal-wan-2.2-a14b','video'),job('flux-2-pro'),job('MiniMax-H3','video'),job('MiniMax-Hailuo-2.3','video'),job('grok-imagine-video-1.5','video'),job('veo-3.1-generate-preview','video'),job('gemini-omni-1.1-flash','video'),job('zencreator:image:QWEN_IMAGE'),job('zencreator:video:wan@2.7','video'),job('zencreator:text:grok','text'),job('sync-3','video','queued',{lipsync:{seconds:5}})];
assert(blocked.every(j=>!P.hostedQueuedDispatchEligible(j)),'Synchronous media and all synchronous specialists stay foreground');assert(allowed.every(P.hostedQueuedDispatchEligible),'Only installed asynchronous submit protocols are allowed');
assert(!P.hostedQueuedDispatchEligible({...allowed[0],kind:'text'}));assert(!P.hostedQueuedDispatchEligible(job('sync-3','video')),'Sync requires the separate lipsync adapter input');
for(const model of ['grok-imagine-video-1.5','grok-imagine-video-1.5-1080p']){
 const legacy=job(model,'video','queued',{prompt:'я'.repeat(4097),compilation:{budget:{limit:60000,needsOptimization:false}}});
 assert(!P.hostedQueuedDispatchEligible(legacy),'Old queued oversized Grok request must optimize in foreground');
 assert(P.hostedQueuedDispatchEligible({...legacy,prompt:'a'.repeat(4096)}),'Fitting Grok requests keep async background dispatch');
}
const p=D.newProject('Hosted time window');p.queueSettings={concurrency:8,providerLimits:{xai:8,openai:8,minimax:8,fal:8,elevenlabs:8}};
const continued=[job('gpt-image-2.5-flare','image','pending',{requestId:'known-receipt'}),job('grok-imagine-image-2.0','image','saving',{output:{url:'https://mock.test/image.png'}}),job('eleven_v3','audio','saving',{purpose:'voice-design',voiceWorkflow:{provider:'elevenlabs'}}),job('eleven_v3','audio','saving',{soundInput:{layerId:'layer'}})];
p.jobs=[...blocked,...allowed,...continued];p.directing={runs:[{id:'director-run',stopped:false,tasks:[{id:'task'}]}]};
const calls=[],adapters={listProjects:async()=>[{owner:'owner',id:p.id}],loadProject:async()=>structuredClone(p),executeMediaJob:async(_,__,id,action)=>{calls.push({id,executor:'media',action});p.jobs.find(j=>j.id===id).status='done';return structuredClone(p)},executeVoiceJob:async(_,__,id)=>{calls.push({id,executor:'voice'});p.jobs.find(j=>j.id===id).status='done';return structuredClone(p)},executeSoundJob:async(_,__,id)=>{calls.push({id,executor:'sound'});p.jobs.find(j=>j.id===id).status='done';return structuredClone(p)},runDirectorStep:async()=>{calls.push({executor:'director-submit'});return structuredClone(p)},watchDirector:async()=>{calls.push({executor:'director-watch'});return structuredClone(p)}};
const hosted=W.createBackgroundWorker(adapters,{maxFlights:32,dispatchQueued:P.hostedQueuedDispatchEligible,dispatchDirectors:false});
for(let n=0;n<6;n++)await hosted.tickProject('owner',p.id);
assert(blocked.every(j=>j.status==='queued'),'Background never claims a synchronous queued attempt');assert(allowed.every(j=>j.status==='done'),'Held sync jobs do not starve later async jobs');assert(continued.every(j=>j.status==='done'),'Existing receipt/file continuation is allowed for every model');
assert(!calls.some(c=>c.executor==='director-submit'));assert(calls.some(c=>c.executor==='director-watch'));assert(calls.some(c=>c.id===continued[2].id&&c.executor==='voice'));assert(calls.some(c=>c.id===continued[3].id&&c.executor==='sound'));
// Default options preserve the persistent Node worker's synchronous support.
const node=W.createBackgroundWorker(adapters,{maxFlights:32});for(let n=0;n<5;n++)await node.tickAll();assert(blocked.filter(j=>j.purpose!=='directing').every(j=>j.status==='done'));assert(calls.some(c=>c.executor==='director-submit'));
// The actual director watchdog expires old calls but cannot send any new task.
const stale=job('gpt-6-astra','text','dispatching',{purpose:'directing',started:'2000-01-01T00:00:00Z'});globalThis.directorState=D.newProject('Director watchdog');directorState.jobs=[stale];directorState.directing={runs:[{id:'run',stopped:false,tasks:[{id:'old',jobId:stale.id},{id:'new',requires:[],role:'story'}]}]};
const watched=await runDirectorStep('owner',directorState.id,{dispatch:false});assert.equal(watched.jobs.length,1);assert.equal(watched.jobs[0].status,'unknown');assert(watched.directing.runs[0].tasks[0].error);assert.equal(watched.directing.runs[0].tasks[1].jobId,undefined);
assert.equal(network,0);globalThis.fetch=previousFetch;
// Verify the real hosted kick and private cron BOTH explicitly select policy.
for(const path of ['platform/hosted/background-kick.ts.template','platform/hosted/worker-tick-route.ts.template'])assert.match(await readFile(path,'utf8'),/projectWorkerTick(?:For)?\([^)]*'hosted'/,path+' must opt into the safe hosted dispatcher');
const projectWorker=await readFile('lib/project-worker.ts','utf8');assert.match(projectWorker,/dispatchQueued:hostedQueuedDispatchEligible,dispatchDirectors:false/);assert.match(projectWorker,/mode==='hosted'\?hostedWorker:worker/);
// Exercise the actual trusted project-worker mode, including its database row
// selector. Replacing its storage/executors does not replace dispatch policy.
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/project-worker';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/hosted-project-worker-policy.mjs',plugins:[{name:'owned-worker-storage',setup(b){
  b.onResolve({filter:/^\.\/(server|media-job-runner|voice-design-runner|soundscape-runner|director-runner)$/},a=>({path:a.path,namespace:'wired'}));
  b.onLoad({filter:/.*/,namespace:'wired'},a=>({contents:a.path==='./server'?`export const runtime={DB:{prepare(){return {async all(){return {results:[{id:globalThis.wiredState.id,owner:'owner',revision:globalThis.wiredState.revision}]}}}}}};export const loadProject=async(owner,id)=>{if(owner!=='owner'||id!==globalThis.wiredState.id)throw Error('Foreign project');return structuredClone(globalThis.wiredState)};`:
    a.path==='./media-job-runner'?`export const executeMediaJob=async(owner,id,jobId)=>{if(owner!=='owner'||id!==globalThis.wiredState.id)throw Error('Foreign dispatch');globalThis.wiredCalls.push(jobId);const j=globalThis.wiredState.jobs.find(j=>j.id===jobId);j.status='done';globalThis.wiredState.revision++;return structuredClone(globalThis.wiredState)};`:
    a.path==='./voice-design-runner'?`export const runVoiceWorkflowStep=async()=>{throw Error('Unexpected voice')};`:
    a.path==='./soundscape-runner'?`export const runSoundscapeStep=async()=>{throw Error('Unexpected sound')};`:
    `export const runDirectorStep=async(_,__,options)=>{if(options?.dispatch!==false)throw Error('No hosted director submission');return structuredClone(globalThis.wiredState)};`}));
}}]});
const wired=await import('../work/tests/hosted-project-worker-policy.mjs');globalThis.wiredState=D.newProject('Actual hosted selector');globalThis.wiredCalls=[];
const syncJob=job('grok-imagine-image-2.0'),asyncJob=job('flux-2-pro');wiredState.jobs=[syncJob,asyncJob];
await wired.projectWorkerTickFor('owner',wiredState.id,'hosted');assert.deepEqual(wiredCalls,[asyncJob.id]);assert.equal(wiredState.jobs[0].status,'queued');
await wired.projectWorkerTick('hosted');assert.deepEqual(wiredCalls,[asyncJob.id],'Private hosted cron cannot claim the held synchronous job either');
await wired.projectWorkerTickFor('owner',wiredState.id);assert.deepEqual(wiredCalls,[asyncJob.id,syncJob.id],'The same project-worker defaults retain Node foreground/background behavior');
console.log('PASS hosted dispatch allowlist: sync queued foreground, installed async queued background, all receipt/saving continuation, director watchdog without submit, default Node unrestricted and both kick/cron wired. No paid calls.');
