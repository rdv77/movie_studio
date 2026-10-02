import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const server=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-user')!=='owner')throw new HttpError('Unauthorized',401);return 'owner'};
export async function loadProject(user,id){if(user!=='owner'||id!==globalThis.recoveryState.id)throw new HttpError('Not found',404);return JSON.parse(JSON.stringify(globalThis.recoveryState));}
export async function saveProject(user,p,expected){globalThis.recoverySaveAttempts++;if(globalThis.recoveryConflict){globalThis.recoveryConflict=false;throw new HttpError('CAS conflict',409)}if(user!=='owner'||expected!==globalThis.recoveryState.revision)throw new HttpError('Revision',409);p.revision=expected+1;globalThis.recoveryState=JSON.parse(JSON.stringify(p));return p;}
export async function mutate(user,id,fn){const p=await loadProject(user,id),expected=p.revision;fn(p);return saveProject(user,p,expected);}
export async function getKey(user,provider){globalThis.recoveryKeyReads.push(provider);if(globalThis.recoveryMissingKey)throw Error('Нет ключа API');return 'mock-key';}
`;
const provider=`export async function generate(){globalThis.recoveryProviderCalls++;throw Error('Unexpected provider request during recovery test');}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as S from './lib/script-workflow';export {ensureDirecting,directorRunActive} from './lib/directing';export {POST} from './app/api/projects/[id]/directing/route';export {runDirectorStep} from './lib/director-runner';export {ScriptWorkflowEditor} from './app/script-workflow-editor';export {queueHookProject,captureQueueHook} from './lib/api-queue-hook';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/unsent-script-recovery.mjs',external:['react','react-dom'],plugins:[{name:'recovery-mocks',setup(b){
  b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'recovery'}));
  b.onResolve({filter:/^\.\/providers$/},()=>({path:'provider',namespace:'recovery'}));
  b.onLoad({filter:/.*/,namespace:'recovery'},args=>({contents:args.path==='server'?server:provider}));
}}]});
const {D,S,ensureDirecting,directorRunActive,POST,runDirectorStep,ScriptWorkflowEditor,queueHookProject,captureQueueHook}=await import('../work/tests/unsent-script-recovery.mjs');

