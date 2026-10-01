import {keyframeQueueIssue} from './keyframes';
import { assertBudget, dependencies, jobCurrent, getItem, stageReady, type Job, type Project } from './domain';
import { selectedReferences } from './reference-selection';
import {queueAdmissionIssue,queueRunnableJobs,DEFAULT_QUEUE_CONCURRENCY} from './queue-policy';
import {stampGenerationVersions} from './creative-versions';

export const activeGeneration = (j:Job) => ['queued','dispatching','pending','saving'].includes(j.status);
export const storyboardJob = (p:Project,j:Job) => j.kind==='image' && p.items.some(i=>i.id===j.itemId&&i.stage===5&&!i.removedAt&&!i.planArchive);
export const videoJob = (p:Project,j:Job) => j.kind==='video'&&!j.lipsync&&p.items.some(i=>i.id===j.itemId&&i.stage===7&&!i.removedAt&&!i.planArchive);
export const conceptImageJob = (p:Project,j:Job) => j.kind==='image' && p.items.some(i=>i.id===j.itemId&&[1,2,3].includes(i.stage)&&!i.removedAt&&!i.planArchive);
export const parallelJob = (p:Project,j:Job) => conceptImageJob(p,j)||storyboardJob(p,j)||videoJob(p,j);
export const PARALLEL_GENERATIONS = DEFAULT_QUEUE_CONCURRENCY;
export const generationInProgress = (j:Job) => ['dispatching','pending','saving'].includes(j.status);
export const conceptImageAdmissionIssue=(p:Project,itemId:string)=>queueAdmissionIssue(p,itemId).replaceAll('этого материала','этой карточки');
export const videoAdmissionIssue=(p:Project,itemId?:string)=>itemId?queueAdmissionIssue(p,itemId).replaceAll('этого материала','этого плана'):'';
export const storyboardAdmissionIssue=(p:Project,itemId:string)=>queueAdmissionIssue(p,itemId).replaceAll('этого материала','этого плана');

// Browser and trusted worker use the same fair mixed-stage policy. Actual
// dispatch still claims provider/project capacity inside the server CAS.
export const runnableJobs=queueRunnableJobs;
export const newestProject = (previous:Project|undefined,next:Project) => previous?.id===next.id&&previous.revision>next.revision?previous:next;

// Provider polling can save between admission and persistence. Merge only the
// new jobs, recheck basis/selection and budget, and retry CAS conflicts (no API calls).
export async function enqueueStoryboard(snapshot:Project,jobs:Job[],load:()=>Promise<Project>,save:(p:Project,revision:number)=>Promise<Project>) {
  return enqueuePlanJobs(snapshot,jobs,load,save);
}
export async function enqueuePlanJobs(snapshot:Project,jobs:Job[],load:()=>Promise<Project>,save:(p:Project,revision:number)=>Promise<Project>,sourceItemId?:string) {
  stampGenerationVersions(snapshot,jobs);
  const stage=getItem(snapshot,jobs[0].itemId).stage,batchId=jobs[0].batchId;
  if(![1,2,3,5,7].includes(stage)||jobs.some(j=>getItem(snapshot,j.itemId).stage!==stage||!parallelJob(snapshot,j)))throw new Error('Неверный состав серии материалов.');
  const items=[...new Set(jobs.map(j=>j.itemId))];
  const originals=new Map(items.map(id=>[id,JSON.stringify(getItem(snapshot,id))])),basis=dependencies(snapshot,stage);
  for(let n=0;n<5;n++) {
    const p=await load();
    if(p.jobs.some(j=>j.batchId===batchId))return p;
    if((jobs.every(j=>j.basisVersion===2)?jobs.some(j=>!jobCurrent(p,getItem(p,j.itemId),j)):dependencies(p,stage)!==basis)||items.some(id=>JSON.stringify(getItem(p,id))!==originals.get(id))||!stageReady(p,stage)||
      sourceItemId&&getItem(p,sourceItemId).selectedId!==getItem(snapshot,sourceItemId).selectedId)
      throw new Error('Основа или выбранный план изменились. Проверьте задачу заново.');
    for(const itemId of items){const issue=stage===5?storyboardAdmissionIssue(p,itemId):stage===7?videoAdmissionIssue(p,itemId):conceptImageAdmissionIssue(p,itemId);if(issue)throw new Error(issue);}
    if(stage!==7&&JSON.stringify(p.hiddenReferenceIds??[])!==JSON.stringify(snapshot.hiddenReferenceIds??[])&&jobs.some(j=>selectedReferences(p,j.refs).length!==j.refs.length))
      throw new Error('Список референсов изменился. Проверьте галочки заново.');
    for(const j of jobs){const issue=keyframeQueueIssue(p,j);if(issue)throw Error(issue);}
    assertBudget(p,jobs);
    const revision=p.revision;
    p.jobs.push(...jobs);
    try{return await save(p,revision);}catch(e){if((e as {status?:number}).status!==409||n===4)throw e;}
  }
  throw new Error('Не удалось сохранить очередь. Обновите данные.');
}
