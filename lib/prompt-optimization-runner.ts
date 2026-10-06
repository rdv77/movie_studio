import {mutate,getKey} from '@/lib/server';
import {assertBudget,now,type Job,type Project} from './domain';
import {generate,ProviderError,type Result} from './providers';
import {model} from './models';
import {call,json} from './provider-http';
import {mediaPromptCapacity,optimizationTask,parseOptimizedPrompt} from './prompt-optimization';
import {promptSize,fitsPrompt,type PromptCapacity} from './model-capabilities';
import {zenPromptLimit} from './zencreator-provider';
import {stopJobWait} from './job-wait';

export const PROMPT_OPTIMIZERS=['grok-4.6','MiniMax-M2.7','gpt-6-astra'];
/** A timed-out text request never becomes a duplicate video request. */
export function recoverPromptPreparation(p:Project,job:Job){
  const opt=job.promptOptimization;
  if(job.status!=='dispatching'||job.waitStoppedAt||opt?.state!=='running')return false;
  const audit=p.jobs.find(j=>j.id===opt.auditId);
  if(audit&&['dispatching','pending'].includes(audit.status))stopJobWait(audit,'timeout');
  opt.triedModels??=audit?[audit.model]:[];opt.auditIds??=[opt.auditId];
  opt.state='retrying';job.status='queued';job.started=undefined;
  job.warning='Ожидание подготовки промпта истекло. Будет проверена резервная LLM; видеозапрос ещё не отправлялся.';
  opt.warnings=[...(opt.warnings??[]),job.warning];
  return true;
}

/** The counter endpoint is read-only. Never estimate characters/4 as exact tokens. */
export async function measureMediaPrompt(job:Job,key:string,cap:PromptCapacity):Promise<{count:number;method:'api'|'utf8-upper-bound'}> {
  if(cap.unit!=='tokens')return {count:promptSize(job.prompt,cap),method:'api'};
  const upper=promptSize(job.prompt,cap);
  if(upper<=cap.limit)return {count:upper,method:'utf8-upper-bound'};
  try {
    const d=await json(await call(`https://generativelanguage.googleapis.com/v1beta/models/${job.model}:countTokens`,{'content-type':'application/json','x-goog-api-key':key},{contents:[{parts:[{text:job.prompt}]}]}));
    if(Number.isSafeInteger(d.totalTokens)&&d.totalTokens>=0)return {count:d.totalTokens,method:'api'};
    throw new ProviderError('Google не вернул результат подсчёта токенов.',true,true);
  } catch(e) {
    // Some Veo endpoints do not expose countTokens. A byte bound is intentionally
    // conservative, disclosed in preview/audit; it is not the real token count.
    if(e instanceof ProviderError&&[400,404,405,501].includes(e.httpStatus??0))return {count:upper,method:'utf8-upper-bound'};
    throw new ProviderError('Не удалось проверить лимит токенов Google. Генерация не отправлена. Повторите после восстановления связи.',true,true);
  }
}

/** Returns a project when a separate preparation step finished; the next queue
 * tick dispatches media. The CAS claim and durable audit prevent paid resends. */
