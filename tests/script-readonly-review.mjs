import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export {ensureDirecting} from './lib/directing';export * as S from './lib/script-workflow';export {ScriptWorkflowEditor} from './app/script-workflow-editor';`},bundle:true,platform:'node',format:'esm',external:['react','react-dom'],outfile:'work/tests/script-readonly-review.mjs'});
const {D,S,ensureDirecting,ScriptWorkflowEditor}=await import('../work/tests/script-readonly-review.mjs');
const arc={character:'Герой',want:'Найти дорогу.',expectation:'Путь свободен.',stakes:'Нужно успеть.',emotionStart:'Уверенность.',emotionEnd:'Решимость.',beats:[{trigger:'Путь закрыт.',meaning:'Нужен обход.',emotionStart:'Уверенность.',emotionEnd:'Решимость.',decision:'Искать обход.',visibleEvidence:'Останавливается, смотрит по сторонам, идёт к обходу.'}]};
function fixture(role){const p=D.newProject('Проверка'),d=ensureDirecting(p),item=p.items.find(i=>i.stage===0),source=D.addVariant(p,item.id,{kind:'text',title:'Оригинал',text:'Герой видит преграду и ищет обход.'});source.versionInfo.settings={emotionalArcs:[arc]};D.approve(p,item.id);const run=S.createScriptWorkflowRun(p,'test-model',[role],source.id);return {p,d,item,source,run,task:run.tasks[0]};}
const finding={severity:'note',evidence:'Пауза может быть слишком короткой.',proposal:'Оставить время на распознавание преграды.'};
for(const role of ['script-critic','script-control']){
  const {p,item,source,run,task}=fixture(role),foundation=JSON.stringify(p.items),raw={findings:[finding]};
  const prompt=S.scriptWorkflowPrompt(p,run,task);assert(prompt.includes('Не переписывай и не копируй text'));assert(!prompt.includes('"text":"полный текст сценария"'));
  S.applyScriptWorkflowResult(p,run,task,raw);
  assert.equal(task.result.text,source.text);assert.deepEqual(task.result.emotionalArcs,[arc]);assert.deepEqual(task.result.changes,[]);assert.equal(task.processingWarning,undefined);assert.equal(task.result.findings[0].requiresDirectorChoice,true);
  assert.equal(JSON.stringify(p.items),foundation);assert.deepEqual(raw,{findings:[finding]});
  assert.doesNotThrow(()=>S.applyScriptWorkflowResult(p,run,task,raw));
  const imported=S.importScriptWorkflowCandidate(p,run.id,task.id);assert.equal(imported.text,source.text);assert.deepEqual(imported.versionInfo.settings.emotionalArcs,[arc]);assert.equal(item.approvedId,source.id);

  const rewrite=fixture(role),rewritten={title:'Проверка',text:'МОДЕЛЬ ПЕРЕПИСАЛА ФИНАЛ.',changes:['Переписала финал.'],emotionalArcs:[],findings:[finding]};
  const receipt=JSON.stringify(rewritten);rewrite.task.jobId=D.id();rewrite.p.jobs.push({id:rewrite.task.jobId,prompt:'PROMPT',output:{text:receipt}});
  S.applyScriptWorkflowResult(rewrite.p,rewrite.run,rewrite.task,rewritten);
  assert.equal(rewrite.task.result.text,rewrite.source.text);assert.deepEqual(rewrite.task.result.emotionalArcs,[arc]);assert.deepEqual(rewrite.task.result.changes,[]);assert(rewrite.task.processingWarning.includes('не применило'));
  assert.equal(JSON.stringify(rewritten),receipt);assert.equal(rewrite.p.jobs[0].output.text,receipt,'Raw provider receipt remains unchanged');
  const html=renderToStaticMarkup(createElement(ScriptWorkflowEditor,{p:rewrite.p,model:'test-model',busy:false,submit:async()=>{throw Error('No mutations during display');}}));
  assert(html.includes('Модель проверки вернула'));assert(html.includes('Необработанный ответ модели проверки'));assert(html.includes('МОДЕЛЬ ПЕРЕПИСАЛА ФИНАЛ.'));

  for(const bad of [{title:'Проверка'}, {findings:'нет'}, {findings:[],text:42}, {findings:[],changes:'правка'}, {findings:[],unexpected:true}]){const f=fixture(role);assert.throws(()=>S.applyScriptWorkflowResult(f.p,f.run,f.task,bad));assert.equal(f.task.result,undefined);}
}
for(const role of ['script-adaptation','script-dramaturg','script-producer']){const f=fixture(role);assert.throws(()=>S.applyScriptWorkflowResult(f.p,f.run,f.task,{title:'Редактура',text:'Новый текст',changes:[],findings:[]}),/потеряна эмоциональная линия/);assert.equal(f.task.result,undefined);}
console.log('PASS review-only contract: concise findings, canonical source text/arcs, explicit warning and raw receipt for ignored edits, unchanged approvals, writer strictness, invalid payload rejection. No API calls.');
