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
