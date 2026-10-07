import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const server=`export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}};export const api=f=>async(r,c)=>{try{return await f(r,c)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};export const owner=async()=> 'owner';export const getKey=async()=>{throw Error('No credentials allowed')};export const imageData=async()=>{throw Error('No images allowed')};export const loadProject=async()=>structuredClone(globalThis.testFilm);export async function saveProject(u,p,revision){if(revision!==globalThis.testFilm.revision)throw new HttpError('CAS conflict',409);p.revision++;globalThis.testFilm=structuredClone(p);return p};export async function mutate(u,id,fn){const p=await loadProject(),revision=p.revision;await fn(p);return saveProject(u,p,revision);}`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/directing-specialists';export * as Q from './lib/directing-solutions';export {POST} from './app/api/projects/[id]/directing/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/story-role-contract.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'local-server',setup(b){b.onResolve({filter:/^(?:@\/lib|\.)\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,R,S,Q,POST}=await import('../work/tests/story-role-contract.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No API calls allowed');};
try {
  const p=D.newProject('Реакция героя'),d=R.ensureDirecting(p);
  const narrativeBeat={role:'action-reaction',character:'Мастер',trigger:'Лампа гаснет',meaning:'Испытание не удалось',emotionStart:'Уверенность',emotionEnd:'Тревога',decision:'Проверить прибор',visibleEvidence:'Улыбка исчезает, взгляд замирает на приборе'};
  const performance=[{character:'Мастер',objective:'Проверить прибор',subtext:'Я был уверен в успехе',emotionStart:'Уверенность',emotionEnd:'Тревога',visibleAction:'Улыбка исчезает при виде погасшей лампы'}];
  const shot={id:'shot',title:'Испытание',duration:6,cast:['Мастер'],story:'Мастер проверяет прибор',stateIn:'Лампа горит',stateOut:'Лампа погасла',cinematography:'Крупный план',productionDesign:'Мастерская',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{narrativeBeat,framingStart:'close-up',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Медленно к лицу'},facialExpression:'natural',stagingMode:'readable',performance}};
  const scene={id:'scene',title:'Испытание',purpose:'Перелом',location:'Мастерская',conflict:'Ожидание и неудача',turn:'Тревога',stateIn:'Уверен',stateOut:'Проверяет',continuity:[],shots:[shot]};d.scenes=[scene];
  const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'MiniMax-M2.7',mode:'role',tasks:[],sceneIds:['scene']};
  const task={id:'story',role:'story',sceneId:'scene',shotId:'shot',requires:[]};
  const unwanted={framingStart:'крупный',cameraMovement:{type:'tilt_up'},performance:{objective:'Unsolicited actor object'},purpose:'misplaced',keepInFrame:'misplaced'};
  const response={shots:[{...structuredClone(shot),story:'Новый текст действия',direction:{...unwanted,narrativeBeat:{...narrativeBeat,decision:'Разобраться в причине'}}}]};
  assert(!R.directingShotSchema.safeParse(response.shots[0]).success,'The full manual/editor schema is still strict');
  const oldDirection=structuredClone(shot.direction),untouched=structuredClone(response);
  R.applyDirectorResult(p,run,task,response);
  assert(task.applied);assert.equal(scene.shots[0].story,'Новый текст действия');
  assert.deepEqual(scene.shots[0].direction,{...oldDirection,narrativeBeat:{...narrativeBeat,decision:'Разобраться в причине'}});
  assert.deepEqual(response,untouched,'The saved provider answer stays unchanged');
  for(const bad of [{...narrativeBeat,role:'invented'},{...narrativeBeat,trigger:undefined},{...narrativeBeat,meaning:100}]){
    const copy=structuredClone(p),before=structuredClone(copy.directing.scenes[0].shots);
    assert.throws(()=>R.applyDirectorResult(copy,{...run,basis:R.directorBasis(copy)},{...task},{shots:[{...response.shots[0],direction:{...unwanted,narrativeBeat:bad}}]}));
    assert.deepEqual(copy.directing.scenes[0].shots,before,'Invalid owned narrative fields cannot mutate plans');
  }
  assert.throws(()=>R.applyDirectorResult(structuredClone(p),run,{...task},{shots:[{...response.shots[0],id:'unknown'}]}),/прежними ID/);
  assert.throws(()=>S.specialistUpdates(scene,'camera',{shots:[{id:shot.id,cinematography:'Камера',direction:{cameraMovement:{type:'tilt_up'}}}]},shot.id));
  assert.throws(()=>S.specialistUpdates(scene,'performance',{shots:[{id:shot.id,performance:{objective:'Bad'}}]},shot.id));
  for(const [section,after] of [['direction',oldDirection],['dialogue',shot.dialogue]]){
    const raw={issues:[],patches:[{shotId:'shot',section,after,reason:'Уточнение'}]},before=structuredClone(raw);
    const prepared=Q.prepareDirectorReview(p,raw);
    assert.deepEqual(JSON.parse(prepared.patches[0].after),after);
    assert.deepEqual(raw,before,'Structured after serialization does not change the saved response');
  }
  for(const [section,after] of [['story',{text:'Не строка'}],['dialogue',[]],['dialogue',{speechType:'none',speaker:'',text:'Недопустимая речь',delivery:''}],['direction',{cameraMovement:{type:'tilt_up',description:'Bad enum'}}]]){
    assert.throws(()=>Q.prepareDirectorReview(p,{issues:[],patches:[{shotId:'shot',section,after,reason:'Ошибка'}]}),'Structured patch values remain semantically validated');
  }

  const path=resolve('../work/emotion-films/film-b-current.json');
  if(existsSync(path)){
    const saved=JSON.parse(readFileSync(path,'utf8'));
    const failed=saved.jobs.filter(j=>['14df848b-2d2e-4900-bee1-908a98657a22','006bad01-749b-4af1-b83d-cc226d75ee89','754003b6-f729-4fd4-aaa9-2bd939905477','92fc7922-3b69-4f83-9aef-776db8eb6800','f225ab4f-3fa7-45f2-93c2-b5ce8f150e17'].includes(j.id)&&j.status==='failed'&&j.output?.text);
    globalThis.testFilm=structuredClone(saved);
    for(const job of failed){
      const ownerRun=testFilm.directing.runs.find(r=>r.id===job.batchId),ownerTask=ownerRun.tasks.find(t=>t.jobId===job.id);
      const receiptBefore=structuredClone(testFilm.jobs.find(j=>j.id===job.id)),count=testFilm.jobs.length;
      const response=await POST(new Request('http://local',{method:'POST',body:JSON.stringify({revision:testFilm.revision,action:'repairSavedAnswer',data:{runId:ownerRun.id,taskId:ownerTask.id}})}),{params:Promise.resolve({id:testFilm.id})});
      assert.equal(response.status,200,await response.clone().text());
      const after=testFilm.jobs.find(j=>j.id===job.id);
      assert.equal(after.status,'done');assert(!after.error);assert.equal(after.actual,receiptBefore.actual);assert.deepEqual(after.usage,receiptBefore.usage);assert.deepEqual(after.output,receiptBefore.output);assert.equal(testFilm.jobs.length,count);
      assert(testFilm.directing.runs.find(r=>r.id===ownerRun.id).tasks.find(t=>t.id===ownerTask.id).applied);
    }
    if(failed.length)console.log(`PASS actual saved specialist answers: ${failed.length} restored through repairSavedAnswer with unchanged receipts and zero new jobs.`);
    if(failed.length)for(const guard of ['unknown','stopped','basis','revision']){
      globalThis.testFilm=structuredClone(saved);
      const job=testFilm.jobs.find(j=>j.id===failed[0].id),ownerRun=testFilm.directing.runs.find(r=>r.id===job.batchId),ownerTask=ownerRun.tasks.find(t=>t.jobId===job.id);
      if(guard==='unknown')job.status='unknown';
      if(guard==='stopped')ownerRun.stopped=true;
      if(guard==='basis')ownerRun.basis='stale';
      const before=structuredClone(testFilm);
      const response=await POST(new Request('http://local',{method:'POST',body:JSON.stringify({revision:testFilm.revision-(guard==='revision'?1:0),action:'repairSavedAnswer',data:{runId:ownerRun.id,taskId:ownerTask.id}})}),{params:Promise.resolve({id:testFilm.id})});
      assert.equal(response.status,400,guard+' remains rejected');
      assert.deepEqual(testFilm,before,guard+' cannot change the project or submit another job');
    }
  }
  console.log('PASS story-only narrative validation, preserved camera/actor work, strict owning specialists/manual schema, unknown-ID rejection and no paid API calls.');
}finally{globalThis.fetch=originalFetch;}
