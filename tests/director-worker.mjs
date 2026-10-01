import {build} from 'esbuild';import {strict as A} from 'node:assert';
await build({entryPoints:['lib/director-worker.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/director-worker.mjs',plugins:[{name:'mock',setup(b){b.onResolve({filter:/^\.\/project-worker$/},()=>({path:'worker',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const projectWorkerTick=()=>{globalThis.ticks++;return new Promise(r=>globalThis.releases.push(r));};`}));}}]});
const {startProjectWorker,startDirectorWorker,directorWorkerTick}=await import('../work/tests/director-worker.mjs');
globalThis.ticks=0;globalThis.releases=[];const scheduled=[],original=globalThis.setTimeout;
try{
 globalThis.setTimeout=(fn,ms)=>{const handle={fn,ms,unref(){handle.detached=true;}};scheduled.push(handle);return handle;};
 delete globalThis.__kadrProjectWorker;startProjectWorker();startDirectorWorker();A.equal(scheduled.length,1,'Startup alias does not create a second worker');A.equal(scheduled[0].ms,1000);A(scheduled[0].detached);
 scheduled[0].fn();A.equal(ticks,1);A.equal(scheduled[1].ms,5000);A(scheduled[1].detached);scheduled[1].fn();A.equal(ticks,2,'A slow provider does not prevent the next protected tick');
 const manual=directorWorkerTick();A.equal(ticks,3);for(const release of releases)release();await manual;
}finally{globalThis.setTimeout=original;delete globalThis.__kadrProjectWorker;}
console.log('PASS Node startup: one persistent timer, compatible old startup name, detached intervals and overlapping protected ticks while a provider is slow. Ownership/CAS/restart checked by media-queue-worker.');
