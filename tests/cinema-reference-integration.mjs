import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/script-workflow';export * as C from './lib/cinema-references';export * as G from './lib/scenario-generation';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/cinema-reference-integration.mjs'});
const {D,R,S,C,G}=await import('../work/tests/cinema-reference-integration.mjs');
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('No provider request is needed for adoption/preflight tests.');};
const fixture=()=>{
  const p=D.newProject('Ночной заход'),d=R.ensureDirecting(p);
  for(const stage of [0,2,3,1]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:stage===0?'Лётчица теряет ориентир и ищет безопасный заход.':'Основа '+stage});D.approve(p,item.id);}
  const item=p.items.find(i=>i.stage===0),source=item.variants.find(v=>v.id===item.approvedId);
  const shot=(id)=>({id,title:'План '+id,duration:5,cast:['Лётчица'],story:'Лётчица замечает погасшие огни.',stateIn:'Огни горят',stateOut:'Огни погасли',cinematography:'Крупный план',productionDesign:'Синяя кабина',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:''});
  const scene=(id,ids)=>({id,title:'Сцена '+id,purpose:'Обнаружение опасности',location:'Кабина',conflict:'Потеря ориентира',turn:'Новый заход',stateIn:'Уверенность',stateOut:'Осторожность',continuity:[],shots:ids.map(shot)});
  d.scenes=[scene('scene-a',['shot-a','shot-b']),scene('scene-b',['shot-c'])];d.scenesApproved=R.scenesBasis(p);
  return {p,d,item,source};
};
const adopt=(p,scope,adaptation)=>{
  const run=C.createCinemaReferenceRun(p,{scope,mode:'propose',model:'gpt-6-astra',question:'Ясное предзнаменование'});
  run.result={summary:'Найден приём',candidates:[{id:'reference',title:'Читаемое изменение',film:{title:'REFERENCE_FILM_DO_NOT_RENDER',year:null,director:'DIRECTOR_DO_NOT_RENDER',screenwriter:null},sourceScene:'SOURCE_SCENE_DO_NOT_RENDER',technique:'Зритель замечает угрозу раньше героя.',effect:'Подготовить понятную тревогу.',adaptation,screenEvidence:['Погасшие огни видны раньше реакции.'],changes:[],additionalShots:0,additionalLocations:[],limitations:[],sources:[{url:'https://www.bfi.org.uk/REFERENCE_URL_DO_NOT_RENDER',title:'Архив',support:'Архив описывает последовательность.',verification:'tool-source'}]}],limitations:[]};
  p.jobs.find(j=>j.id===run.jobId).status='done';C.selectCinemaReferences(p,run.id,['reference']);return run;
};
const scriptContext=(p,run,task=run.tasks[0])=>JSON.parse(S.scriptWorkflowPrompt(p,run,task).split('Задание и замороженный контекст:\n').at(-1));
const directorContext=(p,run,task)=>JSON.parse(R.directorPrompt(p,run,task).split('\nДанные:\n').at(-1));
try{
  {
    const {p,item,source}=fixture(),before={selected:item.selectedId,approved:item.approvedId,text:source.text};
    const research=adopt(p,{kind:'script',variantId:source.id},'GLOBAL_ADAPTATION: сначала свет полосы, затем исчезновение ориентира.');
    const run=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-critic','script-dramaturg','script-control'],source.id);
    assert.equal(run.scriptInput.cinemaReferences.length,1);assert.equal(item.selectedId,before.selected);assert.equal(item.approvedId,before.approved);assert.equal(source.text,before.text);
    const frozen=JSON.stringify(run.scriptInput),prompt=S.scriptWorkflowPrompt(p,run,run.tasks[0]);
    for(const marker of ['REFERENCE_FILM_DO_NOT_RENDER','DIRECTOR_DO_NOT_RENDER','REFERENCE_URL_DO_NOT_RENDER','SOURCE_SCENE_DO_NOT_RENDER'])assert(!prompt.includes(marker));
    assert(prompt.includes('Упоминание названия приёма само по себе не доказательство'));
    C.selectCinemaReferences(p,research.id,[]);research.result.candidates[0].adaptation='LATER_RESEARCH_CHANGE';
    assert.equal(JSON.stringify(run.scriptInput),frozen);assert.equal(S.scriptWorkflowPrompt(p,run,run.tasks[0]),prompt);
    S.applyScriptWorkflowResult(p,run,run.tasks[0],{title:'Критика',findings:[]});
    assert(scriptContext(p,run,run.tasks[1]).cinemaReferences[0].adaptation.includes('GLOBAL_ADAPTATION'));
    S.applyScriptWorkflowResult(p,run,run.tasks[1],{title:'Переработка',text:'Лётчица видит исчезновение света и меняет заход.',changes:[],findings:[]});
    S.applyScriptWorkflowResult(p,run,run.tasks[2],{title:'Проверка',findings:[]});
    const variant=S.importScriptWorkflowCandidate(p,run.id,run.tasks[2].id);
    assert.deepEqual(variant.versionInfo.settings.cinemaReferences,run.scriptInput.cinemaReferences);
    assert.deepEqual(C.cinemaReferenceInstructions(p,{scope:'script',sourceVariantId:variant.id}),run.scriptInput.cinemaReferences,'An imported scenario carries its adopted approach to later scene development.');
    assert.equal(item.approvedId,before.approved);assert.equal(item.selectedId,before.selected);
    const branch=S.createScriptWorkflowRun(p,'gpt-6-astra',['script-producer'],source.id,run.tasks[2].id);
    assert.deepEqual(branch.scriptInput.cinemaReferences,run.scriptInput.cinemaReferences);
  }
  {
    const {p,d,item,source}=fixture();
    adopt(p,{kind:'script',variantId:source.id},'GLOBAL_ADAPTATION');
    adopt(p,{kind:'scene',sceneId:'scene-a'},'SCENE_A_ADAPTATION');
    adopt(p,{kind:'shot',sceneId:'scene-a',shotId:'shot-a'},'SHOT_A_ADAPTATION');
    adopt(p,{kind:'shot',sceneId:'scene-a',shotId:'shot-b'},'SHOT_B_ADAPTATION');
    adopt(p,{kind:'scene',sceneId:'scene-b'},'OTHER_SCENE_ADAPTATION');
    const currentBasis=R.directorApprovalBasis(p),run=R.newDirectorRun(p,'gpt-6-astra','editor');
    assert(run.cinemaReferences.length>=5);assert.equal(R.directorApprovalBasis(p),currentBasis,'Research adoption does not change material approval basis.');
    const task={id:D.id(),role:'camera',sceneId:'scene-a',shotId:'shot-a',requires:[]};
    const context=directorContext(p,run,task),text=JSON.stringify(context.cinemaReferences);
    for(const expected of ['GLOBAL_ADAPTATION','SCENE_A_ADAPTATION','SHOT_A_ADAPTATION'])assert(text.includes(expected));
    for(const forbidden of ['SHOT_B_ADAPTATION','OTHER_SCENE_ADAPTATION','REFERENCE_FILM_DO_NOT_RENDER','REFERENCE_URL_DO_NOT_RENDER'])assert(!text.includes(forbidden));
    const compressed=directorContext(p,run,{...task,role:'compress'}),mediaResearch=JSON.stringify(compressed.cinemaReferences);
    assert(mediaResearch.includes('SHOT_A_ADAPTATION'));assert(!mediaResearch.includes('GLOBAL_ADAPTATION'));assert(!mediaResearch.includes('SCENE_A_ADAPTATION'));
    const frozen=structuredClone(context.cinemaReferences);p.cinemaReferences.selections=[];
    assert.deepEqual(directorContext(p,run,task).cinemaReferences,frozen,'Changing choices after dispatch cannot change the team input.');
    assert.equal(item.approvedId,source.id);assert.equal(d.scenes[0].shots[0].story,'Лётчица замечает погасшие огни.');
    assert(R.directorPrompt(p,run,run.tasks[0]).includes('что увидит зритель'));
  }
  {
    const {p,item,source}=fixture();adopt(p,{kind:'script',variantId:source.id},'ONLY_CHOSEN_SOURCE');
    assert(G.scenarioCinemaReferenceInstruction(p,source.id).includes('ONLY_CHOSEN_SOURCE'));
    const second=D.addVariant(p,item.id,{kind:'text',text:'Другая история.'});
    assert.equal(G.scenarioCinemaReferenceInstruction(p,second.id),'','Research from a different base script never leaks.');
    assert(!G.scenarioGenerationInstruction(p).includes('ONLY_CHOSEN_SOURCE'),'Editable UI defaults never keep a stale research snapshot.');
    assert(D.promptFor(p,item,'Адаптируй.',source).includes('ONLY_CHOSEN_SOURCE'),'Actual stage-one prompt compiler includes current source selection.');
    assert(!D.promptFor(p,item,'Адаптируй.',second).includes('ONLY_CHOSEN_SOURCE'));
  }
  console.log('PASS cinema references: chosen script provenance, immutable specialist inputs and imported variants, source/scene/shot isolation, no research bibliography in downstream contexts, meaningful critic/editor checks, unchanged approvals and stage-one compilation. No paid API calls.');
}finally{globalThis.fetch=originalFetch;}
