import {z} from 'zod';
import type {Project,Job} from './domain';
import {model,PROVIDERS} from './models';
import {unresolvedJobBlocks,waitExpired} from './job-wait';

export const DEFAULT_QUEUE_CONCURRENCY=3;
const limit=z.number().int().min(1).max(8);
const providerNames=new Set(PROVIDERS.map(p=>p.id));
export const queueSettingsSchema=z.object({concurrency:limit.default(DEFAULT_QUEUE_CONCURRENCY),providerLimits:z.record(z.string().max(100),limit).default({})}).strict()
  .refine(v=>Object.keys(v.providerLimits).every(id=>providerNames.has(id)),'Выберите подключённого провайдера для ограничения очереди.');
export type QueueSettings=z.infer<typeof queueSettingsSchema>;
export type QueueProject=Project&{queueSettings?:QueueSettings};
export function queueSettings(p:QueueProject):QueueSettings{return queueSettingsSchema.parse(p.queueSettings??{});}
export function saveQueueSettings(p:QueueProject,input:unknown){p.queueSettings=queueSettingsSchema.parse(input);return p.queueSettings;}
export function jobProvider(job:Job):string{
  if(job.voiceWorkflow?.provider)return job.voiceWorkflow.provider;
  if((job as Job&{soundInput?:unknown}).soundInput)return 'elevenlabs';
  try{return model(job.model).provider;}catch{return 'unknown:'+job.model;}
}
export function providerQueueLimit(p:QueueProject,provider:string):number{
  const settings=queueSettings(p);return Math.min(settings.concurrency,settings.providerLimits[provider]??DEFAULT_QUEUE_CONCURRENCY);
}
export const queueActive=(job:Job)=>['queued','dispatching','pending','saving'].includes(job.status);
export const queueOccupied=(job:Job)=>['dispatching','pending','saving'].includes(job.status);
export type DirectorQueueTask={role:string;sceneId?:string;shotId?:string;shotIds?:string[]};
function directorScopeParts(p:Project,job:Job,task?:DirectorQueueTask){
  const run=p.directing?.runs.find(r=>r.id===job.batchId),source=task??run?.tasks.find(t=>t.jobId===job.id);
  const settings=job.versionInfo?.settings as {role?:string;sceneId?:string;shotId?:string;shotIds?:string[]}|undefined;
  const shotIds=source?source.shotIds:settings?.shotIds,shotId=source?source.shotId:settings?.shotId;
  return {role:source?source.role:settings?.role??'legacy-directing',scene:source?source.sceneId??'':settings?.sceneId??'',shots:shotIds?.length?[...shotIds]:shotId?[shotId]:undefined,item:run?.characterInput?.itemId??run?.scriptInput?.itemId??job.itemId};
}
/** Specialist requests share an output item but own distinct scene/shot fields. */
export function directorQueueScope(p:Project,job:Job,task?:DirectorQueueTask):string{
  const s=directorScopeParts(p,job,task);return JSON.stringify([s.role,s.scene,s.shots?.slice().sort().join('\u001f')??'',s.item]);
}
export function directorQueueScopesOverlap(p:Project,a:Job,b:Job,task?:DirectorQueueTask){
  const x=directorScopeParts(p,a,task),y=directorScopeParts(p,b);
  return x.role===y.role&&x.scene===y.scene&&x.item===y.item&&(!x.shots||!y.shots||x.shots.some(id=>y.shots!.includes(id)));
}
/** Admission concerns this item only. Independent stages may use the same pool. */
export function queueAdmissionIssue(p:Project,itemId:string,batchId?:string):string{
  if(p.jobs.some(j=>j.purpose!=='directing'&&j.itemId===itemId&&unresolvedJobBlocks(j)&&(!batchId||j.batchId!==batchId)))return 'У этого материала есть запрос с неизвестным исходом. Проверьте журнал или явно разрешите новую серию; платный запрос автоматически не повторяется.';
  if(p.jobs.some(j=>j.itemId===itemId&&!['directing','media-review'].includes(j.purpose??'')&&queueActive(j)&&(!batchId||j.batchId!==batchId)))return 'Для этого материала уже выполняется серия. Другие планы и этапы можно запускать параллельно.';
  return '';
}
/** Call inside the existing CAS mutation immediately before a queued claim. */
export function queueSlotIssue(p:QueueProject,job:Job,locallyClaimed:ReadonlySet<string>=new Set(),directorTask?:DirectorQueueTask):string{
  if(job.status!=='queued')return '';
  if(job.purpose==='directing'){
    const same=p.jobs.filter(j=>j.id!==job.id&&j.purpose==='directing'&&directorQueueScopesOverlap(p,job,j,directorTask));
    if(same.some(unresolvedJobBlocks))return 'У этой роли агента для сцены/плана есть запрос с неизвестным исходом. Проверьте журнал и явно разрешите новую серию; другие сцены и роли можно прорабатывать.';
    if(same.some(j=>queueActive(j)&&j.batchId!==job.batchId))return 'Эту роль для сцены/плана уже выполняет другая серия. Дождитесь результата; другие сцены и роли могут работать параллельно.';
  }else{
    const itemIssue=queueAdmissionIssue(p,job.itemId,job.batchId);if(itemIssue&&job.purpose!=='media-review')return itemIssue;
  }
  const occupied=p.jobs.filter(j=>j.id!==job.id&&(queueOccupied(j)||locallyClaimed.has(j.id))),settings=queueSettings(p);
  if(occupied.length>=settings.concurrency)return `Все ${settings.concurrency} места очереди заняты. Попытка ожидает отправки.`;
  const provider=jobProvider(job),providerLimit=providerQueueLimit(p,provider);
  if(occupied.filter(j=>jobProvider(j)===provider).length>=providerLimit)return `Достигнут лимит провайдера: ${providerLimit} одновременных задач. Попытка ожидает отправки.`;
  return '';
}
/** Fair selection for browser or worker. Polling an existing receipt uses no new provider slot. */
export function queueRunnableJobs(p:QueueProject,inputFlights:ReadonlySet<string>,attempted:ReadonlyMap<string,number>,time=Date.now()):Job[]{
  const settings=queueSettings(p),active=p.jobs.filter(j=>j.purpose!=='directing'&&queueActive(j));
  const flights=new Set([...inputFlights].filter(id=>active.some(j=>j.id===id)));
  const slots=Math.max(0,settings.concurrency-flights.size),picked:Job[]=[],claimed=new Set(flights);
  const candidates=active.filter(j=>!flights.has(j.id)&&(j.status!=='dispatching'||waitExpired(j,time)));
  while(picked.length<slots){
    const eligible=candidates.filter(j=>j.status!=='queued'||!queueSlotIssue(p,j,claimed))
      .sort((a,b)=>(attempted.get(a.id)??0)-(attempted.get(b.id)??0)||
        (a.status==='queued'?1:0)-(b.status==='queued'?1:0)||
        [...p.jobs.filter(queueOccupied),...picked].filter(j=>j.model===a.model).length-[...p.jobs.filter(queueOccupied),...picked].filter(j=>j.model===b.model).length||
        [...p.jobs.filter(queueOccupied),...picked].filter(j=>j.itemId===a.itemId).length-[...p.jobs.filter(queueOccupied),...picked].filter(j=>j.itemId===b.itemId).length||
        Date.parse(a.created)-Date.parse(b.created)||a.id.localeCompare(b.id));
    const next=eligible[0];if(!next)break;picked.push(next);candidates.splice(candidates.indexOf(next),1);
    if(next.status==='queued')claimed.add(next.id);
  }
  return picked;
}
