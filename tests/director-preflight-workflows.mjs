import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const server=`export const loadProject=async()=>structuredClone(globalThis.state);export const imageData=async()=>{throw Error('No images expected')};export const getKey=async()=>'fake';export async function mutate(u,id,fn){const p=structuredClone(globalThis.state);fn(p);p.revision++;globalThis.state=p;return structuredClone(p);}`;
const provider=`export async function generate(job){globalThis.calls++;return {text:JSON.stringify(globalThis.reply(job)),requestId:'local-test',actual:'0'};}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/script-workflow';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/director-preflight-workflows.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'mock',setup(b){b.onResolve({filter:/^\.\/(server|providers)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='./server'?server:provider}));}}]});
const {D,R,S,runDirectorStep}=await import('../work/tests/director-preflight-workflows.mjs');
globalThis.fetch=()=>{throw Error('Network prohibited')};globalThis.calls=0;
const fixture=()=>{const p=D.newProject('Локальная проверка'),d=R.ensureDirecting(p),item=p.items.find(i=>i.stage===0),v=D.addVariant(p,item.id,{text:'Герой замечает перемену и действует.'});D.approve(p,item.id);return {p,d,v};};
{
  const {p,v}=fixture();S.createScriptWorkflowRun(p,'MiniMax-M2.7',['script-critic','script-dramaturg','script-control'],v.id);globalThis.state=p;
  globalThis.reply=job=>job.versionInfo.settings.role==='script-dramaturg'?{title:'Доработка',text:'Герой замечает перемену, тревожится и решает действовать.',changes:['Уточнена реакция'],findings:[],emotionalArcs:[]}:{title:'Проверка',findings:[]};
  for(let n=0;n<3;n++)await runDirectorStep('owner',p.id);
  assert.equal(calls,3);assert(state.directing.runs[0].tasks.every(t=>t.applied));assert(state.jobs.every(j=>j.status==='done'));
  const before=structuredClone(state);await runDirectorStep('owner',p.id);assert.deepEqual(state,before);
}
{
  const {p,d}=fixture();R.newDirectorRun(p,'MiniMax-M2.7','scenes');globalThis.state=p;
  const shot={id:D.id(),title:'Перемена',duration:6,cast:['Герой'],story:'Замечает погасший индикатор.',stateIn:'Уверенность',stateOut:'Тревога',cinematography:'Крупный',productionDesign:'Мастерская',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:''};
  const scene={id:D.id(),title:'Испытание',purpose:'Увидеть результат',location:'Мастерская',conflict:'Ожидание против результата',turn:'Уверенность сменяется тревогой',stateIn:'Готовится',stateOut:'Решает действовать',continuity:[],shots:[]};
  globalThis.reply=()=>({scenes:[scene]});await runDirectorStep('owner',p.id);assert(state.directing.runs[0].tasks[0].applied);
  state.directing.scenes[0].shots=[shot];state.directing.scenesApproved=R.scenesBasis(state);
  state.items=state.items.filter(i=>![1,2,3].includes(i.stage));
  const run=R.newDirectorRun(state,'MiniMax-M2.7','develop');
  globalThis.reply=job=>{
    const role=job.versionInfo.settings.role;
    if(role==='story')return {shots:[shot]};
    if(role==='camera')return {shots:[{id:shot.id,cinematography:'Медленный наезд к реакции',direction:{cameraMovement:{type:'push-in',description:'К лицу'},framingStart:'medium',framingEnd:'close-up'}}]};
    if(role==='art')return {shots:[{id:shot.id,productionDesign:'Мастерская, мягкий свет'}]};
    if(role==='dialogue')return {shots:[{id:shot.id,dialogue:shot.dialogue}]};
    if(role==='performance')return {shots:[{id:shot.id,performance:[{character:'Герой',objective:'Проверить прибор',subtext:'Успех под угрозой',visibleAction:'Улыбка исчезает, взгляд задерживается. Рот закрыт.',emotionStart:'Уверенность',emotionEnd:'Тревога'}]}]};
    return {issues:[],patches:[]};
  };
  for(let n=0;n<8&&state.directing.runs.find(r=>r.id===run.id).tasks.some(t=>!t.applied);n++)await runDirectorStep('owner',p.id);
  assert(state.directing.runs.find(r=>r.id===run.id).tasks.every(t=>t.applied),'Complete story/specialist/reviewer/editor DAG dispatches through preflight');
}
// Private production snapshots are optional local evidence, never committed.
for(const name of ['a','b']){
  const path=`../work/emotion-films/film-${name}-current.json`;if(!existsSync(path))continue;
  globalThis.state=JSON.parse(readFileSync(path,'utf8'));const p=state,ready=p.directing.runs.filter(r=>!r.stopped).flatMap(r=>r.tasks.filter(t=>R.taskReady(r,t)).map(t=>({run:r.id,task:t.id})));if(!ready.length)continue;
  const previousCalls=calls,previousJobs=p.jobs.length;globalThis.reply=()=>({title:'Локальная проверка',findings:[]});
  await runDirectorStep('owner',p.id);
  assert(calls>previousCalls,`Film ${name}: saved ready workflow reaches mocked provider`);
  assert(state.jobs.length>previousJobs,`Film ${name}: one saved claim is created in memory`);
  assert(!state.directing.runs.flatMap(r=>r.tasks).some(t=>t.error?.includes('не принадлежит этой цепочке')));
  console.log(`PASS private film ${name}: ready workflow admission tested in memory; source JSON unchanged.`);
}
console.log('PASS real script-workflow critic/dramaturg/control, scenes and complete development DAG preserve task ownership in no-op preflight. No network or paid calls.');
