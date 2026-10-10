import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

await mkdir('work/tests',{recursive:true});
await build({
  stdin:{resolveDir:process.cwd(),contents:`
    export {GeneralScriptComparison} from './app/general-script-comparison';
    export {GeneralScenarioBrief} from './app/general-scenario-brief';
    export {FilmSettingsFields} from './app/film-settings-fields';
    export {GeneralScenarioWorkspace} from './app/general-scenario-workspace';
    export {DirectingEditor} from './app/directing-editor';
    export * as D from './lib/domain';
    export {ensureDirecting} from './lib/directing';
    export {recordCreativeVersion} from './lib/creative-versions';
  `},
  bundle:true,platform:'node',format:'esm',outfile:'work/tests/general-scenario-layout.mjs',
  external:['react','react-dom','@ffmpeg/ffmpeg'],
  banner:{js:`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);`},
});
const {GeneralScriptComparison,GeneralScenarioBrief,FilmSettingsFields,GeneralScenarioWorkspace,DirectingEditor,D,ensureDirecting,recordCreativeVersion}=await import('../work/tests/general-scenario-layout.mjs');
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
const workspaceProps=p=>({p,busy:false,submit:onAction,directingSubmit:onAction,cinemaSubmit:onAction,onContinue:onAction,onAddSource:onAction});
try{
  const {p}=fixture(),before=structuredClone(p);
  const brief=render(GeneralScenarioBrief,{p,busy:false,submit:onAction,generateScenario:onAction});
  const creativeStart=brief.indexOf('aria-label="Жанр и режиссёрский подход"');
  assert(creativeStart>=0&&!brief.includes('Технические параметры фильма'),'Technical parameters live only in the film settings dialog');
  for(const name of ['Жанр и режиссёрский подход']){
    const opening=brief.match(new RegExp(`<details\\b[^>]*aria-label="${name}"[^>]*>`))?.[0];
    assert(opening,`Missing details block: ${name}`);
    assert(!/\sopen(?:=|\s|>)/.test(opening),`${name} must be collapsed by default`);
  }
  const tech=render(FilmSettingsFields,{p}),creative=brief.slice(creativeStart);
  for(const field of ['Режим хронометража','Ориентир длительности','Порядок производства','Опорные изображения'])assert(tech.includes(field),field);
  assert.match(tech,/<option value="free" selected="">/,'Free duration is the default');
  assert(tech.includes('По текущим планам')&&tech.includes('5 сек.'),'Computed duration is shown separately from target');
  assert(tech.includes('Изменение формата потребует пересмотра'));
  for(const field of ['Жанр','Режиссёрский подход','Какое чувство должен вызвать фильм','Способ постановки фильма','Работа камеры','Дополнительные инструкции для сценаристов'])assert(creative.includes(field),field);
  assert(!tech.includes('general-scenario-genres'),'Creative editing must not return to the technical block');
  assert(!creative.includes('Режим хронометража'),'Runtime settings must stay in the technical block');
  assert.deepEqual(p,before);

  const stage0=render(GeneralScenarioWorkspace,workspaceProps(p));
  assert(stage0.includes('Настройки общего сценария'));
  assert(stage0.includes('Что должен понять зритель'));
  assert(stage0.includes('Карта используется при разработке сцен и планов'));
  assert(!stage0.includes('Модель сценариста и драматурга'));assert(tech.includes('Модель сценариста и драматурга'));
  assert.match(tech,/<option value="gpt-6-astra" selected="">/,'Script preparation defaults to GPT-6 Astra');
  assert.equal((stage0.match(/role="switch"/g)||[]).length,3,'Creative, meaning and cinema preparation are optional; technical parameters stay manual');
  assert.equal((stage0.match(/aria-expanded="false"/g)||[]).length,3,'Optional sections begin collapsed');
  assert.equal((stage0.match(/aria-label="Сравнение общего сценария"/g)||[]).length,1,'There is one comparison workspace');
  assert.equal((stage0.match(/<section[^>]*aria-label="Что должен понять зритель"/g)||[]).length,1,'Meaning editor has one frame');
  const comparisonAt=stage0.indexOf('id="general-script-comparison"'),creativeAt=stage0.indexOf('aria-label="Жанр, режиссёрский подход и выразительность"'),meaningAt=stage0.indexOf('aria-label="Что должен понять зритель"'),cinemaAt=stage0.indexOf('aria-label="Кинореференсы: учиться у мастеров"');
  assert(comparisonAt>=0&&comparisonAt<creativeAt&&creativeAt<meaningAt&&meaningAt<cinemaAt,'Comparison is followed by creative, meaning and cinema controls');
  for(const removed of ['Творческое задание · технические параметры','Режим хронометража','Ориентир длительности','Порядок производства','Опорные изображения'])assert(!stage0.includes(removed),`Technical field leaked into screenplay workspace: ${removed}`);
  assert(!stage0.includes('Сгенерировать ещё вариант'));assert(stage0.includes('Для нового прохода нажмите'));
  assert(!stage0.includes('Исходник для нового сценария'),'The fixed left pane is the only generation source');
  assert(!stage0.includes('Карточки вариантов'),'Legacy variant cards are removed from screenplay workspace');
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
  assert.equal((comparison.match(/<select /g)||[]).length,1);
  assert.equal((comparison.match(/<option /g)||[]).length,2);
  assert(comparison.includes('Анна читает письмо.\n\nАнна возвращается домой.'),'Full original text is the default view');
  assert(comparison.includes('Анна замечает старую дату.\n\nАнна берёт ключ от дома.'),'Full alternative text is the default view');
  assert.equal((comparison.match(/overflow-y-auto/g)||[]).length,2,'Each text has its own bounded scrolling region');
  for(const text of ['Утверждённый вариант','Альтернативный вариант','Источник','Уточнена причинность','Модель','GPT-6 Astra','Создано'])assert(comparison.includes(text),text);
  assert(stage0.indexOf('general-script-comparison')<stage0.indexOf('Настройки общего сценария'));
  assert.deepEqual(p,before);

  const blank=D.newProject('Пустой фильм'),blankBefore=structuredClone(blank);
  assert(render(GeneralScriptComparison,{...comparisonProps,p:blank}).includes('Пока нет версий для сравнения'));
  const blankWorkspace=render(GeneralScenarioWorkspace,workspaceProps(blank));
  assert(blankWorkspace.includes('Сохранить исходный вариант'));assert(!blankWorkspace.includes('Добавить исходный текст'));
  assert(blankWorkspace.includes('Не используется'));
  assert.match(blankWorkspace,/<button[^>]*disabled=""[^>]*>Сгенерировать этап с ИИ<\/button>/,'Empty project cannot launch a request before source text');
  assert.deepEqual(blank,blankBefore,'Opening an old project cannot create a directing state');
  const blankSettings=render(FilmSettingsFields,{p:blank});
  assert(blankSettings.includes('После разработки планов'));
  assert.deepEqual(blank,blankBefore,'Opening settings does not initialize directing or save defaults');
  const only=structuredClone(p);only.items.find(i=>i.stage===0).variants.splice(1);
  assert(render(GeneralScriptComparison,{...comparisonProps,p:only}).includes('Пока сохранён один вариант'));
  const multiple=structuredClone(p),sourceItem=multiple.items.find(i=>i.stage===0);
  multiple.items.push({...structuredClone(sourceItem),id:'alternate-card',title:'Другая карточка сценария',variants:[{...sourceItem.variants[0],title:'Вариант другой карточки',text:'Полный текст из другой карточки.'}]});
  multiple.items.push({...structuredClone(sourceItem),id:'removed-card',removedAt:'2026-10-09',variants:[{...sourceItem.variants[0],title:'Удалённый вариант'}]});
  multiple.items.push({...structuredClone(sourceItem),id:'archive-card',planArchive:{reason:'removed'},variants:[{...sourceItem.variants[0],title:'Архивный вариант'}]});
  sourceItem.variants.push({...sourceItem.variants[0],id:'image',kind:'image',title:'Изображение вместо сценария'});
  const multipleBefore=structuredClone(multiple),all=render(GeneralScriptComparison,{...comparisonProps,p:multiple,focusVariantId:JSON.stringify(['alternate-card',sourceItem.variants[0].id])});
  assert.equal((all.match(/<option /g)||[]).length,3,'Alternative selector includes every saved candidate');
  assert(all.includes('Другая карточка сценария')&&all.includes('Полный текст из другой карточки.'));
  assert(!all.includes('Выбран для проекта'),'No redundant selection buttons');
  for(const hidden of ['Удалённый вариант','Архивный вариант','Изображение вместо сценария'])assert(!all.includes(hidden),hidden);
  assert.deepEqual(multiple,multipleBefore);
  multiple.configVersion++;
  const stale=render(GeneralScriptComparison,{...comparisonProps,p:multiple});
  assert(stale.includes('Утверждение требует пересмотра'));
  assert(!stale.includes('class="status-pill approved"'),'Stale approval cannot appear as currently approved');

  // Studio is large and owns live queries: check its real render order and routing without mounting providers.
  const studio=await readFile('app/studio.tsx','utf8');
  assert(studio.includes('{step===0&&<GeneralScenarioWorkspace'),'Studio uses the unified screenplay workspace');
  assert(studio.includes('<FilmSettingsFields p={p} busy={busy}/>'),'Settings dialog contains all technical parameters');
  assert(studio.includes('{[12,4].includes(step)&&<DirectingEditor'),'Later scene and shot editors remain separate');
  assert(!studio.includes('{step===0&&<CinemaReferencesPanel'),'No second screenplay cinema panel');
  assert.match(studio,/\{\[1,4\]\.includes\(step\)&&<TabsContent value="compare"/,'The old compare tab remains for other stages only');
  assert.match(studio,/const showCards\s*=.*(?:step\s*!==\s*0|!\[[^\]]*0)/,'Legacy cards are excluded from stage 0');
  assert.equal(writes,0);assert.equal(requests,0);
  console.log('PASS general scenario layout: sole top comparison, three collapsed AI options, independent source, one generation button, no stage-0 legacy/history/editor UI, later scene tools retained, zero render writes');
}finally{globalThis.fetch=originalFetch;}
