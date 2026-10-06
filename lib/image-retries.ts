import {z} from 'zod';
import {assertBudget,getItem,id,jobCurrent,now,stageReady,type Job,type Project} from './domain';
import {compileMediaJob,type MediaJobInput} from './prompt-jobs';
import {model} from './models';
import {FINAL_IMAGE_SETTINGS,GROK_IMAGE_MODEL} from './image-quality';
import {hiddenReferences} from './reference-selection';
import {keyframeQueueIssue} from './keyframes';

export const imageRetrySchema=z.object({maxAttempts:z.number().int().min(1).max(3),fallbackModel:z.string().max(150).optional()}).strict();
export type ImageRetryOptions=z.infer<typeof imageRetrySchema>;
export type ImageRetryState={rootId:string;attempt:number;maxAttempts:number;fallback?:Pick<Job,'model'|'prompt'|'refs'|'compilation'|'imageSettings'|'estimate'>;fallbackAttempt?:boolean;nextJobId?:string;haltReason?:string;notBefore?:string};

/** Compile the fallback before any request is sent; never rebuild an old paid prompt. */
export function prepareImageRetries(p:Project,job:Job,options:ImageRetryOptions|undefined,input:MediaJobInput={}):Job{
  if(!options)return job;
  if(job.kind!=='image'||job.purpose)throw Error('Повторы и резервная модель доступны для изображений.');
  const settings=imageRetrySchema.parse(options);
  let fallback:ImageRetryState['fallback'];
  if(settings.fallbackModel&&settings.fallbackModel!==job.model){
    const m=model(settings.fallbackModel);
    if(m.kind!=='image')throw Error('Резервная модель должна создавать изображения.');
    const compiled=compileMediaJob(p,{...job,model:m.id,estimate:m.estimate,imageSettings:m.id===GROK_IMAGE_MODEL?FINAL_IMAGE_SETTINGS:undefined},input);
    fallback={model:compiled.model,prompt:compiled.prompt,refs:compiled.refs,compilation:compiled.compilation,imageSettings:compiled.imageSettings,estimate:compiled.estimate};
  }
  return {...job,imageRetry:{rootId:job.id,attempt:1,maxAttempts:settings.maxAttempts,fallback}};
}
export function imageRetryValidationJobs(jobs:Job[]):Job[]{
  return jobs.flatMap(j=>j.imageRetry?.fallback?[j,{...j,...j.imageRetry.fallback,imageRetry:undefined}]:[j]);
}
/** Called inside the same CAS that records a definitive failure. Each charge owns a new ledger row. */
export function enqueueImageRetry(p:Project,job:Job,retryable:boolean):void{
  const state=job.imageRetry;
  if(!state||job.kind!=='image'||job.purpose||job.status!=='failed'||state.nextJobId)return;
  const stop=(reason:string)=>{state.haltReason=reason;};
  if(!retryable){stop('Автоповтор остановлен: исправьте ключ, баланс, параметры или причину отказа провайдера.');return;}
  if(state.fallbackAttempt){stop('Резервная модель также не дала изображения. Все попытки сохранены.');return;}
  const useFallback=state.attempt>=state.maxAttempts;
  if(useFallback&&!state.fallback){stop('Достигнуто выбранное число попыток; резервная модель не выбрана.');return;}
  try{
    const item=getItem(p,job.itemId);
    if(item.removedAt||item.planArchive||!stageReady(p,item.stage)||!jobCurrent(p,item,job))throw Error('Основа изменилась: новая платная попытка не запускалась.');
    const created=now();
    const next:Job={...job,...(useFallback?state.fallback:{}),id:id(),created,started:undefined,status:'queued',actual:null,actualSource:undefined,requestId:undefined,pollingUrl:undefined,output:undefined,usage:undefined,error:undefined,saveFailures:undefined,waitStartedAt:undefined,waitStoppedAt:undefined,waitStopReason:undefined,resumeStatus:undefined,newSeriesAllowedAt:undefined,journalArchivedAt:undefined,timings:{queuedAt:created},pollRetry:undefined,
      imageRetry:{rootId:state.rootId,attempt:useFallback?1:state.attempt+1,maxAttempts:state.maxAttempts,fallback:useFallback?undefined:state.fallback,fallbackAttempt:useFallback,notBefore:new Date(Date.now()+15000).toISOString()}};
    const hidden=hiddenReferences(p);
    if(next.refs.some(ref=>hidden.has(ref)))throw Error('Референсы были исключены. Проверьте новую серию вручную.');
    if(next.keyframe){const issue=keyframeQueueIssue(p,next);if(issue)throw Error(issue);}
    assertBudget(p,[next]);
    p.jobs.push(next);state.nextJobId=next.id;
  }catch(error){stop(error instanceof Error?error.message:'Не удалось подготовить повтор.');}
}
