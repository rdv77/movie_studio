import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`
import {encodeProjectState,decodeProjectState} from './project-state';
const files={put:async()=>{throw Error('Mock projects must stay inline');}};
export const loadProject=async()=>decodeProjectState(files,'owner',globalThis.scriptRunnerState.id,JSON.stringify(globalThis.scriptRunnerState),globalThis.scriptRunnerState.revision);
export const getKey=async()=> 'local-mock-key';
export async function mutate(user,id,fn){
 for(let n=0;n<10;n++){
  const revision=globalThis.scriptRunnerState.revision,p=await loadProject();fn(p);p.revision++;
  const encoded=await encodeProjectState(files,'owner',p);
  if(revision!==globalThis.scriptRunnerState.revision)continue;
  globalThis.scriptRunnerState=JSON.parse(encoded.state);return loadProject();
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
 b.onLoad({filter:/.*/,namespace:'script-runner-mock'},args=>({contents:args.path==='./server'?server:provider,resolveDir:process.cwd()+'/lib'}));
}}]});
const {D,S,ensureDirecting,directorRunActive,runDirectorStep}=await import('../work/tests/script-workflow-runner.mjs');
const fixture=(roles=['script-adaptation','script-control'])=>{const p=D.newProject('Изолированный сценарий'),item=p.items.find(i=>i.stage===0);const source=D.addVariant(p,item.id,{kind:'text',title:'Исходник',text:'Мальчик находит лягушку.'});ensureDirecting(p);const run=S.createScriptWorkflowRun(p,'gpt-6-astra',roles,source.id);return {p,item,source,run};};
const setup=p=>{globalThis.scriptRunnerState=JSON.parse(JSON.stringify(p));globalThis.scriptRunnerCalls=[];globalThis.scriptRunnerReleases=new Map();globalThis.scriptRunnerFailure=undefined;};
const waitForCalls=async expected=>{for(let n=0;n<1000&&scriptRunnerCalls.length<expected;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(scriptRunnerCalls.length,expected,'Expected one mocked provider call for an admitted task');};
const advance=()=>runDirectorStep('owner',scriptRunnerState.id);
const releaseLatest=()=>scriptRunnerReleases.get(scriptRunnerCalls.at(-1).id)();
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS script workflow runner:',name);}
const legacyBasis=input=>{const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)??'null';let a=2166136261,b=5381;for(const c of stable(input)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);};

await test('all five roles survive actual JSON storage; unapproved source and frozen input stay unchanged',async()=>{
 const {p,item,source,run}=fixture([...S.SCRIPT_ROLES]);assert.equal(item.approvedId,undefined);setup(p);
 const frozen=JSON.stringify(scriptRunnerState.directing.runs[0].scriptInput),basis=run.basis;
 for(let n=0;n<S.SCRIPT_ROLES.length;n++){
  const flight=advance();await waitForCalls(n+1);
  assert.equal(scriptRunnerState.jobs.length,n+1);assert.equal(scriptRunnerState.directing.runs[0].stopped,undefined);
  const context=JSON.parse(scriptRunnerCalls[n].prompt.split('Задание и замороженный контекст:\n')[1]);assert.equal(context.role,S.SCRIPT_ROLES[n]);
  releaseLatest();await flight;
  const saved=scriptRunnerState.directing.runs[0];assert.equal(saved.basis,basis);assert.equal(JSON.stringify(saved.scriptInput),frozen);assert(saved.tasks[n].applied);assert.equal(saved.tasks[n].error,undefined);
  assert.equal(scriptRunnerState.items[0].approvedId,undefined);assert.equal(scriptRunnerState.items[0].selectedId,source.id);assert.equal(scriptRunnerState.items[0].variants.length,1);
 }
 assert(scriptRunnerState.jobs.every(j=>j.status==='done'&&j.requestId&&j.actual==='123'));
 const parent=JSON.stringify(scriptRunnerState.directing.runs[0]),last=scriptRunnerState.directing.runs[0].tasks.at(-1);
 const branch=S.createScriptWorkflowRun(scriptRunnerState,'gpt-6-astra',['script-producer'],source.id,last.id),branchId=branch.id;setup(scriptRunnerState);
 const flight=advance();await waitForCalls(1);releaseLatest();await flight;
 assert.equal(JSON.stringify(scriptRunnerState.directing.runs[0]),parent);assert(scriptRunnerState.directing.runs.find(r=>r.id===branchId).tasks[0].applied);
});
await test('recognized legacy fingerprint dispatches once after JSON without rewriting its old snapshot',async()=>{
 const {p,run}=fixture(['script-adaptation']);run.basis=legacyBasis(run.scriptInput);const oldBasis=run.basis;setup(p);
 assert.notEqual(S.scriptWorkflowBasis(scriptRunnerState.directing.runs[0].scriptInput),oldBasis);
 assert.equal(S.scriptWorkflowBasis(scriptRunnerState.directing.runs[0].scriptInput,oldBasis),oldBasis);
 const frozen=JSON.stringify(scriptRunnerState.directing.runs[0].scriptInput),flight=advance();await waitForCalls(1);releaseLatest();await flight;
 assert.equal(scriptRunnerState.jobs[0].status,'done');assert.equal(scriptRunnerState.directing.runs[0].basis,oldBasis);assert.equal(JSON.stringify(scriptRunnerState.directing.runs[0].scriptInput),frozen);
});
await test('stopped unsent legacy run stays stopped during automatic ticks and reads',async()=>{
 const {p,run}=fixture(['script-adaptation']);run.basis=legacyBasis(run.scriptInput);run.stopped=true;setup(p);const before=JSON.stringify(scriptRunnerState);
 await advance();assert.equal(scriptRunnerCalls.length,0);assert.equal(JSON.stringify(scriptRunnerState),before);assert.equal(scriptRunnerState.jobs.length,0);
});
await test('canonical and legacy frozen-input tampering stop before any provider call',async()=>{
 for(const legacy of [false,true]){
  const {p,run}=fixture(['script-adaptation']);if(legacy)run.basis=legacyBasis(run.scriptInput);setup(p);scriptRunnerState.directing.runs[0].scriptInput.text+=' Подмена замороженного текста.';
  await advance();assert.equal(scriptRunnerCalls.length,0);assert.equal(scriptRunnerState.jobs.length,0);assert.equal(scriptRunnerState.directing.runs[0].stopped,true);
 }
});

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
