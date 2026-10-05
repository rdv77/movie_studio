import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
await mkdir('work/tests',{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as C from './lib/prompt-compiler';export * as T from './lib/prompt-text';export * as L from './lib/prompt-limits';export * as S from './lib/storyboard';export * as V from './lib/video';export * as SH from './lib/shots';export * as B from './lib/character-bindings';export * as P from './lib/plan-references';export {POST} from './app/api/projects/[id]/directing/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/prompt-preparation-limits.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'no-paid-preparation',setup(b){
  b.onResolve({filter:/^(?:@\/lib|\.)\/(server|providers)$/},a=>({path:a.path.endsWith('server')?'server':'providers',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='providers'?`export async function generate(){throw Error('Paid calls forbidden')}`:`export const api=f=>async(r,c)=>{try{return await f(r,c)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.preparationState);export async function saveProject(u,p,revision){if(revision!==globalThis.preparationState.revision)throw Error('Stale revision');p.revision++;globalThis.preparationState=structuredClone(p);return p};export async function mutate(){throw Error('No queue dispatch allowed')};export async function getKey(){throw Error('No provider keys required')};export async function imageData(){throw Error('No images required')};`}));
}}]});
const {D,R,C,T,L,S,V,SH,B,P,POST}=await import('../work/tests/prompt-preparation-limits.mjs');
let calls=0;const originalFetch=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('No paid API requests permitted')};
try{
  assert.equal(L.PREPARED_PROMPT_LIMIT,32000);assert.equal(L.PROMPT_EDITOR_RESPONSE_LIMIT,12000);
  assert.equal(T.uniquePromptFacts(['Синий плащ. Письмо справа.','Синий плащ. Письмо слева.']), 'Синий плащ. Письмо справа.\n\nПисьмо слева.');
  const p=D.newProject('Preparation capacity');p.limit=null;
  for(const stage of [0,2,3,1]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:'Approved foundation'});D.approve(p,item.id);}
  const shot={id:D.id(),title:'Письмо',duration:5,cast:['Анна'],story:'Анна кладёт письмо на стол.',stateIn:'Письмо справа.',stateOut:'Письмо на столе.',cinematography:'Средний план.',productionDesign:'Медовый свет.',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'Письмо остаётся на столе.'};
  const scene={id:D.id(),title:'Комната',purpose:'Выбор',location:'Комната',conflict:'Сомнение',turn:'Решение',stateIn:'Входит',stateOut:'Решила',continuity:[{character:'Анна',outfit:'Синий плащ.',props:'Письмо в правой руке.'}],shots:[shot]};
  const d=R.ensureDirecting(p);d.scenes=[scene];d.scenesApproved=R.scenesBasis(p);shot.approved=R.shotApproval(scene,shot);shot.approvedFoundation=R.directorBasis(p);d.editorBasis=R.editorBasis(p);
  const run=R.newDirectorRun(p,'gpt-6-astra','compress');
  const detailed=Array.from({length:90},(_,n)=>`Деталь ${n}: мягкое освещение и точное положение предмета.`).join('\n\n');
  assert(detailed.length>3500);
  R.applyDirectorResult(p,run,run.tasks[0],{shots:[{id:shot.id,imagePrompt:detailed,videoPrompt:detailed}]});
  assert(shot.imagePrompt.length>5000);assert(shot.imagePrompt.length<=32000);assert(R.shotApproved(scene,shot));
  assert(shot.imagePrompt.includes('Синий плащ'));assert(shot.videoPrompt.includes('Письмо в правой руке'));
  const actualPrompt=R.directorPrompt(p,run,run.tasks[0]);assert(actualPrompt.includes('12000'));assert(!actualPrompt.includes('currentScenario'));assert(!actualPrompt.includes('Каждый промпт до 3000'));
  R.publishDirectorScript(p);const parsed=SH.parseShots(p.items.find(i=>i.stage===4).variants.at(-1).text,p.seconds);assert.equal(parsed[0].imagePrompt,shot.imagePrompt);
  const frame=p.items.find(i=>i.stage===5&&!i.planArchive),video=p.items.find(i=>i.stage===7&&!i.planArchive);
  const compiled=C.compilePrompt(p,frame,'gpt-image-2.5-flare',{kind:'image',prompt:S.storyboardPrompt(p,frame),references:[]});
  assert.equal(compiled.budget.limit,32000);assert(compiled.compression.omitted.some(s=>s.key==='prepared-context'&&s.reason==='duplicate'));assert(compiled.prompt.includes('Синий плащ'));assert.equal(compiled.prompt.split('Деталь 89:').length,2);
  const series=C.compilePrompt(p,frame,'gpt-image-2.5-flare',{kind:'image',prompt:S.storyboardPrompt(p,frame)+'\n\nСоздай самостоятельный вариант 2 из 3, сохраняя обязательные признаки текущего плана.',references:[]});assert(series.prompt.includes('вариант 2 из 3'));
  const manual='Анна хлопает. Анна хлопает.';const manualCompiled=C.compilePrompt(p,frame,'gpt-image-2.5-flare',{kind:'image',prompt:manual,references:[]});assert(manualCompiled.criticalText.includes(manual),'Repeated manual action must not be deduplicated');
  const history=C.compilePrompt(p,frame,'gpt-image-2.5-flare',{kind:'image',prompt:'Начальный кадр',references:[],plan:{id:shot.id,title:shot.title,cast:shot.cast,stateIn:shot.stateIn,sceneContinuity:scene.continuity,previousChanges:[{id:'a',changes:'Анна взяла письмо.'},{id:'b',changes:'Анна передала письмо.'},{id:'c',changes:'Анна взяла письмо.'}]}});
  assert.equal(history.criticalText.split('Анна взяла письмо.').length,3,'Identical changes separated by another transition remain in order');
  for(const [model,length,providerPromptLimit] of [['gpt-image-2.5-flare',33000,undefined],['zencreator:image:QWEN_IMAGE',5100,undefined],['gpt-image-2.5-flare',1100,1000]]) {
    const long=C.compilePrompt(p,frame,model,{kind:'image',prompt:'X'.repeat(length),providerPromptLimit,allowLegacyModel:true,references:[]});
    assert(long.budget.needsOptimization);assert(long.prompt.includes('X'.repeat(length)),'Raw brief is kept for conditional LLM optimization');
  }
  const snapshot=structuredClone(p),tooLarge=R.newDirectorRun(snapshot,'gpt-6-astra','compress');assert.throws(()=>R.applyDirectorResult(snapshot,tooLarge,tooLarge.tasks[0],{shots:[{id:shot.id,imagePrompt:'X'.repeat(12001),videoPrompt:'Valid'}]}));
  if(existsSync('work/prompt-limit-errors.json')){
    globalThis.preparationState=JSON.parse(readFileSync('work/prompt-limit-errors.json','utf8'));
    const real=structuredClone(preparationState),failed=real.jobs.filter(j=>j.error?.includes('не помещаются в 5000'));
    assert.equal(failed.length,3);const originalApprovals=real.directing.scenes.flatMap(s=>s.shots.map(v=>[v.id,v.approved,v.approvedFoundation]));
    let sourceBefore=0,sourceAfter=0;
    for(const job of failed){const rr=real.directing.runs.find(r=>r.id===job.batchId),task=rr.tasks.find(t=>t.jobId===job.id);sourceBefore+=job.prompt.length;sourceAfter+=R.directorPrompt(real,rr,task).length;
      const response=await POST(new Request('http://local',{method:'POST',body:JSON.stringify({revision:preparationState.revision,action:'repairSavedAnswer',data:{runId:rr.id,taskId:task.id}})}),{params:Promise.resolve({id:real.id})});assert.equal(response.status,200,await response.clone().text());
    }
    const fixed=preparationState,rr=fixed.directing.runs.find(r=>r.id===failed[0].batchId);
    assert(rr.tasks.every(t=>t.applied));assert(rr.published,'Final cached repair also publishes without starting another paid compression run');
    assert.equal(fixed.jobs.length,real.jobs.length);for(const j of real.jobs){const next=fixed.jobs.find(v=>v.id===j.id);assert.equal(next.actual,j.actual);assert.deepEqual(next.output,j.output);assert.equal(next.prompt,j.prompt);}
    assert.deepEqual(fixed.directing.scenes.flatMap(s=>s.shots.map(v=>[v.id,v.approved,v.approvedFoundation])),originalApprovals);
    S.preparePlanCards(fixed);
    let imageFits=0,videoFits=0;const lengths=[];
    for(const s of fixed.directing.scenes)for(const shot of s.shots){assert(R.shotApproved(s,shot,fixed));const frame=fixed.items.find(i=>i.stage===5&&i.sourceShot?.shotId===shot.id&&!i.planArchive),video=fixed.items.find(i=>i.stage===7&&i.sourceShot?.shotId===shot.id&&!i.planArchive);
      const image=C.compilePrompt(fixed,frame,'gpt-image-2.5-flare',{kind:'image',prompt:S.storyboardPrompt(fixed,frame),references:[]});assert(image.prompt.length<=32000);imageFits++;
      const videoPrompt=V.videoPrompt(fixed,video);try{const movie=C.compilePrompt(fixed,video,'MiniMax-H3',{kind:'video',prompt:videoPrompt,references:[{assetId:D.id(),role:'first-frame'}],duration:shot.duration});videoFits++;lengths.push(movie.budget.criticalCharacters);}catch(e){console.log('Long provider-bound video:',shot.title,e.code,e.message.slice(0,120));}
    }
    assert.equal(imageFits,16);console.log(`PASS real saved answers: 3 repaired and published locally; ${imageFits}/16 GPT images fit; ${videoFits}/16 H3 videos fit. Text context ${sourceBefore} -> ${sourceAfter} chars. Receipts, costs, approvals preserved.`);
    const portrait=fixed.items.find(i=>i.stage===1&&!i.removedAt&&i.variants.some(v=>v.id===i.approvedId&&v.kind==='image'&&v.character&&v.assetId)),alias=fixed.directing.scenes[0].shots[0].cast[0];
    B.setCharacterBinding(fixed,alias,portrait.id);
    const faceAsset=portrait.variants.find(v=>v.id===portrait.approvedId).assetId;let boundPlans=0;
    for(const scene of fixed.directing.scenes)for(const shot of scene.shots){const frame=fixed.items.find(i=>i.stage===5&&i.sourceShot?.shotId===shot.id&&!i.planArchive),references=P.planReferenceIds(fixed,frame),result=C.compilePrompt(fixed,frame,'gpt-image-2.5-flare',{kind:'image',prompt:S.storyboardPrompt(fixed,frame),references});
      assert(result.prompt.length<=32000);if(shot.cast.includes(alias)){assert(result.references.some(ref=>ref.assetId===faceAsset&&ref.role==='character'));assert(result.criticalText.includes('Узнаваемость лица — обязательное условие'));boundPlans++;}else assert(!result.references.some(ref=>ref.assetId===faceAsset));
    }
    assert(boundPlans>0);console.log(`PASS private fixture identity binding: ${boundPlans} relevant plans receive the canonical portrait; other plans do not; all 16 GPT image prompts fit.`);
  }
  assert.equal(calls,0);console.log('PASS 32K preparation, 12K editor response, shared input budgets, exact-fact compaction, nonduplicated structured context, manual action preservation, real provider preflight and paid-free repair/publication.');
}finally{globalThis.fetch=originalFetch;}
