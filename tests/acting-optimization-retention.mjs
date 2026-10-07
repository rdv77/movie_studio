import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/prompt-optimization-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/acting-optimization-retention.mjs',plugins:[{name:'mock-io',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'store',namespace:'test'}));
 b.onResolve({filter:/^\.\/providers$/},()=>({path:'provider',namespace:'test'}));
 b.onLoad({filter:/store/,namespace:'test'},()=>({contents:`export async function loadProject(){return structuredClone(globalThis.film)};export async function getKey(){return 'mock-key'};export async function mutate(_,__,fn){const p=structuredClone(globalThis.film);fn(p);globalThis.film=p;return structuredClone(p)}`}));
 b.onLoad({filter:/provider/,namespace:'test'},()=>({contents:`export class ProviderError extends Error{};export async function generate(job){return globalThis.generateMock(job)}`}));
}}]});
const {prepareMediaPrompt}=await import('../work/tests/acting-optimization-retention.mjs');
const source=[{key:'action',label:'Action',text:'Release arrow toward forest.',required:true,priority:100},{key:'performance.0',label:'Acting',text:'Prince: goal win; subtext the forest means uncertainty; confident excitement, then seeing the arrow above trees his brows tighten and shoulders fall; end anxious; mouth closed.',required:true,priority:90,verbatim:true},{key:'camera-movement',label:'Camera',text:'Slow push-in to his reaction, 0–4 seconds.',required:true,priority:100,verbatim:true}];
const fresh={id:'media',itemId:'shot',batchId:'batch',model:'grok-imagine-video-1.5',kind:'video',prompt:'Long original '.repeat(450),promptSections:structuredClone(source),refs:['first'],duration:5,providerDuration:5,status:'dispatching',created:new Date().toISOString(),actual:null,estimate:null};
globalThis.film={id:'project',jobs:[fresh],limit:null};let calls=0;
const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('No real provider calls allowed');};
globalThis.generateMock=async job=>{
 assert.equal(job.kind,'text');assert.equal(job.purpose,'prompt-optimization');
 assert(job.prompt.includes(source[1].text)&&job.prompt.includes(source[2].text),'Every optimization, including fallback, receives the same locked task');
 calls++;return {text:JSON.stringify({sections:[{key:'action',text:calls===1?'A'.repeat(2800):'Release arrow.'},{key:'performance.0',text:'Generic natural face.'},{key:'camera-movement',text:'Freeze camera.'}]}),requestId:'mock-'+calls,actual:'1'};
};
try{
 let result=await prepareMediaPrompt('u','project',structuredClone(fresh),'mock-key');
 assert.equal(calls,1);let first=result.jobs[0];assert.equal(first.status,'queued');assert.equal(first.promptOptimization.state,'done');
 assert.deepEqual(first.promptSections,source,'Protected structured source survives successful optimization');
 assert(first.prompt.includes(source[1].text)&&first.prompt.includes(source[2].text));assert(!first.prompt.includes('Generic natural face'));
 await prepareMediaPrompt('u','project',structuredClone(first),'mock-key');assert.equal(calls,1,'An already fitting result is not optimized again');
 // A NEW fallback request has a smaller provider limit, but must retain the
 // frozen source, not silently treat the first compact result as free text.
 const fallback={...structuredClone(first),id:'fallback',model:'fal-kling-3.0-pro',status:'dispatching',promptOptimization:undefined};
 globalThis.film.jobs.push(fallback);
 result=await prepareMediaPrompt('u','project',structuredClone(fallback),'mock-key');
 const second=result.jobs.find(j=>j.id==='fallback');assert.equal(calls,2);assert(second.prompt.length<2500);
 assert(second.prompt.includes(source[1].text)&&second.prompt.includes(source[2].text));assert.deepEqual(second.promptSections,source);
 assert(!second.prompt.includes('Generic natural face')&&!second.prompt.includes('Freeze camera'));
 assert.equal(result.jobs.filter(j=>j.purpose==='prompt-optimization').length,2,'Receipts remain separate for the two preparations');
 assert.equal(result.jobs[0].prompt,first.prompt,'The previous media request is not rewritten');
 console.log('PASS actor/camera source survives successful optimization and a second preparation for a smaller-model fallback; no duplicate preparation, no provider calls, separate receipts, prior request unchanged.');
}finally{globalThis.fetch=previous;delete globalThis.generateMock;delete globalThis.film;}
