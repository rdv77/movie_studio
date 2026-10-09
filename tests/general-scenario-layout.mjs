import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

await mkdir('work/tests',{recursive:true});
await build({
  stdin:{resolveDir:process.cwd(),contents:`
    export {GeneralScriptComparison} from './app/general-script-comparison';
    export {GeneralScenarioBrief} from './app/general-scenario-brief';
    export {DirectingEditor} from './app/directing-editor';
    export * as D from './lib/domain';
    export {ensureDirecting} from './lib/directing';
    export {recordCreativeVersion} from './lib/creative-versions';
  `},
  bundle:true,platform:'node',format:'esm',outfile:'work/tests/general-scenario-layout.mjs',
  external:['react','react-dom','@ffmpeg/ffmpeg'],
  banner:{js:`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);`},
});
const {GeneralScriptComparison,GeneralScenarioBrief,DirectingEditor,D,ensureDirecting,recordCreativeVersion}=await import('../work/tests/general-scenario-layout.mjs');
let writes=0,requests=0;
const onAction=()=>{writes++;throw Error('Rendering must never save, choose, approve or generate');};
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{requests++;throw Error('Rendering must not request remote data');};
const render=(component,props)=>renderToStaticMarkup(createElement(component,props));
const fixture=()=>{
  const p=D.newProject('Письмо'),d=ensureDirecting(p),item=p.items.find(i=>i.stage===0);
  const original=D.addVariant(p,item.id,{kind:'text',title:'Исходный сценарий',text:'Анна читает письмо.\n\nАнна возвращается домой.',created:'2026-10-09T08:00:00Z'});
  D.approve(p,item.id);
  const revised=D.makeVariant(p,item,{kind:'text',title:'Сценарий после правки',text:'Анна замечает старую дату.\n\nАнна берёт ключ от дома.',created:'2026-10-09T09:00:00Z',model:'gpt-6-astra',versionInfo:{created:'2026-10-09T09:00:00Z',parentVariantId:original.id,sources:[],reason:'Уточнена причинность'}});
  item.variants.push(revised);
  const meaning={id:'truth',title:'Письмо меняет решение',kind:'turn',priority:'required',viewerBefore:'Анна думает, что её бросили.',viewerAfter:'Анна понимает, что её защищали.',event:'Она читает старую дату.',stakes:'Можно вернуться домой.',evidence:['Анна опускает письмо и берёт ключ.']};
  d.storyMeanings=[meaning];
  d.scenes=[{id:'scene',title:'Сцена письма',purpose:'Раскрыть правду',location:'Комната',conflict:'Месть или доверие',turn:'Вернуться домой',stateIn:'Гнев',stateOut:'Облегчение',continuity:[],meaningIds:['truth'],shots:[{
    id:'shot',title:'План письма',duration:5,cast:['Анна'],story:'Анна читает старую дату и берёт ключ.',stateIn:'Гнев',stateOut:'Облегчение',cinematography:'Крупно дата письма',productionDesign:'Письмо и ключ',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'Ключ в руке',meaningIds:['truth'],
  }]}];
  recordCreativeVersion(p,'История структуры до правки');
  d.scenes[0].purpose='Раскрыть дату и решение';
  recordCreativeVersion(p,'История структуры после правки');
  d.issues=[{id:'issue',severity:'conflict',message:'Маркер замечания редактора',section:'story',shotIds:['shot']}];
  d.runs=[{id:'camera-run',created:'2026-10-09T10:00:00Z',basis:'test',model:'gpt-6-astra',mode:'role',sceneIds:['scene'],stopped:true,tasks:[{id:'camera-task',role:'camera',requires:[],error:'Маркер ошибки оператора'}]}];
  return {p,item,original,revised};
};
const editorProps=(p,stage)=>({p,stage,busy:false,submit:onAction,open:onAction,generateScenario:onAction});
try{
  const {p}=fixture(),before=structuredClone(p);
  const brief=render(GeneralScenarioBrief,{p,busy:false,submit:onAction,generateScenario:onAction});
  const techStart=brief.indexOf('aria-label="Технические параметры фильма"');
  const creativeStart=brief.indexOf('aria-label="Жанр и режиссёрский подход"');
  assert(techStart>=0&&creativeStart>techStart,'Technical settings precede the separate creative brief');
  for(const name of ['Технические параметры фильма','Жанр и режиссёрский подход']){
    const opening=brief.match(new RegExp(`<details\\b[^>]*aria-label="${name}"[^>]*>`))?.[0];
    assert(opening,`Missing details block: ${name}`);
    assert(!/\sopen(?:=|\s|>)/.test(opening),`${name} must be collapsed by default`);
  }
  const tech=brief.slice(techStart,creativeStart),creative=brief.slice(creativeStart);
  for(const field of ['Режим хронометража','Ориентир длительности','Порядок производства','Опорные изображения'])assert(tech.includes(field),field);
  for(const field of ['Жанр','Режиссёрский подход','Какое чувство должен вызвать фильм','Способ постановки фильма','Работа камеры','Дополнительные инструкции для сценаристов'])assert(creative.includes(field),field);
  assert(!tech.includes('general-scenario-genres'),'Creative editing must not return to the technical block');
  assert(!creative.includes('Режим хронометража'),'Runtime settings must stay in the technical block');
  assert.deepEqual(p,before);

  const stage0=render(DirectingEditor,editorProps(p,0));
  assert(stage0.includes('Настройки общего сценария'));
  assert(stage0.includes('Что должен понять зритель · сохранено'));
  assert(stage0.includes('Модель выделения смыслов'));
  const meaningModel=stage0.match(/<select[^>]*aria-label="Модель выделения смыслов"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.match(meaningModel??'',/<option value="gpt-6-astra" selected="">/,'Meaning extraction defaults to GPT-6 Astra');
  for(const text of ['Сравнить версии сцен в двух окнах','Сохранённые версии задания и сцен','История структуры до правки','Проверка редактора','Маркер замечания редактора','Распределено по планам','Маркер ошибки оператора','Модель режиссёрской группы'])assert(!stage0.includes(text),`Stage 0 leaked later-stage UI: ${text}`);
  assert(!/<details\b[^>]*\sopen(?:=|\s|>)/.test(stage0),'Brief and meaning blocks start collapsed');
  assert.deepEqual(p,before,'Rendering stage 0 keeps all stored settings, history and approvals');

  for(const stage of [12,4]){
    const html=render(DirectingEditor,editorProps(p,stage));
    for(const text of ['Сравнить версии сцен в двух окнах','Сохранённые версии задания и сцен','История структуры до правки','История структуры после правки','Проверка редактора','Маркер замечания редактора','Распределено по планам','Маркер ошибки оператора'])assert(html.includes(text),`Stage ${stage} lost existing UI: ${text}`);
    assert(!html.includes('Настройки общего сценария'));
    assert.deepEqual(p,before,`Rendering stage ${stage} must not restore history or apply editor changes`);
  }

  const comparisonProps={p,busy:false,onChoose:onAction};
  const comparison=render(GeneralScriptComparison,comparisonProps);
  assert.equal((comparison.match(/<select /g)||[]).length,2);
  assert.equal((comparison.match(/<option /g)||[]).length,4);
  assert(comparison.includes('Анна читает письмо.\n\nАнна возвращается домой.'),'Full original text is the default view');
  assert(comparison.includes('Анна замечает старую дату.\n\nАнна берёт ключ от дома.'),'Full alternative text is the default view');
  assert.equal((comparison.match(/overflow-y-auto/g)||[]).length,2,'Each text has its own bounded scrolling region');
  for(const text of ['✓ Выбран для проекта','✓ Утверждён','Источник','Уточнена причинность','Модель','GPT-6 Astra','Создано'])assert(comparison.includes(text),text);
  const combined=renderToStaticMarkup(createElement(Fragment,null,createElement(GeneralScriptComparison,comparisonProps),createElement(DirectingEditor,editorProps(p,0))));
  assert(combined.indexOf('general-script-comparison')<combined.indexOf('Настройки общего сценария'));
  assert.deepEqual(p,before);

  const blank=D.newProject('Пустой фильм'),blankBefore=structuredClone(blank);
  assert(render(GeneralScriptComparison,{...comparisonProps,p:blank}).includes('Пока нет версий для сравнения'));
  assert(render(DirectingEditor,editorProps(blank,0)).includes('Что должен понять зритель · не используется'));
  assert.deepEqual(blank,blankBefore,'Opening an old project cannot create a directing state');
  const only=structuredClone(p);only.items.find(i=>i.stage===0).variants.splice(1);
  assert(render(GeneralScriptComparison,{...comparisonProps,p:only}).includes('Пока сохранён один вариант'));
  const multiple=structuredClone(p),sourceItem=multiple.items.find(i=>i.stage===0);
  multiple.items.push({...structuredClone(sourceItem),id:'alternate-card',title:'Другая карточка сценария',variants:[{...sourceItem.variants[0],title:'Вариант другой карточки',text:'Полный текст из другой карточки.'}]});
  multiple.items.push({...structuredClone(sourceItem),id:'removed-card',removedAt:'2026-10-09',variants:[{...sourceItem.variants[0],title:'Удалённый вариант'}]});
  multiple.items.push({...structuredClone(sourceItem),id:'archive-card',planArchive:{reason:'removed'},variants:[{...sourceItem.variants[0],title:'Архивный вариант'}]});
  sourceItem.variants.push({...sourceItem.variants[0],id:'image',kind:'image',title:'Изображение вместо сценария'});
  const multipleBefore=structuredClone(multiple),all=render(GeneralScriptComparison,{...comparisonProps,p:multiple});
  assert.equal((all.match(/<option /g)||[]).length,6,'Both selectors must include text variants from every active general-script card');
  assert(all.includes('Другая карточка сценария')&&all.includes('Полный текст из другой карточки.'));
  assert.equal((all.match(/✓ Выбран для проекта/g)||[]).length,2,'Each card keeps its real selection even if legacy variant IDs repeat');
  for(const hidden of ['Удалённый вариант','Архивный вариант','Изображение вместо сценария'])assert(!all.includes(hidden),hidden);
  assert.deepEqual(multiple,multipleBefore);
  multiple.configVersion++;
  const stale=render(GeneralScriptComparison,{...comparisonProps,p:multiple});
  assert(stale.includes('Утверждение требует пересмотра'));
  assert(!stale.includes('class="status-pill approved"'),'Stale approval cannot appear as currently approved');

  // Studio is large and owns live queries: check its real render order and routing without mounting providers.
  const studio=await readFile('app/studio.tsx','utf8');
  const comparisonAt=studio.indexOf('{step===0&&<GeneralScriptComparison');
  const directingAt=studio.indexOf('{[0,12,4].includes(step)&&<DirectingEditor');
  const referencesAt=studio.indexOf('{step===0&&<CinemaReferencesPanel');
  assert(comparisonAt>=0&&comparisonAt<directingAt&&directingAt<referencesAt,'Stage 0 begins with comparison, then optional brief/meanings, then cinema references');
  assert.match(studio,/\{\[1,4\]\.includes\(step\)&&<TabsContent value="compare"/,'The old compare tab remains for other stages only');
  assert.match(studio,/<ScenarioVariantArchive enabled=\{step===0\}/,'Original cards remain available in their stage-0 archive');
  assert.equal(writes,0);assert.equal(requests,0);
  console.log('PASS general scenario layout: top comparison; separate collapsed technical/creative brief; GPT-6 meanings; hidden stage-0 shot/history/editor UI; retained scene/plan tools; no rendering writes or remote requests');
}finally{globalThis.fetch=originalFetch;}
