import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`export const loadProject=async()=>structuredClone(globalThis.state);export const imageData=async()=>{throw Error('No media expected')};export const getKey=async()=>'fake';export async function mutate(u,id,fn){if(globalThis.beforeMutation){const hook=globalThis.beforeMutation;globalThis.beforeMutation=undefined;hook();}const p=structuredClone(globalThis.state);fn(p);p.revision++;globalThis.writes++;globalThis.state=p;return structuredClone(p);}`;
const provider=`export async function generate(){globalThis.calls++;if(globalThis.fail)throw Error('transport');return {text:JSON.stringify({review:'Проверено',alternatives:[]}),requestId:'receipt'};}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as J from './lib/job-wait';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/director-blocked-noop.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'mock',setup(b){b.onResolve({filter:/^\.\/(server|providers)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='./server'?server:provider}));}}]});
const {D,R,J,runDirectorStep}=await import('../work/tests/director-blocked-noop.mjs');
const p=D.newProject('Очередь без перезаписи'),item=p.items.find(i=>i.stage===0);
D.addVariant(p,item.id,{text:'История'});R.ensureDirecting(p);R.newDirectorRun(p,'grok-4.6','critic');
globalThis.state=p;globalThis.calls=0;globalThis.writes=0;globalThis.fail=true;
await runDirectorStep('owner',p.id);assert.equal(state.jobs[0].status,'unknown');assert.equal(calls,1);
R.newDirectorRun(state,'MiniMax-M2.7','critic');
await runDirectorStep('owner',p.id);
const issue=state.directing.runs.at(-1).queueIssue;
assert.match(issue,/неизвестным исходом/);
const before=structuredClone(state),count=writes;
await Promise.all(Array.from({length:6},()=>runDirectorStep('owner',p.id)));
assert.deepEqual(state,before,'Repeated blocked ticks preserve revision and saved state');
assert.equal(writes,count);assert.equal(calls,1,'Unknown outcomes never automatically repeat');

// A concurrent consumer may record the same warning after our initial read.
delete state.directing.runs.at(-1).queueIssue;
globalThis.beforeMutation=()=>{state.directing.runs.at(-1).queueIssue=issue;state.revision++;};
const raceRevision=state.revision;
await runDirectorStep('owner',p.id);
assert.equal(state.revision,raceRevision+1,'CAS recheck does not add a duplicate no-op write');
assert.equal(writes,count);assert.equal(calls,1);

J.allowNewSeries(state.jobs[0]);globalThis.fail=false;
await runDirectorStep('owner',p.id);
assert.equal(calls,2,'Explicit cost acknowledgement releases the already requested new series');
assert.equal(state.jobs.at(-1).status,'done');
assert.equal(state.directing.runs.at(-1).queueIssue,undefined);
assert.equal(state.jobs[0].status,'unknown','The unresolved receipt remains for cost reconciliation');

R.newDirectorRun(state,'MiniMax-M2.7','critic');state.queueSettings={concurrency:1,providerLimits:{}};
const occupied={...state.jobs.at(-1),id:D.id(),purpose:undefined,itemId:D.id(),batchId:D.id(),status:'pending'};state.jobs.push(occupied);
const capacityRevision=state.revision,capacityWrites=writes;
await runDirectorStep('owner',p.id);await runDirectorStep('owner',p.id);
assert.equal(state.revision,capacityRevision);assert.equal(writes,capacityWrites);assert.equal(calls,2);
state.jobs.find(j=>j.id===occupied.id).status='done';
await runDirectorStep('owner',p.id);assert.equal(calls,3,'Capacity becoming free is detected on the next tick');
console.log('PASS unchanged unknown/capacity refusals do not rewrite revision, concurrent warning CAS is a no-op, explicit release resumes once without hiding uncertain receipt. No paid calls.');
