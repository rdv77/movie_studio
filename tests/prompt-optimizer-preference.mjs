import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export {prepareMediaPrompt} from './lib/prompt-optimization-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-optimizer-preference.mjs',plugins:[{name:'local-io',setup(b){
  b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'store',namespace:'test'}));
  b.onResolve({filter:/^\.\/providers$/},()=>({path:'providers',namespace:'test'}));
  b.onLoad({filter:/store/,namespace:'test'},()=>({contents:`export async function loadProject(){return structuredClone(globalThis.film)};export async function getKey(_,provider){if(globalThis.missing.has(provider))throw Error('Missing key');return 'fake'};export async function mutate(_,__,fn){const copy=structuredClone(globalThis.film);fn(copy);globalThis.film=copy;return structuredClone(copy)}`}));
  b.onLoad({filter:/providers/,namespace:'test'},()=>({contents:`export class ProviderError extends Error{constructor(m,definite,notSent){super(m);this.definite=definite;this.notSent=notSent}};export async function generate(job){globalThis.calls.push(structuredClone(job));if(globalThis.fail)throw Error('Unknown transport outcome');return {text:JSON.stringify({sections:[{key:'action',text:'Look at the frog. Mouth closed.'}]}),actual:null,usage:{prompt_tokens:100,completion_tokens:100},requestId:'mock-receipt'}}`}));
}}]});
const {prepareMediaPrompt}=await import('../work/tests/prompt-optimizer-preference.mjs');
const at=Date.now(),iso=offset=>new Date(at+offset).toISOString();
const successful=(model,offset=0,changes={})=>({id:model+offset,kind:'text',model,purpose:'directing',status:'done',created:iso(offset),actual:'0',estimate:null,output:{text:'{"shots":[]}'},...changes});
const reset=(history=[])=>{
  globalThis.calls=[];globalThis.missing=new Set();globalThis.fail=false;
  globalThis.film={id:'film',limit:null,jobs:[{id:'video',itemId:'item',batchId:'batch',kind:'video',model:'MiniMax-H3',prompt:'Long scene prompt. '.repeat(1000),promptSections:[{key:'action',label:'Action',text:'Look at the frog. Mouth closed.',required:true,priority:100}],refs:[],duration:6,created:iso(1),status:'dispatching',estimate:'4800000000',actual:null},...history]};
};
const prepare=()=>prepareMediaPrompt('owner','film',structuredClone(film.jobs[0]),'fake');
const chosen=()=>calls.at(-1).model;
reset();await prepare();assert.equal(chosen(),'gpt-6-astra','No successful history preserves the existing fallback order');
reset([successful('MiniMax-M2.7'),successful('grok-4.6',100,{status:'unknown'}),successful('gpt-6-astra',200,{status:'failed'})]);
await prepare();assert.equal(chosen(),'MiniMax-M2.7');assert.equal(calls[0].estimate,null);assert.equal(calls[0].actual,null);
assert.equal(film.jobs.at(-1).usage.completion_tokens,100);assert.equal(film.jobs.at(-1).actual,null,'Preference does not invent a charge or estimate');
for(const changes of [{status:'unknown'},{status:'failed'},{error:'Validation failed'},{output:{text:''}},{purpose:'prompt-optimization'},{kind:'image'}]){
  reset([successful('MiniMax-M2.7',100,changes)]);await prepare();assert.equal(chosen(),'gpt-6-astra',JSON.stringify(changes));
}
reset([successful('MiniMax-M2.7',-200),successful('grok-4.6',-100)]);await prepare();assert.equal(chosen(),'grok-4.6','The most recent successful allowed model wins');
reset([successful('grok-4.6',-100),successful('MiniMax-M2.7')]);missing.add('minimax');await prepare();assert.equal(chosen(),'grok-4.6','An unavailable recent model does not hide another available success');
reset([successful('MiniMax-M2.7',-10000),successful('MiniMax-M2.7',-1000,{id:'cool1',purpose:'prompt-optimization',status:'failed',output:undefined}),successful('MiniMax-M2.7',-500,{id:'cool2',purpose:'prompt-optimization',status:'unknown',output:undefined})]);
await prepare();assert.equal(chosen(),'gpt-6-astra','Cooldown still overrides successful directing history');
reset([successful('MiniMax-M2.7')]);fail=true;await prepare();assert.equal(chosen(),'MiniMax-M2.7');assert.equal(film.jobs.at(-1).status,'unknown');
fail=false;film.jobs[0].status='dispatching';await prepare();assert.equal(chosen(),'gpt-6-astra','The original fallback order follows the one preferred model');
assert.deepEqual(film.jobs[0].promptOptimization.triedModels,['MiniMax-M2.7','gpt-6-astra']);assert.equal(calls.length,2,'The unknown MiniMax attempt is not replayed');
reset([successful('MiniMax-M2.7')]);film.limit='6000000000';await assert.rejects(prepare,/оценки всех попыток/);assert.equal(calls.length,0,'Preference cannot bypass the unchanged unknown-cost budget guard');
console.log('PASS recent successful project model preference, failed/unknown exclusion, availability/cooldown/tried guards, unchanged fallback order and cost guard, no duplicate unknown calls. All providers mocked.');
