import { assertBudget, dependencies, getItem, stageReady, type Job, type Project } from './domain';
import { selectedReferences } from './reference-selection';

export const activeGeneration = (j:Job) => ['queued','dispatching','pending','saving'].includes(j.status);
export const storyboardJob = (p:Project,j:Job) => j.kind==='image' && p.items.some(i=>i.id===j.itemId&&i.stage===5&&!i.removedAt&&!i.planArchive);
export const videoJob = (p:Project,j:Job) => j.kind==='video'&&!j.lipsync&&p.items.some(i=>i.id===j.itemId&&i.stage===7&&!i.removedAt&&!i.planArchive);
export const conceptImageJob = (p:Project,j:Job) => j.kind==='image' && p.items.some(i=>i.id===j.itemId&&[1,2,3].includes(i.stage)&&!i.removedAt&&!i.planArchive);
export const parallelJob = (p:Project,j:Job) => conceptImageJob(p,j)||storyboardJob(p,j)||videoJob(p,j);
export const PARALLEL_GENERATIONS = 3;
export const generationInProgress = (j:Job) => ['dispatching','pending','saving'].includes(j.status);
export function conceptImageAdmissionIssue(p:Project,itemId:string) {
  if(p.jobs.some(j=>j.itemId===itemId&&(activeGeneration(j)||j.status==='unknown')))
    return 'Для этой карточки уже есть текущая попытка или запрос с неизвестным исходом. Откройте другого героя или материал либо проверьте журнал.';
  if(p.jobs.some(j=>activeGeneration(j)&&!conceptImageJob(p,j)))
    return 'Дождитесь задач другого этапа. Образы героев, визуальный стиль и локации можно генерировать параллельно.';
  return '';
}
export function videoAdmissionIssue(p:Project,itemId?:string) {
  if(itemId&&p.jobs.some(j=>j.itemId===itemId&&(activeGeneration(j)||j.status==='unknown')))
    return 'Для этого плана уже есть текущая попытка или запрос с неизвестным исходом. Выберите другой план либо проверьте журнал.';
  if(p.jobs.some(j=>activeGeneration(j)&&!videoJob(p,j)))
    return 'Дождитесь задач другого этапа или синхронизации губ. Видеопланы можно создавать параллельно друг с другом.';
  return '';
}
export function storyboardAdmissionIssue(p:Project,itemId:string) {
  if(p.jobs.some(j=>j.itemId===itemId&&(activeGeneration(j)||j.status==='unknown')))
    return 'Для этого плана уже есть текущая попытка или запрос с неизвестным исходом. Выберите другой план либо проверьте журнал.';
  if(p.jobs.some(j=>activeGeneration(j)&&!storyboardJob(p,j)))
    return 'Дождитесь текущей серии другого этапа. Параллельно можно создавать изображения разных планов раскадровки.';
  return '';
}

// Fair scheduling keeps a slow asynchronous provider from monopolizing the
// runner. Image/video provider tasks occupy a slot until saved or failed, even
// between HTTP polls. Enforce the same bound atomically when dispatching.
export function runnableJobs(p:Project,inputFlights:ReadonlySet<string>,attempted:ReadonlyMap<string,number>) {
  const active=p.jobs.filter(activeGeneration);
  const inFlight=new Set([...inputFlights].filter(id=>active.some(j=>j.id===id)));
  const parallel=active.length>0&&active.every(j=>parallelJob(p,j));
  if(!parallel) return inFlight.size ? [] : active.filter(j=>j.status!=='queued').slice(0,1).concat(active.filter(j=>j.status==='queued')).slice(0,1);
  const slots=Math.max(0,PARALLEL_GENERATIONS-inFlight.size);
  let starts=Math.max(0,PARALLEL_GENERATIONS-active.filter(j=>generationInProgress(j)||inFlight.has(j.id)).length);
  const picked:Job[]=[],candidates=active.filter(j=>!inFlight.has(j.id));
  const running=active.filter(j=>generationInProgress(j)||inFlight.has(j.id));
  while(picked.length<slots) {
    const occupancy=[...running,...picked];
    const count=(j:Job,key:'model'|'itemId')=>occupancy.filter(x=>x[key]===j[key]).length;
    const eligible=candidates.filter(j=>j.status!=='queued'||starts>0).sort((a,b)=>
      (attempted.get(a.id)??0)-(attempted.get(b.id)??0)||count(a,'model')-count(b,'model')||count(a,'itemId')-count(b,'itemId'));
    const next=eligible[0];if(!next)break;
    picked.push(next);candidates.splice(candidates.indexOf(next),1);
    if(next.status==='queued')starts--;
  }
  return picked;
}
export const newestProject = (previous:Project|undefined,next:Project) => previous?.id===next.id&&previous.revision>next.revision?previous:next;

// Provider polling can save between admission and persistence. Merge only the
// new jobs, recheck basis/selection and budget, and retry CAS conflicts (no API calls).
export async function enqueueStoryboard(snapshot:Project,jobs:Job[],load:()=>Promise<Project>,save:(p:Project,revision:number)=>Promise<Project>) {
  return enqueuePlanJobs(snapshot,jobs,load,save);
}
export async function enqueuePlanJobs(snapshot:Project,jobs:Job[],load:()=>Promise<Project>,save:(p:Project,revision:number)=>Promise<Project>,sourceItemId?:string) {
  const stage=getItem(snapshot,jobs[0].itemId).stage,batchId=jobs[0].batchId;
  if(![1,2,3,5,7].includes(stage)||jobs.some(j=>getItem(snapshot,j.itemId).stage!==stage||!parallelJob(snapshot,j)))throw new Error('Неверный состав серии материалов.');
  const items=[...new Set(jobs.map(j=>j.itemId))];
  const originals=new Map(items.map(id=>[id,JSON.stringify(getItem(snapshot,id))])),basis=dependencies(snapshot,stage);
  for(let n=0;n<5;n++) {
    const p=await load();
    if(p.jobs.some(j=>j.batchId===batchId))return p;
    if(dependencies(p,stage)!==basis||items.some(id=>JSON.stringify(getItem(p,id))!==originals.get(id))||!stageReady(p,stage)||
      sourceItemId&&getItem(p,sourceItemId).selectedId!==getItem(snapshot,sourceItemId).selectedId)
      throw new Error('Основа или выбранный план изменились. Проверьте задачу заново.');
    for(const itemId of items){const issue=stage===5?storyboardAdmissionIssue(p,itemId):stage===7?videoAdmissionIssue(p,itemId):conceptImageAdmissionIssue(p,itemId);if(issue)throw new Error(issue);}
    if(stage!==7&&JSON.stringify(p.hiddenReferenceIds??[])!==JSON.stringify(snapshot.hiddenReferenceIds??[])&&jobs.some(j=>selectedReferences(p,j.refs).length!==j.refs.length))
      throw new Error('Список референсов изменился. Проверьте галочки заново.');
    assertBudget(p,jobs);
    const revision=p.revision;
    p.jobs.push(...jobs);
    try{return await save(p,revision);}catch(e){if((e as {status?:number}).status!==409||n===4)throw e;}
  }
  throw new Error('Не удалось сохранить очередь. Обновите данные.');
}
