import {build} from 'esbuild';
import A from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as UI from './app/cinema-references-panel';export * as D from './lib/domain';export * as R from './lib/directing';export * as C from './lib/cinema-references';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/cinema-references-ui.mjs',external:['react','react-dom','@ffmpeg/ffmpeg'],banner:{js:`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);`}});
const {UI,D,R,C}=await import('../work/tests/cinema-references-ui.mjs');
const fetchBefore=globalThis.fetch;
globalThis.fetch=()=>{throw Error('Rendering cannot send research or paid requests')};
try{
  const p=D.newProject('Космическая станция');p.limit=null;R.ensureDirecting(p);
  const script=p.items.find(i=>i.stage===0);D.addVariant(p,script.id,{text:'Вера обнаруживает неизвестный корабль у станции.'});D.approve(p,script.id);
  const render=()=>renderToStaticMarkup(React.createElement(UI.CinemaReferencesPanel,{p,stage:0,busy:false,submit:()=>{throw Error('Rendering cannot mutate a project')}}));
  let html=render();A.match(html,/Найти и предложить/);A.match(html,/Найти и применить в новом варианте/);A.match(html,/Новый вариант · утверждён/);
  const run=C.createCinemaReferenceRun(p,{scope:{kind:'script',variantId:script.approvedId},mode:'propose',model:'gpt-6-astra',question:'Первый контакт'});
  p.jobs.find(j=>j.id===run.jobId).status='done';
  const candidate={id:'arrival',title:'Отложенное раскрытие',film:{title:'Пример для теста',year:null,director:null,screenwriter:null},sourceScene:'Наблюдаемая деталь предшествует общему виду.',technique:'Дозированное раскрытие',effect:'Любопытство',adaptation:'На иллюминаторе меняется отражение; затем Вера видит корабль.',screenEvidence:['В отражении появляется силуэт.'],changes:['Изменить точку раскрытия.'],additionalShots:1,additionalLocations:[],limitations:[],sources:[{title:'Источник из поиска',url:'https://example.org/film',support:'Описание последовательности.',verification:'tool-source'}]};
  run.result={summary:'Предложен приём.',candidates:[candidate,{...candidate,id:'uncertain',title:'Неподтверждённая идея',sources:[{title:'Непроверенная страница',url:'javascript:alert(1)',support:'Нет доказательства.',verification:'unverified'}]}],limitations:[]};
  html=render();A.match(html,/href="https:\/\/example.org\/film"/);A(!html.includes('href="javascript:'));A.match(html,/источник не подтверждён поиском/);A.match(html,/Режиссёр: не установлен/);A.match(html,/Наша адаптация/);A.match(html,/Дополнительные планы: 1/);
  const unverified=html.slice(html.indexOf('Неподтверждённая идея')-130,html.indexOf('Неподтверждённая идея'));A.match(unverified,/disabled/,'Unverified references cannot be selected for application');
  run.mode='apply';run.result.draft={title:'Встреча через отражение',text:'Вера замечает отражение корабля в стекле.',candidateIds:['arrival'],changes:[]};
  html=render();A.match(html,/Левый вариант/);A.match(html,/Правый вариант/);A.match(html,/Добавить как вариант сценария/);A.equal(script.approvedId,script.selectedId,'Preview does not change approvals');
  p.directing.brief.genre='Хоррор';html=render();A.match(html,/Исходный материал изменился/);A.match(html,/<button[^>]*disabled=""[^>]*>Добавить как вариант сценария/);
  p.limit='10000000000';html=render();A.match(html,/жёсткий лимит бюджета/);A.match(html,/<button[^>]*disabled=""[^>]*>Найти и предложить/);
  A.deepEqual(run.scope,{kind:'script',variantId:script.approvedId});
  console.log('PASS cinema UI: two modes, source labels, safe links, before/after, stale and budget guards, render has no requests/mutations');
}finally{globalThis.fetch=fetchBefore;}
