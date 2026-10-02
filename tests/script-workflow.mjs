import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export {ensureDirecting} from './lib/directing';export * as S from './lib/script-workflow';export {ScriptWorkflowEditor} from './app/script-workflow-editor';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/script-workflow.mjs',external:['react','react-dom']});
const {D,S,ensureDirecting,ScriptWorkflowEditor}=await import('../work/tests/script-workflow.mjs');
const fixture=()=>{const p=D.newProject('Сказка'),d=ensureDirecting(p);d.brief={...d.brief,locked:'Корона уже надета на лягушку.',targetSeconds:120,strengths:{genre:8,style:7,surprise:5},promptNotes:'Покажи тихое удивление вместо испуга.'};const item=p.items.find(i=>i.stage===0);const source=D.addVariant(p,item.id,{kind:'text',title:'Исходник',text:'  Мальчик находит лягушку с короной.\n'});D.approve(p,item.id);return {p,d,item,source};};
const result=text=>({title:'Кандидат',text,changes:[],findings:[]});
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS script workflow:',name);}
test('canonical fingerprint and frozen prompts survive JSON serialization, including absent optional fields',()=>{
  const {p,d,item,source}=fixture();item.approvedId=undefined;d.brief.strengths=undefined;d.brief.promptNotes=undefined;
  const run=S.createScriptWorkflowRun(p,'gpt-6-astra',[...S.SCRIPT_ROLES],source.id,undefined,{promptOverrides:{'script-adaptation':undefined}});
  const prompt=S.scriptWorkflowPrompt(p,run,run.tasks[0]),saved=JSON.parse(JSON.stringify(p)),loaded=saved.directing.runs[0],before=JSON.stringify(saved);
  assert.equal(S.scriptWorkflowBasis(loaded.scriptInput),run.basis);assert.equal(S.scriptWorkflowPrompt(saved,loaded,loaded.tasks[0]),prompt);
  assert.equal(JSON.stringify(saved),before);assert.equal(saved.jobs.length,0);assert.equal(saved.items[0].approvedId,undefined);
});
test('known old fingerprint remains readable after optional parent slots disappear; tampering still rejected',()=>{
  const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id);
  const legacy=v=>Array.isArray(v)?'['+v.map(legacy).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+legacy(v[k])).join(',')+'}':JSON.stringify(v)??'null';
  let a=2166136261,b=5381;for(const c of legacy(run.scriptInput)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}run.basis=(a>>>0).toString(16)+(b>>>0).toString(16);
  const saved=JSON.parse(JSON.stringify(p)),loaded=saved.directing.runs[0],before=JSON.stringify(saved);
  assert.notEqual(S.scriptWorkflowBasis(loaded.scriptInput),loaded.basis);assert.equal(S.scriptWorkflowBasis(loaded.scriptInput,loaded.basis),loaded.basis);
  assert.doesNotThrow(()=>S.scriptWorkflowPrompt(saved,loaded,loaded.tasks[0]));assert.equal(JSON.stringify(saved),before);
  for(const mutate of [input=>{input.text+=' Подмена.';},input=>{input.parentRunId='Подменённый родитель';},input=>{input.versionInfo.settings.parentTaskId='Подменённый результат';}]){
    const copy=JSON.parse(JSON.stringify(saved)),candidate=copy.directing.runs[0];mutate(candidate.scriptInput);
    assert.throws(()=>S.scriptWorkflowPrompt(copy,candidate,candidate.tasks[0]),/изменился/);
  }
});
test('seven source-backed method cards and strict input validation',()=>{
  assert.equal(S.CINEMA_METHODS.length,7);assert.equal(new Set(S.CINEMA_METHOD_IDS).size,7);assert(S.CINEMA_METHODS.every(m=>m.sourceUrl.startsWith('https://')&&m.checks.length>0&&m.principle.length>30&&m.example.startsWith('Авторский пример приложения:')&&m.limits.length>30));
  for(const field of ['principle','example','limits'])assert.equal(new Set(S.CINEMA_METHODS.map(m=>m[field])).size,7,'Method cards must have individual '+field);
  const {p,source}=fixture(),before=JSON.stringify(p);
  for(const roles of [[],['script-critic','script-critic'],['editor']])assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',roles,source.id));
  assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],D.id()));
  assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id,undefined,{methodologyIds:['wrong']}));
  assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id,undefined,{methodologyIds:['cause_effect','cause_effect']}));
  assert.equal(JSON.stringify(p),before,'Rejected admission must be atomic');
});
test('actual role prompts contain complete selected method cards, sources and limits, without adopting sample plots',()=>{
  for(const method of S.CINEMA_METHODS){
    const {p,source,item}=fixture(),before=JSON.stringify({items:p.items,jobs:p.jobs}),role=method.roles[0];
    const run=S.createScriptWorkflowRun(p,'gpt-6-astra',[role],source.id,undefined,{methodologyIds:[method.id]}),task=run.tasks[0];
    const prompt=S.scriptWorkflowPrompt(p,run,task),context=JSON.parse(prompt.split('Задание и замороженный контекст:\n').at(-1));
    assert.deepEqual(context.methods,[{id:method.id,title:method.title,principle:method.principle,example:method.example,limits:method.limits,checks:method.checks,sourceTitle:method.sourceTitle,sourceUrl:method.sourceUrl}]);
    assert.equal(context.currentText,source.text);assert.equal(item.selectedId,source.id);assert.equal(item.approvedId,source.id);assert.equal(JSON.stringify({items:p.items,jobs:p.jobs}),before);
    assert(prompt.includes('Примеры поясняют метод и не должны автоматически переноситься в сценарий'));
    assert(prompt.includes('не гарантия качества'));assert(prompt.includes(method.limits));
  }
  const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id,undefined,{methodologyIds:['character_drive']});
  const context=JSON.parse(S.scriptWorkflowPrompt(p,run,run.tasks[0]).split('Задание и замороженный контекст:\n').at(-1));assert.deepEqual(context.methods,[],'A method not applicable to this role is omitted');
});
test('actual UI exposes principles, application examples, limits and original links without calls or mutations',()=>{
  const {p}=fixture(),before=JSON.stringify(p),originalFetch=globalThis.fetch;let submissions=0;
  globalThis.fetch=()=>{throw Error('Reading method cards must not contact a provider');};
  try{
    const html=renderToStaticMarkup(createElement(ScriptWorkflowEditor,{p,model:'gpt-6-astra',busy:false,submit:()=>{submissions++;throw Error('SSR must not enqueue');}}));
    for(const method of S.CINEMA_METHODS){assert(html.includes(method.principle));assert(html.includes(method.example));assert(html.includes(method.limits));assert(html.includes(method.sourceUrl));}
    assert(html.includes('Границы применения:'));assert(html.includes('не гарантия качества'));assert.equal(submissions,0);assert.equal(JSON.stringify(p),before);
  }finally{globalThis.fetch=originalFetch;}
});
test('subset ordered as DAG, ready tasks and frozen input regardless of project edits',()=>{
  const {p,d,item,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-control','script-adaptation','script-producer'],source.id);
  assert.deepEqual(run.tasks.map(t=>t.role),['script-adaptation','script-producer','script-control']);
  assert.deepEqual(run.tasks.map(t=>t.requires),[[],[run.tasks[0].id],[run.tasks[1].id]]);
  assert(S.scriptWorkflowTaskReady(run,run.tasks[0]));assert(!S.scriptWorkflowTaskReady(run,run.tasks[1]));
  const prompt=S.scriptWorkflowPrompt(p,run,run.tasks[0]),input=structuredClone(run.scriptInput);
  source.text='Поздняя правка';d.brief.genre='Хоррор';d.brief.strengths.genre=0;p.title='Изменено';p.format='9:16';p.configVersion++;
  item.selectedId=D.id();assert.equal(S.scriptWorkflowPrompt(p,run,run.tasks[0]),prompt);assert.deepEqual(run.scriptInput,input);
  assert(prompt.includes('Корона уже надета'));assert(prompt.includes('Жанровая выраженность — 8/10'));assert(!prompt.includes('Поздняя правка'));
  assert(prompt.includes('Покажи тихое удивление вместо испуга.'));assert.equal(input.brief.promptNotes,'Покажи тихое удивление вместо испуга.');
  assert.throws(()=>S.scriptWorkflowPrompt(p,run,run.tasks[1]),/предыдущий/);
  const foundation=JSON.stringify({items:p.items,scenes:d.scenes,brief:d.brief,jobs:p.jobs});
  S.applyScriptWorkflowResult(p,run,run.tasks[0],{...result('Первый результат.'),changes:['Усилена реакция героя.']});
  assert.equal(JSON.stringify({items:p.items,scenes:d.scenes,brief:d.brief,jobs:p.jobs}),foundation);
  assert(S.scriptWorkflowTaskReady(run,run.tasks[1]));assert(S.scriptWorkflowPrompt(p,run,run.tasks[1]).includes('Первый результат.'));
});
test('critic keeps input, dramaturg consumes its findings and control keeps candidate',()=>{
  const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-critic','script-dramaturg','script-control'],source.id);
  const [critic,dramaturg,control]=run.tasks;
  assert.throws(()=>S.applyScriptWorkflowResult(p,run,critic,result('Переписано')),/сохранить/);assert.equal(critic.result,undefined);
  const finding={methodologyId:'character_drive',severity:'note',evidence:'Выбор мальчика не показан.',proposal:'Добавить видимую паузу перед решением.',requiresDirectorChoice:true};
  S.applyScriptWorkflowResult(p,run,critic,{...result(source.text),findings:[finding]});assert(S.scriptWorkflowPrompt(p,run,dramaturg).includes(finding.proposal));
  const revised={...result('Мальчик решает взять лягушку после паузы.'),changes:['Показан выбор.']};S.applyScriptWorkflowResult(p,run,dramaturg,revised);
  assert(!S.scriptWorkflowPrompt(p,run,control).includes(finding.proposal),'Resolved criticism must not accumulate in later model inputs');
  assert.throws(()=>S.applyScriptWorkflowResult(p,run,control,{...result(revised.text),changes:['Изменена история']}),/сохранить/);
  S.applyScriptWorkflowResult(p,run,control,result(revised.text));assert(run.tasks.every(t=>t.applied));
  S.applyScriptWorkflowResult(p,run,control,result(revised.text));assert.throws(()=>S.applyScriptWorkflowResult(p,run,dramaturg,result('Другой текст')),/уже сохранён/);
});
test('one candidate imported explicitly and idempotently with frozen provenance, without choosing or approving',()=>{
  const {p,d,item,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-dramaturg'],source.id),task=run.tasks[0];task.jobId=D.id();
  const selectedId=item.selectedId,approvedId=item.approvedId,scenes=structuredClone(d.scenes),jobs=structuredClone(p.jobs),count=item.variants.length;
  assert.throws(()=>S.importScriptWorkflowCandidate(p,run.id,task.id),/завершённый/);
  S.applyScriptWorkflowResult(p,run,task,{...result('Новый сценарий.'),changes:['Добавлен обоснованный выбор.']});assert.equal(item.variants.length,count);
  const candidate=S.importScriptWorkflowCandidate(p,run.id,task.id);assert.equal(item.variants.length,count+1);assert.equal(candidate.text,'Новый сценарий.');
  assert.equal(candidate.jobId,task.jobId);assert.equal(candidate.versionInfo.parentVariantId,source.id);assert.equal(candidate.versionInfo.sources[0].followApproval,false);
  assert.equal(candidate.versionInfo.settings.runId,run.id);assert.deepEqual(candidate.versionInfo.settings.brief,run.scriptInput.brief);
  assert.equal(item.selectedId,selectedId);assert.equal(item.approvedId,approvedId);assert.deepEqual(d.scenes,scenes);assert.deepEqual(p.jobs,jobs);
  assert.equal(S.importScriptWorkflowCandidate(p,run.id,task.id).id,candidate.id);assert.equal(item.variants.length,count+1);
  D.deleteVariant(p,item.id,candidate.id);assert.throws(()=>S.importScriptWorkflowCandidate(p,run.id,task.id),/удалён/);
  D.restoreVariant(p,item.id,candidate.id);assert.equal(S.importScriptWorkflowCandidate(p,run.id,task.id).id,candidate.id);
});
test('repeat branches from completed result, preserving old run and all choices',()=>{
  const {p,item,source}=fixture(),first=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id);
  S.applyScriptWorkflowResult(p,first,first.tasks[0],result('Первый кандидат.'));
  const old=JSON.stringify(first),second=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-producer'],source.id,first.tasks[0].id,{methodologyIds:['audience_promise'],promptOverrides:{'script-producer':'Сохрани спокойный финал.'}});
  assert.equal(second.scriptInput.text,'Первый кандидат.');assert.equal(second.scriptInput.parentTaskId,first.tasks[0].id);assert.equal(second.scriptInput.parentRunId,first.id);
  assert.equal(JSON.stringify(first),old);assert.equal(item.selectedId,source.id);assert.equal(item.approvedId,source.id);
  const prompt=S.scriptWorkflowPrompt(p,second,second.tasks[0]);assert(prompt.includes('Сохрани спокойный финал.'));assert(prompt.includes('audience_promise'));
  assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',['script-critic'],source.id),/текущую/);
});
test('late valid reply stays on stopped run, can be explicitly reused, never starts dependent task',()=>{
  const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation','script-control'],source.id);
  run.stopped=true;run.tasks[0].error='Исход неизвестен';run.tasks[0].jobId=D.id();
  S.applyScriptWorkflowResult(p,run,run.tasks[0],result('Поздний результат.'));assert(run.tasks[0].lateResult);assert(run.tasks[0].applied);assert.equal(run.tasks[0].error,undefined);
  assert(!S.scriptWorkflowTaskReady(run,run.tasks[1]));const branch=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-control'],source.id,run.tasks[0].id);assert.equal(branch.scriptInput.text,'Поздний результат.');
  assert.notEqual(branch.id,run.id);assert.equal(run.tasks[1].jobId,undefined);
});
test('tampered inputs, invalid output, foreign tasks and unselected methods are rejected before mutation',()=>{
  const {p,source}=fixture(),run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],source.id,undefined,{methodologyIds:[]}),task=run.tasks[0];
  for(const data of [{...result(''),extra:true},result('   '),{...result('Вариант'),findings:[{methodologyId:'cause_effect',severity:'note',evidence:'Фрагмент',proposal:'Правка',requiresDirectorChoice:true}]}])assert.throws(()=>S.applyScriptWorkflowResult(p,run,task,data));
  assert.equal(task.result,undefined);assert.throws(()=>S.scriptWorkflowPrompt(p,run,{...task}),/не принадлежит/);
  const previous=run.scriptInput.text;run.scriptInput.text='Подменённый вход';assert.throws(()=>S.scriptWorkflowPrompt(p,run,task),/изменился/);assert.throws(()=>S.applyScriptWorkflowResult(p,run,task,result('Ответ')),/изменился/);run.scriptInput.text=previous;
  run.model='another-model';assert.throws(()=>S.scriptWorkflowPrompt(p,run,task),/изменился/);run.model=run.scriptInput.model;
  task.role='script-producer';assert.throws(()=>S.scriptWorkflowPrompt(p,run,task),/изменился/);task.role=run.scriptInput.roles[0];
  task.error='Исход неизвестен';assert(!S.scriptWorkflowTaskReady(run,task));assert.throws(()=>S.createScriptWorkflowRun(p,'gpt-6-astra',['script-control'],source.id,task.id),/завершённый/);
});
console.log(`PASS ${checks} script workflow regressions. Pure local tests; no provider requests.`);
