import { assertBudget, dependencies, getItem, stageReady, type Job, type Project } from './domain';
import { selectedReferences } from './reference-selection';

export const activeGeneration = (j:Job) => ['queued','dispatching','pending','saving'].includes(j.status);
export const storyboardJob = (p:Project,j:Job) => j.kind==='image' && p.items.some(i=>i.id===j.itemId&&i.stage===5&&!i.removedAt&&!i.planArchive);
export function storyboardAdmissionIssue(p:Project,itemId:string) {
  if(p.jobs.some(j=>j.itemId===itemId&&(activeGeneration(j)||j.status==='unknown')))
    return 'Для этого плана уже есть текущая попытка или запрос с неизвестным исходом. Выберите другой план либо проверьте журнал.';
  if(p.jobs.some(j=>activeGeneration(j)&&!storyboardJob(p,j)))
    return 'Дождитесь текущей серии другого этапа. Параллельно можно создавать изображения разных планов раскадровки.';
  return '';
}

// Fair scheduling keeps a slow asynchronous provider from monopolizing the
// runner. Only storyboard requests run concurrently; other workflows stay serial.
export function runnableJobs(p:Project,inFlight:ReadonlySet<string>,attempted:ReadonlyMap<string,number>) {
  const active=p.jobs.filter(activeGeneration);
  const parallel=active.length>0&&active.every(j=>storyboardJob(p,j));
  if(!parallel) return inFlight.size ? [] : active.filter(j=>j.status!=='queued').slice(0,1).concat(active.filter(j=>j.status==='queued')).slice(0,1);
  const slots=Math.max(0,3-inFlight.size);
  return active.filter(j=>!inFlight.has(j.id))
    .sort((a,b)=>(attempted.get(a.id)??0)-(attempted.get(b.id)??0))
    .slice(0,slots);
}
export const newestProject = (previous:Project|undefined,next:Project) => previous?.id===next.id&&previous.revision>next.revision?previous:next;

// Provider polling can save between admission and persistence. Merge only the
// new jobs, recheck basis/selection and budget, and retry CAS conflicts (no API calls).
export async function enqueueStoryboard(snapshot:Project,jobs:Job[],load:()=>Promise<Project>,save:(p:Project,revision:number)=>Promise<Project>) {
  const itemId=jobs[0].itemId,batchId=jobs[0].batchId;
  const original=JSON.stringify(getItem(snapshot,itemId)),basis=dependencies(snapshot,5);
  for(let n=0;n<5;n++) {
    const p=await load();
    if(p.jobs.some(j=>j.batchId===batchId))return p;
    if(dependencies(p,5)!==basis||JSON.stringify(getItem(p,itemId))!==original||!stageReady(p,5))
      throw new Error('Основа или выбранный план изменились. Проверьте задачу заново.');
    const issue=storyboardAdmissionIssue(p,itemId);if(issue)throw new Error(issue);
    if(JSON.stringify(p.hiddenReferenceIds??[])!==JSON.stringify(snapshot.hiddenReferenceIds??[])&&jobs.some(j=>selectedReferences(p,j.refs).length!==j.refs.length))
      throw new Error('Список референсов изменился. Проверьте галочки заново.');
    assertBudget(p,jobs);
    const revision=p.revision;
    p.jobs.push(...jobs);
    try{return await save(p,revision);}catch(e){if((e as {status?:number}).status!==409||n===4)throw e;}
  }
  throw new Error('Не удалось сохранить очередь. Обновите данные.');
}
