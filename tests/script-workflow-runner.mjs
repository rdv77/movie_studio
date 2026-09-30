import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`
export const loadProject=async()=>structuredClone(globalThis.scriptRunnerState);
export const getKey=async()=> 'local-mock-key';
export async function mutate(user,id,fn){
 for(let n=0;n<10;n++){
  const revision=globalThis.scriptRunnerState.revision,p=structuredClone(globalThis.scriptRunnerState);fn(p);await Promise.resolve();
  if(revision!==globalThis.scriptRunnerState.revision)continue;
  p.revision++;globalThis.scriptRunnerState=structuredClone(p);return structuredClone(p);
 }throw Error('Mock CAS exhausted');
}`;
const provider=`
export async function generate(job){
 globalThis.scriptRunnerCalls.push(structuredClone(job));
 await new Promise(resolve=>globalThis.scriptRunnerReleases.set(job.id,resolve));
 if(globalThis.scriptRunnerFailure==='definite')throw Object.assign(Error('Provider rejected input'),{definite:true});
 if(globalThis.scriptRunnerFailure==='unknown')throw Error('Transport response lost');
 const context=JSON.parse(job.prompt.split('Задание и замороженный контекст:\\n')[1]);
 const text=context.role==='script-critic'||context.role==='script-control'?context.currentText:context.currentText+'\\nПоказан выбор героя.';
 return {text:JSON.stringify({title:'Результат '+context.role,text,changes:[],findings:[]}),requestId:'receipt-'+job.id,actual:'123',usage:{input_tokens:100,output_tokens:50}};
}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export {ensureDirecting,directorRunActive} from './lib/directing';export * as S from './lib/script-workflow';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/script-workflow-runner.mjs',plugins:[{name:'isolated-script-runner',setup(b){
 b.onResolve({filter:/^\.\/(server|providers)$/},args=>({path:args.path,namespace:'script-runner-mock'}));
 b.onLoad({filter:/.*/,namespace:'script-runner-mock'},args=>({contents:args.path==='./server'?server:provider}));
}}]});
const {D,S,ensureDirecting,directorRunActive,runDirectorStep}=await import('../work/tests/script-workflow-runner.mjs');
const fixture=(roles=['script-adaptation','script-control'])=>{const p=D.newProject('Изолированный сценарий'),item=p.items.find(i=>i.stage===0);const source=D.addVariant(p,item.id,{kind:'text',title:'Исходник',text:'Мальчик находит лягушку.'});D.approve(p,item.id);ensureDirecting(p);const run=S.createScriptWorkflowRun(p,'gpt-6-astra',roles,source.id);return {p,item,source,run};};
const setup=p=>{globalThis.scriptRunnerState=structuredClone(p);globalThis.scriptRunnerCalls=[];globalThis.scriptRunnerReleases=new Map();globalThis.scriptRunnerFailure=undefined;};
const waitForCalls=async expected=>{for(let n=0;n<1000&&scriptRunnerCalls.length<expected;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(scriptRunnerCalls.length,expected,'Expected one mocked provider call for an admitted task');};
const advance=()=>runDirectorStep('owner',scriptRunnerState.id);
const releaseLatest=()=>scriptRunnerReleases.get(scriptRunnerCalls.at(-1).id)();
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS script workflow runner:',name);}

await test('two concurrent consumers claim once; receipts preserved; no automatic import',async()=>{
 const {p,item,source}=fixture();setup(p);const selected=item.selectedId,approved=item.approvedId;
 const flights=[advance(),advance()];await waitForCalls(1);assert.equal(scriptRunnerState.jobs.length,1);assert.equal(scriptRunnerState.jobs[0].itemId,item.id);
 releaseLatest();await Promise.all(flights);assert.equal(scriptRunnerState.jobs[0].status,'done');assert.equal(scriptRunnerState.jobs[0].actual,'123');assert.equal(scriptRunnerState.jobs[0].requestId,'receipt-'+scriptRunnerState.jobs[0].id);
 assert.equal(scriptRunnerState.items[0].variants.length,1);assert.equal(scriptRunnerState.items[0].selectedId,selected);assert.equal(scriptRunnerState.items[0].approvedId,approved);
 const next=advance();await waitForCalls(2);releaseLatest();await next;assert(scriptRunnerState.directing.runs[0].tasks.every(t=>t.applied));
 const revision=scriptRunnerState.revision;await advance();assert.equal(scriptRunnerCalls.length,2);assert.equal(scriptRunnerState.revision,revision,'Completed workflow idle tick must not write');
 const prior=structuredClone(scriptRunnerState.directing.runs[0]),task=prior.tasks[0];const branch=S.createScriptWorkflowRun(scriptRunnerState,'gpt-6-astra',['script-producer'],source.id,task.id);assert.equal(branch.scriptInput.text,S.scriptWorkflowResultSchema.parse(task.result).text);
 assert.deepEqual(scriptRunnerState.directing.runs[0],prior);
});
await test('changed film foundation cannot rewrite frozen provider input or cancel candidate branch',async()=>{
 const {p,item}=fixture(['script-adaptation']);setup(p);const frozen=structuredClone(p.directing.runs[0].scriptInput);
 scriptRunnerState.title='Позднее название';scriptRunnerState.configVersion++;scriptRunnerState.directing.brief.genre='Хоррор';scriptRunnerState.items[0].variants[0].text='Другой сюжет';
 const flight=advance();await waitForCalls(1);const sent=scriptRunnerCalls[0];assert(sent.prompt.includes(frozen.text));assert(!sent.prompt.includes('Другой сюжет'));assert.equal(sent.itemId,item.id);
 releaseLatest();await flight;assert.equal(scriptRunnerState.jobs[0].status,'done');assert(scriptRunnerState.directing.runs[0].tasks[0].applied);assert.equal(scriptRunnerState.items[0].variants.length,1);
});
await test('stop keeps late receipt/result but never launches subsequent step',async()=>{
 const {p}=fixture();setup(p);const flight=advance();await waitForCalls(1);scriptRunnerState.directing.runs[0].stopped=true;
 scriptRunnerState.jobs[0].status='unknown';scriptRunnerState.directing.runs[0].tasks[0].error='Ожидание остановлено.';
 releaseLatest();await flight;assert.equal(scriptRunnerState.jobs[0].status,'done');assert.equal(scriptRunnerState.jobs[0].actual,'123');assert(scriptRunnerState.directing.runs[0].tasks[0].lateResult);
 await advance();assert.equal(scriptRunnerCalls.length,1);assert.equal(scriptRunnerState.directing.runs[0].tasks[1].jobId,undefined);
});
for(const failure of ['definite','unknown'])await test(failure+' failure terminates dependent chain without paid retry or permanent active lock',async()=>{
 const {p,source}=fixture();setup(p);scriptRunnerFailure=failure;const flight=advance();await waitForCalls(1);releaseLatest();await flight;
 assert.equal(scriptRunnerState.jobs[0].status,failure==='definite'?'failed':'unknown');assert.equal(scriptRunnerState.jobs[0].actual,null);
 const run=scriptRunnerState.directing.runs[0];assert(!directorRunActive(run),'Blocked descendants must not leave the director UI permanently running');
 await advance();assert.equal(scriptRunnerCalls.length,1,'No automatic retry after failed or uncertain paid request');
 scriptRunnerFailure=undefined;assert.doesNotThrow(()=>S.createScriptWorkflowRun(scriptRunnerState,'gpt-6-astra',['script-control'],source.id));
});
delete globalThis.scriptRunnerState;delete globalThis.scriptRunnerCalls;delete globalThis.scriptRunnerReleases;delete globalThis.scriptRunnerFailure;
console.log(`PASS ${checks} script workflow runner regressions. All provider calls mocked; no paid requests.`);
