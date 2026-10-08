import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export {runCinemaResearchStep} from './lib/cinema-references-runner';export * as D from './lib/domain';export {ensureDirecting} from './lib/directing';export * as C from './lib/cinema-references';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/cinema-references-runner.mjs',plugins:[{name:'owned-server-fixture',setup(build){build.onResolve({filter:/^(\.\/server|@\/lib\/server)$/},()=>({path:'server',namespace:'test-server'}));build.onLoad({filter:/.*/,namespace:'test-server'},()=>({contents:`export const runtime={FILES:{async get(key){const v=globalThis.__cinemaServer.receipts.get(key);return v?{arrayBuffer:async()=>new TextEncoder().encode(v).buffer}:null},async put(key,text){globalThis.__cinemaServer.receipts.set(key,text)}}};export async function getKey(){return 'test-key'};export async function loadProject(){return structuredClone(globalThis.__cinemaServer.project)};export async function mutate(user,id,fn){const s=globalThis.__cinemaServer;let p=structuredClone(s.project);fn(p);if(s.claimRace){s.claimRace=false;s.project.jobs[0].status='dispatching';p=structuredClone(s.project);fn(p)}s.project=p;p.revision++;return structuredClone(p)}` }));}}]});
const {D,C,ensureDirecting,runCinemaResearchStep}=await import('../work/tests/cinema-references-runner.mjs');
const make=()=>{const p=D.newProject('Тест'),item=p.items[0],source=D.addVariant(p,item.id,{kind:'text',title:'Автор',text:'Герой входит в дом.'});D.approve(p,item.id);ensureDirecting(p);const run=C.createCinemaReferenceRun(p,{scope:{kind:'script',variantId:source.id},mode:'propose',model:'gpt-6-astra',question:''});return {p,run};};
const card={id:'r1',title:'Приём',film:{title:'Референс',year:null,director:null,screenwriter:null},sourceScene:'Наблюдение из источника',technique:'Раскрытие раньше героя',effect:'Ожидание',adaptation:'Показать движение тени',screenEvidence:['Тень за героем'],changes:[],additionalShots:0,additionalLocations:[],limitations:[],sources:[{title:'Источник',url:'https://afi.com/example',support:'Описание сцены'}]};
const response=()=>({id:'paid-receipt',status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://afi.com/example'}]}},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({summary:'Найдено',candidates:[card],limitations:[]})}]}],usage:{input_tokens:100,output_tokens:100}});
const originalFetch=globalThis.fetch;let calls=0;
try{
  let{p,run}=make();globalThis.__cinemaServer={project:p,receipts:new Map(),claimRace:true};globalThis.fetch=async()=>{calls++;return Response.json(response());};
  await runCinemaResearchStep('owner',p.id,run.jobId);assert.equal(calls,0,'Lost CAS claim must not submit another paid request');assert.equal(globalThis.__cinemaServer.project.jobs[0].status,'dispatching');
  console.log('PASS cinema runner: CAS conflict resets claim, no duplicate paid POST');
  ({p,run}=make());globalThis.__cinemaServer={project:p,receipts:new Map()};let outside=0;
  const completed=await runCinemaResearchStep('owner',p.id,run.jobId,{outside:async fn=>{outside++;return fn()},withState:async fn=>fn()});
  assert.equal(calls,1);assert.equal(outside,1);assert.equal(completed.jobs[0].status,'done');assert.equal(completed.jobs[0].actual,null);assert.equal(completed.cinemaReferences.runs[0].result.candidates[0].sources[0].verification,'tool-source');assert.equal(globalThis.__cinemaServer.receipts.size,1);assert.equal(completed.items[0].variants.length,1);
  console.log('PASS cinema runner: one paid call, unlocked wait, durable receipt and source-backed draft only');
  globalThis.__cinemaServer.project.jobs[0].status='unknown';delete globalThis.__cinemaServer.project.cinemaReferences.runs[0].result;
  const recovered=await runCinemaResearchStep('owner',p.id,run.jobId);assert.equal(calls,1);assert.equal(recovered.jobs[0].status,'done');assert(recovered.cinemaReferences.runs[0].result);
  console.log('PASS cinema runner: private saved receipt recovers without another request');
  ({p,run}=make());globalThis.__cinemaServer={project:p,receipts:new Map()};globalThis.fetch=async()=>{calls++;throw Error('network lost')};
  const unknown=await runCinemaResearchStep('owner',p.id,run.jobId);assert.equal(unknown.jobs[0].status,'unknown');const total=calls;await runCinemaResearchStep('owner',p.id,run.jobId);assert.equal(calls,total);
  console.log('PASS cinema runner: ambiguous transport is never automatically repeated');
  ({p,run}=make());p.directing.brief.genre='Другой жанр';globalThis.__cinemaServer={project:p,receipts:new Map()};const before=calls;
  const stale=await runCinemaResearchStep('owner',p.id,run.jobId);assert.equal(stale.jobs[0].status,'cancelled');assert.equal(stale.jobs[0].actual,'0');assert.equal(calls,before);
  console.log('PASS cinema runner: changed input cancels queued research before payment');
}finally{globalThis.fetch=originalFetch;delete globalThis.__cinemaServer;}