export async function prepareMediaPrompt(user:string,id:string,job:Job,key:string):Promise<Project|undefined> {
  if(job.purpose||!['image','video'].includes(job.kind))return;
  let cap=mediaPromptCapacity(job);
  if(model(job.model).provider==='zencreator'){
    const live=await zenPromptLimit(job,key);
    if(live)cap={...cap,limit:Math.min(cap.limit,live),source:'Текущая схема API ZenCreator'};
  }
  const measured=await measureMediaPrompt(job,key,cap);
  if(measured.count<=cap.limit&&(cap.unit==='tokens'||fitsPrompt(job.prompt,cap))){
    if(cap.unit==='tokens'){
      job.promptTokenCount={text:job.prompt,...measured};
      await mutate(user,id,p=>{const j=p.jobs.find(j=>j.id===job.id)!;j.promptTokenCount=job.promptTokenCount;});
    }
    return;
  }
  const previous=job.promptOptimization;
  if(previous&&previous.state!=='retrying')throw new ProviderError('Оптимизация этой попытки уже выполнялась. Проверьте её запись в журнале. Медиа повторно не отправлялось.',true,true);
  const tried=previous?.triedModels??[],available:{id:string;key:string}[]=[];
  for(const candidate of PROMPT_OPTIMIZERS.filter(id=>!tried.includes(id))){
    try{available.push({id:candidate,key:await getKey(user,model(candidate).provider)});}catch{}
  }
  if(!available.length)throw new ProviderError('Нет доступной резервной LLM для подготовки промпта. Проверьте подключения xAI, MiniMax и OpenAI. Видео не отправлено.',true,true);
  const {id:optimizer,key:optimizerKey}=available[0];
  const task=optimizationTask(job,cap),auditId=crypto.randomUUID();
  // Explicit construction avoids inheriting parent receipts, wait clocks,
  // Zen credits, retries, video parameters or a multi-megabyte snapshot.
  const audit:Job={id:auditId,itemId:job.itemId,batchId:job.batchId,kind:'text',model:optimizer,purpose:'prompt-optimization',optimizationParentId:job.id,
    prompt:task.prompt,brief:`Оптимизация промпта для ${model(job.model).name}`,refs:[],
    camera:'',continuity:'',dialogue:'',voiceId:'',duration:0,offset:0,volume:0,deps:job.deps,
    status:'dispatching',created:now(),started:now(),estimate:null,actual:null};
  try {
    await mutate(user,id,p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!;
      if(parent.status!=='dispatching'||parent.waitStoppedAt||
        (previous?parent.promptOptimization?.state!=='retrying'||parent.promptOptimization.auditId!==previous.auditId:!!parent.promptOptimization))throw Error('Подготовка уже остановлена или запущена.');
      // Unknown LLM cost may never silently bypass a configured project cap.
      assertBudget(p,[audit]);
      parent.promptOptimization={auditId,auditIds:[...(previous?.auditIds??(previous?[previous.auditId]:[])),auditId],triedModels:[...tried,optimizer],warnings:previous?.warnings??[],state:'running',original:previous?.original??parent.prompt,limit:cap.limit,unit:cap.unit};
      p.jobs.push(audit);
    });
  } catch(e){throw new ProviderError(`Не удалось запустить оптимизацию: ${(e as Error).message} Медиа не отправлено.`,true,true);}
  let result:Result|undefined;
  try {
    result=await generate(audit,optimizerKey,[],'16:9');
    // Persist paid receipt BEFORE parsing. A malformed answer is not free.
    await mutate(user,id,p=>{const a=p.jobs.find(j=>j.id===auditId)!;a.actual=result!.actual??null;a.usage=result!.usage;a.requestId=result!.requestId;a.output={text:result!.text};});
    if(result.error||!result.text)throw Error(result.error??'LLM не вернула компактный промпт.');
    const prompt=parseOptimizedPrompt(result.text,task.sections,cap);
    return await mutate(user,id,p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!,a=p.jobs.find(j=>j.id===auditId)!;
      a.status='done';a.error=undefined;
      // Stop/cancel and basis changes cannot be undone by a late optimizer.
      if(parent.status!=='dispatching'||parent.waitStoppedAt||parent.promptOptimization?.auditId!==auditId||parent.promptOptimization.state!=='running')return;
      parent.promptOptimization.state='done';
      if(tried.length){
        parent.warning=`Промпт подготовила резервная модель ${model(optimizer).name}. Предыдущие ответы и возможные списания сохранены в журнале.`;
        for(const id of parent.promptOptimization.auditIds??[]){const old=p.jobs.find(j=>j.id===id);if(old&&old.id!==auditId){old.optimizationRecovered=true;old.newSeriesAllowedAt=now();}}
      }
      parent.prompt=prompt;parent.promptSections=undefined;
      parent.promptTokenCount=cap.unit==='tokens'?{text:prompt,count:promptSize(prompt,cap),method:'utf8-upper-bound'}:undefined;
      if(parent.compilation){parent.compilation.budget={...parent.compilation.budget,limit:cap.limit,unit:cap.unit,used:promptSize(prompt,cap),compiledCharacters:prompt.length,remaining:cap.limit-promptSize(prompt,cap),needsOptimization:false};parent.compilation.compression.shortened=true;}
      parent.status='queued';parent.started=undefined;
    });
  } catch(e) {
    const next=await mutate(user,id,p=>{const a=p.jobs.find(j=>j.id===auditId)!;a.status=result||e instanceof ProviderError&&e.definite?'failed':'unknown';a.error=(e as Error).message;
      if(e instanceof ProviderError&&e.notSent){a.actual='0';a.actualSource='Оптимизация не отправлена';}
      const parent=p.jobs.find(j=>j.id===job.id)!;
      if(parent.status!=='dispatching'||parent.waitStoppedAt||parent.promptOptimization?.auditId!==auditId||parent.promptOptimization.state!=='running')return;
      if(available.length>1){
        parent.warning=`${model(optimizer).name} не подготовила промпт. Следующая попытка — ${model(available[1].id).name}. Видеозапрос ещё не отправлялся.`;
        parent.promptOptimization.warnings=[...(parent.promptOptimization.warnings??[]),parent.warning];
        parent.promptOptimization.state='retrying';parent.status='queued';parent.started=undefined;
      }else parent.promptOptimization.state='failed';
    });
    if(next.jobs.find(j=>j.id===job.id)?.promptOptimization?.state!=='failed')return next;
    throw new ProviderError(`Не удалось подготовить компактный промпт: ${(e as Error).message} Изображение или видео не запрашивалось.`,true,true);
  }
}