// Reproduce the exact old algorithm independently of the compatibility helper.
function oldStable(value){return Array.isArray(value)?'['+value.map(oldStable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+oldStable(value[key])).join(',')+'}':JSON.stringify(value)??'null';}
function oldBasis(input){let a=2166136261,b=5381;for(const c of oldStable(input)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);}
function legacyBasis(input){const old=structuredClone(input);old.parentRunId=undefined;old.parentTaskId=undefined;old.versionInfo.settings.parentRunId=undefined;old.versionInfo.settings.parentTaskId=undefined;return oldBasis(old);}
function fixture(selectedModel='gpt-6-astra'){
  const p=D.newProject('Замороженный фильм'),d=ensureDirecting(p),item=p.items.find(i=>i.stage===0);
  d.brief.locked='Корона уже надета на лягушку.';
  const source=D.addVariant(p,item.id,{kind:'text',title:'Исходный вариант',text:'Мальчик находит лягушку с короной.'});D.approve(p,item.id);
  const run=S.createScriptWorkflowRun(p,selectedModel,['script-adaptation','script-critic'],source.id,undefined,{methodologyIds:['cause_effect'],promptOverrides:{'script-adaptation':'Сохрани спокойное удивление.'}});
  run.basis=legacyBasis(run.scriptInput);run.stopped=true;
  const persisted=JSON.parse(JSON.stringify(p));return {p:persisted,run:persisted.directing.runs[0],sourceId:source.id};
}
function setup(p){globalThis.recoveryState=structuredClone(p);globalThis.recoveryKeyReads=[];globalThis.recoveryProviderCalls=0;globalThis.recoverySaveAttempts=0;globalThis.recoveryMissingKey=false;globalThis.recoveryConflict=false;}
const request=(data,options={})=>POST(new Request(`http://localhost/api/projects/${options.projectId??recoveryState.id}/directing`,{method:'POST',headers:{'test-user':options.user??'owner'},body:JSON.stringify({action:options.action??'resumeScriptRun',revision:options.revision??recoveryState.revision,data})}),{params:Promise.resolve({id:options.projectId??recoveryState.id})});
const html=(p,busy=false)=>renderToStaticMarkup(createElement(ScriptWorkflowEditor,{p,model:'grok-4.6',busy,submit:async()=>{throw Error('Rendering must not submit recovery');}}));
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS unsent recovery:',name);}
async function rejected(p,runId,options={},message){setup(p);const before=structuredClone(recoveryState),response=await request({runId},options);assert(!response.ok);if(message)assert.match((await response.json()).error,message);assert.deepEqual(recoveryState,before);assert.equal(recoveryProviderCalls,0);return response;}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Recovery regressions must never contact a live provider');};
try{
  await test('exact persisted legacy defect is recoverable and helper preserves the existing frozen run',()=>{
    const {p,run}=fixture(),before=structuredClone(p);
    assert.notEqual(run.basis,S.scriptWorkflowBasis(run.scriptInput));assert.equal(S.scriptWorkflowBasis(run.scriptInput,run.basis),run.basis);
    assert(S.isRecoverableUnsentScriptRun(p,run));assert.deepEqual(p,before,'Checking recovery is read-only');
    assert(!S.isRecoverableUnsentScriptRun(p,structuredClone(run)),'A detached or foreign run is not owned by this project');
    const resumed=S.resumeUnsentScriptRun(p,run.id),expected=structuredClone(before);expected.directing.runs[0].basis=S.scriptWorkflowBasis(run.scriptInput);expected.directing.runs[0].stopped=false;
    assert.equal(resumed,run);assert.deepEqual(p,expected);assert(directorRunActive(run));assert(S.scriptWorkflowTaskReady(run,run.tasks[0]));
    assert.throws(()=>S.resumeUnsentScriptRun(p,run.id),/недоступно/);assert.deepEqual(p,expected,'A second recovery cannot clone or overwrite the run');
  });
  await test('manual stop, sent or unknown tasks, saved results and any execution markers cannot be recovered',async()=>{
    const mutations=[
      run=>run.tasks.forEach(t=>t.error='Проработка остановлена.'),
      run=>run.tasks[0].jobId=D.id(),run=>run.tasks[0].result={title:'Ответ'},run=>run.tasks[0].result=null,
      run=>run.tasks[0].applied=true,run=>run.tasks[0].applied=false,run=>run.tasks[0].error='',
      run=>run.tasks[0].importedVariantId=D.id(),run=>run.tasks[0].lateResult=true,
    ];
    for(const mutate of mutations){const {p,run}=fixture();mutate(run);assert(!S.isRecoverableUnsentScriptRun(p,run));const before=structuredClone(p);assert.throws(()=>S.resumeUnsentScriptRun(p,run.id));assert.deepEqual(p,before);await rejected(p,run.id);assert.equal(recoveryKeyReads.length,0);assert(!html(p).includes('Продолжить этот запуск'));}
    for(const status of ['queued','dispatching','unknown','failed','done']){const {p,run}=fixture();p.jobs.push({id:D.id(),batchId:run.id,status,purpose:'directing'});assert(!S.isRecoverableUnsentScriptRun(p,run));await rejected(p,run.id);assert.equal(recoveryKeyReads.length,0);}
  });
  await test('canonical stop, changed fingerprints and malformed runs fail closed',async()=>{
    const mutations=[run=>run.basis=S.scriptWorkflowBasis(run.scriptInput),run=>run.basis='unrecognized',run=>run.scriptInput.text+=' Подмена.',
      run=>run.model='grok-4.6',run=>run.tasks[1].requires=[],run=>run.tasks[0].role='script-control',
      run=>run.tasks[1].id=run.tasks[0].id,run=>run.stopped='true',run=>run.scriptInput.schemaVersion=99];
    for(const mutate of mutations){const {p,run}=fixture();mutate(run);assert(!S.isRecoverableUnsentScriptRun(p,run));await rejected(p,run.id);assert.equal(recoveryKeyReads.length,0);}
    for(const malformed of [null,{}, {mode:'script-workflow',stopped:true,scriptInput:{},tasks:[]}, {mode:'script-workflow',stopped:true,scriptInput:{},tasks:null}])assert(!S.isRecoverableUnsentScriptRun(fixture().p,malformed));
  });
  await test('reading, rendering and advancing a stopped run never silently revives it',async()=>{
    const {p,run}=fixture();setup(p);const before=structuredClone(recoveryState),view=html(p);
    assert(view.includes('Запрос к модели не отправлен.'));assert(view.includes('Продолжить этот запуск'));assert(view.includes('GPT-6 Astra'));
    assert.deepEqual(p,before);await runDirectorStep('owner',p.id);await runDirectorStep('owner',p.id,{dispatch:false});
    assert.deepEqual(recoveryState,before);assert.equal(recoverySaveAttempts,0);assert.equal(recoveryKeyReads.length,0);assert.equal(recoveryProviderCalls,0);
    assert.match(html(p,true),/<button[^>]*disabled[^>]*>Продолжить этот запуск<\/button>/);
  });
  await test('explicit API recovery admits the stored model and preserves ID, settings, current choices and all jobs',async()=>{
    const {p,run}=fixture();p.title='Текущая правка фильма';p.directing.brief.locked='Поздняя правка задания';p.items[0].variants[0].text='Поздняя правка исходника';
    setup(p);const expected=structuredClone(p);expected.directing.runs[0].basis=S.scriptWorkflowBasis(run.scriptInput);expected.directing.runs[0].stopped=false;expected.revision++;
    const response=await request({runId:run.id,model:'grok-4.6',sourceVariantId:D.id()});assert.equal(response.status,200,await response.clone().text());
    assert.deepEqual(recoveryState,expected);assert.deepEqual(recoveryKeyReads,['openai']);assert.equal(recoverySaveAttempts,1);assert.equal(recoveryProviderCalls,0);
    assert(!html(recoveryState).includes('Продолжить этот запуск'));assert(S.scriptWorkflowPrompt(recoveryState,recoveryState.directing.runs[0],recoveryState.directing.runs[0].tasks[0]).includes('Корона уже надета'));
    const before=structuredClone(recoveryState),repeat=await request({runId:run.id});assert(!repeat.ok);assert.deepEqual(recoveryState,before);assert.equal(recoveryProviderCalls,0);
  });
  await test('active-run protection blocks recovery before admission or mutation',async()=>{
    const {p,run,sourceId}=fixture();S.createScriptWorkflowRun(p,'grok-4.6',['script-control'],sourceId);
    assert(!S.isRecoverableUnsentScriptRun(p,run));await rejected(p,run.id,{},/Дождитесь/);assert.equal(recoveryKeyReads.length,0);assert(!html(p).includes('Продолжить этот запуск'));
  });
  await test('model, provider key and budget admission fail atomically without paid calls',async()=>{
    for(const selectedModel of ['unsupported-model','image-01','fal-wan-2.2-a14b']){const {p,run}=fixture(selectedModel);assert(S.isRecoverableUnsentScriptRun(p,run));await rejected(p,run.id);assert.equal(recoveryKeyReads.length,0);}
    const keyFixture=fixture();setup(keyFixture.p);recoveryMissingKey=true;const before=structuredClone(recoveryState),missing=await request({runId:keyFixture.run.id});assert(!missing.ok);assert.deepEqual(recoveryState,before);assert.equal(recoverySaveAttempts,0);assert.equal(recoveryProviderCalls,0);
    const budget=fixture();budget.p.limit='1000000000';await rejected(budget.p,budget.run.id,{},/Снимите лимит/);assert.equal(recoverySaveAttempts,0);
    for(const [selectedModel,providerName] of [['grok-4.6','xai'],['MiniMax-M2.7','minimax']]){const {p,run}=fixture(selectedModel);setup(p);const response=await request({runId:run.id});assert(response.ok);assert.deepEqual(recoveryKeyReads,[providerName]);assert.equal(recoveryProviderCalls,0);}
  });
  await test('authentication, ownership, stale revision and final CAS preserve the stopped run',async()=>{
    const {p,run}=fixture();assert.equal((await rejected(p,run.id,{user:'foreign'})).status,401);assert.equal(recoveryKeyReads.length,0);
    assert.equal((await rejected(p,run.id,{projectId:D.id()})).status,404);assert.equal(recoveryKeyReads.length,0);
    await rejected(p,run.id,{revision:p.revision-1},/изменился/);assert.equal(recoveryKeyReads.length,0);
    await rejected(p,D.id());assert.equal(recoveryKeyReads.length,0);await rejected(p,'not-a-uuid');assert.equal(recoveryKeyReads.length,0);
    setup(p);recoveryConflict=true;const before=structuredClone(recoveryState),response=await request({runId:run.id});assert.equal(response.status,409);assert.deepEqual(recoveryState,before);assert.equal(recoveryProviderCalls,0);
  });
  await test('explicit recovery participates in the hosted save-then-wake queue hook',async()=>{
    const {p}=fixture(),path=`/api/projects/${p.id}/directing`,body={action:'resumeScriptRun',revision:p.revision,data:{runId:p.directing.runs[0].id}};
    assert.equal(queueHookProject('POST',path,body),p.id);assert.equal(queueHookProject('GET',path,body),undefined);assert.equal(queueHookProject('POST',path,{action:'inspectScriptRun'}),undefined);
    const req=new Request(`http://localhost${path}`,{method:'POST',body:JSON.stringify(body)});assert.equal(await captureQueueHook(req),p.id);assert.deepEqual(await req.json(),body,'Capturing does not consume the route body');
  });
}finally{
  globalThis.fetch=originalFetch;
  for(const name of ['recoveryState','recoveryKeyReads','recoveryProviderCalls','recoverySaveAttempts','recoveryMissingKey','recoveryConflict'])delete globalThis[name];
}
console.log(`PASS ${checks} bounded unsent script recovery regression groups. Mocked database, keys and providers; no paid requests.`);
