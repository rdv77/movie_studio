import {build} from 'esbuild';import {strict as A} from 'node:assert';
const server=`export const runtime={DB:{prepare:()=>({all:async()=>({results:globalThis.rows})})}};export async function loadProject(u,id){globalThis.loads++;return structuredClone(globalThis.states[id]);}`;
const runner=`export async function runDirectorStep(u,id){globalThis.calls.push(id);await new Promise(r=>globalThis.releases.push(r));}`;
await build({entryPoints:['lib/director-worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/director-worker.mjs',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^\.\/(server|director-runner)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='./server'?server:runner}));}}]});
const {directorWorkerTick}=await import('../work/tests/director-worker.mjs');
globalThis.rows=[1,2,3,4].map(n=>({id:String(n),owner:'test',revision:1}));globalThis.states=Object.fromEntries(rows.map(r=>[r.id,{revision:1,directing:{runs:[{tasks:[{}]}]}}]));globalThis.loads=0;globalThis.calls=[];globalThis.releases=[];
await directorWorkerTick();A.equal(calls.length,3);A.equal(loads,4);await directorWorkerTick();A.equal(calls.length,3,'Inflight projects are not dispatched twice');A.equal(loads,4,'Idle revisions do not read full snapshots');
releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));for(const row of rows.slice(0,3)){row.revision=2;states[row.id]={revision:2,directing:{runs:[]}};}
await directorWorkerTick();A.deepEqual(calls,['1','2','3','4']);releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));
console.log('PASS standalone director worker: saved work resumes without a tab, bounded projects, no duplicate flights, revision cache.');
