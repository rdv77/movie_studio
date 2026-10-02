import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain'; export * as S from './lib/script-workflow';export * as W from './lib/workflow';export {ensureDirecting} from './lib/directing';export {scriptComparisonVersions} from './lib/script-comparison';export {VersionComparison} from './app/version-comparison';export {ScriptDevelopmentEditor} from './app/script-development-editor';export {DirectingEditor} from './app/directing-editor';`},bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},outfile:'work/tests/script-development.mjs',external:['react','react-dom']});
const {D,S,W,ensureDirecting,scriptComparisonVersions,VersionComparison,ScriptDevelopmentEditor,DirectingEditor}=await import('../work/tests/script-development.mjs');
const p=D.newProject('Сравнение сказки'),item=p.items.find(i=>i.stage===0);
const raw=D.addVariant(p,item.id,{kind:'text',title:'Авторский вариант',text:'Стрела упала у болота. Царевич нашёл лягушку.'});
D.approve(p,item.id);ensureDirecting(p);
const adapt=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-adaptation'],raw.id);
S.applyScriptWorkflowResult(p,adapt,adapt.tasks[0],{title:'За камышом',text:'АДАПТАЦИЯ\n\nСтрела.\n\nВода.\n\nКорона.',changes:['Корона раскрывается после паузы.'],findings:[]});
const drama=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-dramaturg'],raw.id);
S.applyScriptWorkflowResult(p,drama,drama.tasks[0],{title:'Стрела у тихой воды',text:'ДРАМАТУРГ\n\nЦаревич решает раскрыть ладонь.',changes:['Выбор героя выражен действием.'],findings:[]});
const critic=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-critic'],raw.id);
S.applyScriptWorkflowResult(p,critic,critic.tasks[0],{title:'Проверка выбора',text:raw.text,changes:[],findings:[{severity:'note',evidence:'Решение героя не подготовлено.',proposal:'Показать колебание перед протянутой ладонью.',requiresDirectorChoice:false}]});
const before=structuredClone(p),versions=scriptComparisonVersions(p),a=versions.find(v=>v.taskId===adapt.tasks[0].id),b=versions.find(v=>v.taskId===drama.tasks[0].id);
assert(a&&b);assert.equal(a.text,adapt.tasks[0].result.text);assert.equal(b.text,drama.tasks[0].result.text);assert(versions.some(v=>v.variantId===raw.id));
assert.equal(new Set(versions.map(v=>v.id)).size,versions.length);
assert(!scriptComparisonVersions(D.newProject('Другой фильм')).some(v=>v.id===a.id));
const edited=structuredClone(p);edited.items.find(i=>i.id===item.id).variants[0].text='Изменённый исходник';
assert(scriptComparisonVersions(edited).some(v=>v.id.startsWith('input-')&&v.text===raw.text),'Frozen original survives editing');
let calls=0;const originalFetch=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('No network requests allowed in comparison');};
try{
  for(const [left,right] of [[a,b],[b,a],[a,a]]){
    const html=renderToStaticMarkup(createElement(VersionComparison,{versions,initialLeftId:left.id,initialRightId:right.id,initialMode:'full',allowFullText:true}));
    assert(html.includes(`value="${left.id}" selected=""`));assert(html.includes(`value="${right.id}" selected=""`));
    assert(!html.includes('Нет абзаца'),'Whole texts do not render alignment placeholders');
    assert(html.includes('Цельные тексты')&&html.includes('Различия по абзацам'));
  }
  const props={p,busy:false,submit:async()=>{calls++;throw Error('Rendering must not save, approve or generate');},open:()=>{calls++;}};
  const html=renderToStaticMarkup(createElement(ScriptDevelopmentEditor,props));
  assert.equal((html.match(/aria-label="Сравнить любые два сценария"/g)??[]).length,1,'One comparison for all runs');
  assert(html.includes('За камышом')&&html.includes('Стрела у тихой воды'));
  assert(html.includes('Добавить полный сценарий в варианты')&&html.includes('Заключение специалиста'));
  assert(html.includes('Решение героя не подготовлено.')&&html.includes('Показать колебание'));
  assert(html.includes('История запусков · 3')&&!html.includes('Нет абзаца'));
  const base=renderToStaticMarkup(createElement(DirectingEditor,{...props,stage:0}));
  assert(!base.includes('Команда разработки общего сценария')&&!base.includes('Сравнить любые два сценария'));
  assert(base.includes('Сохранить творческое задание')&&base.includes('Доработать сценарий со специалистами'));
  assert.equal(calls,0);assert.deepEqual(p,before,'Read-only catalog and pages preserve approvals, costs, jobs and runs');
}finally{globalThis.fetch=originalFetch;}
assert.equal(W.nextStage(0),13);assert.equal(W.nextStage(13),12);assert(W.workflowReady(p,13));
assert.equal(W.stageComplete(p,13),W.stageComplete(p,0));
assert.equal(W.projectWorkflow({...p,productionOrder:'video-first'}).findIndex(s=>s.id===13),1);
console.log('PASS script development: cross-run and cross-role comparison, independent sides, whole texts, frozen originals, separate stage, saved conclusions, no mutations or provider calls');

