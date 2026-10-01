import {build} from 'esbuild';
import A from 'node:assert/strict';
const server=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const loadProject=async()=>structuredClone(globalThis.state);
export async function saveProject(_,p,rev){await Promise.resolve();if(state.revision!==rev)throw new HttpError('CAS',409);p.revision=rev+1;globalThis.state=structuredClone(p);return p;}
export async function mutate(u,id,fn){for(let n=0;n<10;n++){const p=await loadProject(),rev=p.revision;fn(p);try{return await saveProject(u,p,rev);}catch(e){if(e.status!==409||n===9)throw e;}}}
export const getKey=async()=> 'mock-key';export const storeAsset=async(_,id)=>id;
export const runtime={FILES:{put:async(_,bytes)=>{globalThis.savedBytes=bytes;},get:async()=>({arrayBuffer:async()=>new Uint8Array([1,2]).buffer})}};
`;
const provider=`export async function generate(j){directorCalls.push(j.id);await new Promise(resolve=>directorRelease=resolve);return {text:JSON.stringify({review:'Готово',alternatives:[]}),requestId:'critic-receipt',actual:'100'};}`;
const voiceProvider=`export class VoiceWorkflowResponseError extends Error{};export const safeVoiceError=e=>e.message;
export async function callVoiceWorkflow(j){voiceCalls.push(j.id);await new Promise(resolve=>voiceRelease=resolve);return {requestId:'voice-receipt',actual:'200',previews:[{generatedVoiceId:'generated',mime:'audio/mpeg',bytes:new Uint8Array([1,2])}]};}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as Q from './lib/queue-policy';export * as V from './lib/voice-design';export {runVoiceWorkflowStep} from './lib/voice-design-runner';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/specialist-queue-slots.mjs',plugins:[{name:'mock',setup(b){
 b.onResolve({filter:/^(?:@\/lib|\.)\/(server|providers|voice-design-provider)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('/server')?server:a.path.endsWith('/providers')?provider:voiceProvider}));
}}]});
const {D,R,Q,V,runDirectorStep,runVoiceWorkflowStep}=await import('../work/tests/specialist-queue-slots.mjs');
globalThis.directorCalls=[];globalThis.voiceCalls=[];globalThis.directorRelease=null;globalThis.voiceRelease=null;
function fixture(){const p=D.newProject('Общие слоты агентов');D.addVariant(p,p.items.find(i=>i.stage===0).id,{text:'Царевич замечает золотую корону.'});R.ensureDirecting(p);R.newDirectorRun(p,'grok-4.6','critic');V.queueVoiceDesign(p,D.id(),{provider:'minimax',name:'Рассказчик',description:'Тёплый сказочный мужской голос',previewText:'Я увидел золотую корону.'});Q.saveQueueSettings(p,{concurrency:1});return p;}
globalThis.state=fixture();const vId=state.jobs[0].id,busy={...structuredClone(state.jobs[0]),id:D.id(),itemId:D.id(),batchId:D.id(),model:'fal-qwen-image-edit-2511',purpose:undefined,voiceWorkflow:undefined,status:'pending',requestId:'already-paid'};state.jobs.push(busy);
await Promise.all([runDirectorStep('owner',state.id),runVoiceWorkflowStep('owner',state.id,vId)]);A.equal(directorCalls.length,0);A.equal(voiceCalls.length,0);A.equal(state.jobs.find(j=>j.id===vId).status,'queued');A.equal(state.jobs.length,2,'No agent reserve or send while shared slot is occupied');
state.jobs.find(j=>j.id===busy.id).status='done';const director=runDirectorStep('owner',state.id),voice=runVoiceWorkflowStep('owner',state.id,vId);
for(let n=0;n<100&&directorCalls.length+voiceCalls.length<1;n++)await new Promise(r=>setImmediate(r));A.equal(directorCalls.length+voiceCalls.length,1,'Concurrent specialist CAS claims reserve one shared slot');
const voiceWon=voiceCalls.length===1;if(voiceWon)voiceRelease();else directorRelease();await Promise.all([director,voice]);
const other=voiceWon?runDirectorStep('owner',state.id):runVoiceWorkflowStep('owner',state.id,vId);
for(let n=0;n<100&&directorCalls.length+voiceCalls.length<2;n++)await new Promise(r=>setImmediate(r));A.equal(directorCalls.length+voiceCalls.length,2,'The other kind continues after release');
if(voiceWon)directorRelease();else voiceRelease();await other;A.equal(state.jobs.find(j=>j.id===vId).status,'done');A.equal(state.jobs.find(j=>j.id===vId).requestId,'voice-receipt');
// Provider caps apply to synthetic voice-design models and ordinary media together.
state=fixture();Q.saveQueueSettings(state,{concurrency:8,providerLimits:{minimax:1,xai:1}});state.jobs.push({...busy,id:D.id(),model:'image-01',status:'pending'});await runVoiceWorkflowStep('owner',state.id,state.jobs[0].id);A.equal(voiceCalls.length,1);
state.jobs.push({...busy,id:D.id(),model:'grok-imagine-image-2.0',status:'pending'});await runDirectorStep('owner',state.id);A.equal(directorCalls.length,1);
// Unknown specialist output blocks only the same role for that scene/shot.
const p=D.newProject('Независимые роли'),base={...busy,id:D.id(),itemId:p.items.find(i=>i.stage===4).id,batchId:'old-run',purpose:'directing',model:'grok-4.6',status:'unknown'},candidate={...base,id:D.id(),batchId:'new-run',status:'queued'};
p.jobs=[base];p.directing={brief:R.DEFAULT_BRIEF,scenes:[],issues:[],patches:[],runs:[{id:'old-run',tasks:[{id:'old-task',jobId:base.id,role:'camera',sceneId:'scene-a',shotId:'shot-a',requires:[]}]},{id:'new-run',tasks:[]}]};
A.match(Q.queueSlotIssue(p,candidate,new Set(),{role:'camera',sceneId:'scene-a',shotId:'shot-a'}),/неизвестным исходом/);
A.equal(Q.queueSlotIssue(p,candidate,new Set(),{role:'art',sceneId:'scene-a',shotId:'shot-a'}),'');A.equal(Q.queueSlotIssue(p,candidate,new Set(),{role:'camera',sceneId:'scene-b',shotId:'shot-b'}),'');
base.newSeriesAllowedAt=D.now();A.equal(Q.queueSlotIssue(p,candidate,new Set(),{role:'camera',sceneId:'scene-a',shotId:'shot-a'}),'');A.equal(base.status,'unknown','Explicit new-series permission does not resend or zero a previous attempt');
console.log('PASS actual director/voice CAS executors: one shared slot under concurrent claims, cross-kind provider caps, synthetic provider identity, scoped specialist unknown guards and explicit new-series permission. No paid calls.');
