import type {Job,Project} from './domain';

/** Application timestamps, not a provider's GPU execution measurements. */
export type JobTimings={queuedAt?:string;preparationStartedAt?:string;preparationFinishedAt?:string;providerSubmittedAt?:string;providerAcceptedAt?:string;providerCompletedAt?:string;savingStartedAt?:string;finishedAt?:string};
export type PollRetry={attempts:number;nextPollAt?:string;lastError?:string;lastAttemptAt?:string};
export type UnchangedJobProgress={kind:'job-progress';projectId:string;revision:number;unchanged:true};
export function unchangedJobProgress(p:Project,revision:unknown):UnchangedJobProgress|undefined{
  return Number.isSafeInteger(revision)&&revision===p.revision?{kind:'job-progress',projectId:p.id,revision:p.revision,unchanged:true}:undefined;
}
export function isUnchangedJobProgress(value:unknown):value is UnchangedJobProgress{
  return !!value&&typeof value==='object'&&(value as UnchangedJobProgress).kind==='job-progress'&&(value as UnchangedJobProgress).unchanged===true;
}
const seconds=(start?:string,end?:string,time=Date.now())=>{
  const from=Date.parse(start??''),to=end?Date.parse(end):time;
  return Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,(to-from)/1000):undefined;
};
export function jobTimingRows(job:Job,time=Date.now()):{label:string;seconds?:number;running:boolean}[]{
  const t=job.timings;if(!t)return [];
  const active=!['done','failed','unknown','cancelled'].includes(job.status),end=t.finishedAt;
  return [
    {label:'Очередь',seconds:seconds(t.queuedAt??job.created,t.preparationStartedAt??t.providerSubmittedAt??end,time),running:active&&!t.preparationStartedAt&&!t.providerSubmittedAt},
    {label:'Подготовка промпта',seconds:seconds(t.preparationStartedAt,t.preparationFinishedAt??end,time),running:active&&!!t.preparationStartedAt&&!t.preparationFinishedAt},
    {label:'Запрос и ожидание провайдера',seconds:seconds(t.providerSubmittedAt,t.providerCompletedAt??end,time),running:active&&!!t.providerSubmittedAt&&!t.providerCompletedAt},
    {label:'Сохранение',seconds:seconds(t.savingStartedAt,end,time),running:active&&!!t.savingStartedAt&&!end},
  ].filter(row=>row.seconds!==undefined);
}
export function jobPhase(job:Job):string{
  if(job.status==='queued')return job.promptOptimization?.state==='retrying'?'Ожидает резервную модель подготовки':'Ожидает свободного места';
  if(job.status==='dispatching')return job.promptOptimization?.state==='running'?'Подготовка промпта':'Отправка запроса';
  if(job.status==='pending')return job.pollRetry?.nextPollAt?'Пауза перед проверкой прежнего запроса':'Ожидание результата провайдера';
  if(job.status==='saving')return 'Сохранение готового файла';
  return '';
}
export function formatJobSeconds(value:number):string{
  const rounded=Math.round(value);return rounded<60?`${rounded} сек`:`${Math.floor(rounded/60)} мин ${rounded%60} сек`;
}