// Labels describe only the work actually performed before a result, even when
// the model returns the same title or later steps keep the same complete text.
const chainProject=structuredClone(p);
const chain=S.createScriptWorkflowRun(chainProject,'gpt-6-astra',['script-critic','script-dramaturg','script-control'],raw.id);
S.applyScriptWorkflowResult(chainProject,chain,chain.tasks[0],{title:'Стрела у тихой воды',text:raw.text,changes:[],findings:[]});
S.applyScriptWorkflowResult(chainProject,chain,chain.tasks[1],{title:'Стрела у тихой воды',text:'Новая драматургическая версия.',changes:['Подготовлен выбор.'],findings:[]});
S.applyScriptWorkflowResult(chainProject,chain,chain.tasks[2],{title:'Стрела у тихой воды',text:chain.tasks[1].result.text,changes:[],findings:[]});
assert.equal(S.scriptTaskChain(chainProject,chain,chain.tasks[1].id),'Критик сценария → Драматург');
const catalog=scriptComparisonVersions(chainProject);
const standalone=catalog.find(v=>v.taskId===drama.tasks[0].id),inChain=catalog.find(v=>v.taskId===chain.tasks[1].id);
assert.notEqual(standalone.label,inChain.label);assert(inChain.label.includes('Критик сценария → Драматург'));
assert(!inChain.label.includes('Контроль сценария'));
const imported=S.importScriptWorkflowCandidate(chainProject,chain.id,chain.tasks[1].id);
assert(scriptComparisonVersions(chainProject).find(v=>v.variantId===imported.id).label.includes('Критик сценария → Драматург'));
const branch=S.createScriptWorkflowRun(chainProject,'gpt-6-astra',['script-producer'],raw.id,chain.tasks[1].id);
S.applyScriptWorkflowResult(chainProject,branch,branch.tasks[0],{title:'Тот же заголовок',text:'Версия продюсера.',changes:[],findings:[]});
assert.equal(S.scriptTaskChain(chainProject,branch,branch.tasks[0].id),'Критик сценария → Драматург → Продюсер');
const continued=S.createScriptWorkflowRun(chainProject,'gpt-6-astra',['script-producer'],imported.id);
S.applyScriptWorkflowResult(chainProject,continued,continued.tasks[0],{title:'Тот же заголовок',text:'Доработка импортированного текста.',changes:[],findings:[]});
assert.equal(S.scriptTaskChain(chainProject,continued,continued.tasks[0].id),'Критик сценария → Драматург → Продюсер');
const chainBefore=structuredClone(chainProject),stageTwo=renderToStaticMarkup(createElement(ScriptDevelopmentEditor,{p:chainProject,busy:false,submit:async()=>{throw Error('No mutations');},open:()=>{}}));
assert(!stageTwo.includes('Только творческая адаптация'));
assert(stageTwo.includes('Только драматург'));
const reportProject=structuredClone(chainProject);reportProject.directing.runs=[chain];
const reportHtml=renderToStaticMarkup(createElement(ScriptDevelopmentEditor,{p:reportProject,busy:false,submit:async()=>{throw Error('No mutations');},open:()=>{}}));
assert(reportHtml.includes('Это проверка: полный текст сохранён без изменений'));
assert.deepEqual(chainProject,chainBefore);
console.log('PASS script provenance: standalone vs chain, intermediate steps, explicit branches, imported ancestry, historical adaptation preserved, read-only labels');

const scenario=structuredClone(p);scenario.directing.brief={...scenario.directing.brief,genre:'Хоррор',director:'Хичкок',targetSeconds:120,locked:'Лягушка уже носит корону.',strengths:{style:9,genre:8}};
const scenarioBefore=structuredClone(scenario);
for(let n=1;n<=3;n++){
  const request=D.promptFor(scenario,scenario.items.find(i=>i.stage===0),`Предложи вариант ${n} из 3.`,raw);
  assert(request.includes('Хичкок')&&request.includes('Хоррор')&&request.includes('Лягушка уже носит корону.')&&request.includes(raw.text));
  assert(request.includes(`вариант ${n} из 3`)&&request.includes('с ориентиром 120 секунд'));
  assert(request.includes('Верни только полный сценарий, без рецензии'));
}
assert.deepEqual(scenario,scenarioBefore);
console.log('PASS stage-one adaptation: saved genre, director, locked facts, source, distinct variant request numbers, advisory timing, no calls or state changes');
