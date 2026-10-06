import {mutate,getKey,loadProject} from '@/lib/server';
import {assertBudget,now,type Job,type Project} from './domain';
import {generate,ProviderError,type Result} from './providers';
import {model} from './models';
import {call,json} from './provider-http';
import {mediaPromptCapacity,optimizationTask,parseOptimizedPrompt,sameOptimizationInputs,coolingOptimizers} from './prompt-optimization';
import {promptSize,fitsPrompt,type PromptCapacity} from './model-capabilities';
import {zenPromptLimit} from './zencreator-provider';
import {stopJobWait} from './job-wait';

export const PROMPT_OPTIMIZERS=['gpt-6-astra','grok-4.6','MiniMax-M2.7'];
export type PromptStateScope=<T>(work:()=>Promise<T>)=>Promise<T>;
const directState:PromptStateScope=work=>work();

function applyPrompt(job:Job,prompt:string,cap:PromptCapacity){
  job.prompt=prompt;job.promptSections=undefined;
  job.promptTokenCount=cap.unit==='tokens'?{text:prompt,count:promptSize(prompt,cap),method:'utf8-upper-bound'}:undefined;
  if(job.compilation){job.compilation.budget={...job.compilation.budget,limit:cap.limit,unit:cap.unit,used:promptSize(prompt,cap),compiledCharacters:prompt.length,remaining:cap.limit-promptSize(prompt,cap),needsOptimization:false};job.compilation.compression.shortened=true;}
  job.timings={...job.timings,preparationFinishedAt:now()};
  job.status='queued';job.started=undefined;
}

/** A paid response may have been saved just before a CAS/storage failure. Its
 * locally validated text is usable without resending an optimizer request. */
function savedOptimization(p:Project,job:Job,cap:PromptCapacity,task=optimizationTask(job,cap)){
  const ownIds=job.promptOptimization?.auditIds??(job.promptOptimization?[job.promptOptimization.auditId]:[]);
  for(const audit of [...p.jobs].reverse()){
    if(audit.purpose!=='prompt-optimization'||!audit.output?.text)continue;
    const own=ownIds.includes(audit.id);
    const parent=p.jobs.find(j=>j.id===audit.optimizationParentId);
    if(!own&&(!parent||audit.prompt!==task.prompt||!sameOptimizationInputs(job,parent)))continue;
    // For own recovery the sections remain pinned to this exact media request;
    // for reuse, equality of the complete task also pins limits and instructions.
    try{return {auditId:audit.id,prompt:parseOptimizedPrompt(audit.output.text,task.sections,cap),own};}catch{}
  }
}
/** A timed-out text request never becomes a duplicate video request. */
export function recoverPromptPreparation(p:Project,job:Job){
  const opt=job.promptOptimization;
  if(job.status!=='dispatching'||job.waitStoppedAt||opt?.state!=='running')return false;
  const audit=p.jobs.find(j=>j.id===opt.auditId);
  const cap={...mediaPromptCapacity(job),limit:Math.min(mediaPromptCapacity(job).limit,opt.limit)};
  const saved=savedOptimization(p,job,cap);
  if(saved){
    const paid=p.jobs.find(j=>j.id===saved.auditId)!;paid.status='done';paid.error=undefined;
    opt.state='done';opt.auditId=saved.auditId;
    job.warning='Сохранённый ответ подготовки восстановлен без нового платного запроса.';
    applyPrompt(job,saved.prompt,cap);return true;
  }
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
export async function prepareMediaPrompt(user:string,id:string,job:Job,key:string,withState:PromptStateScope=directState):Promise<Project|undefined> {
  const change=(fn:(p:Project)=>void)=>withState(()=>mutate(user,id,fn));
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
      await change(p=>{const j=p.jobs.find(j=>j.id===job.id)!;j.promptTokenCount=job.promptTokenCount;});
    }
    return;
  }
  const previous=job.promptOptimization,task=optimizationTask(job,cap);
  // Keep the large snapshot inside a short scoped state operation, never while
  // waiting for the optimizer provider. No cross-project cache or secret storage.
  const context=await withState(async()=>{const p=await loadProject(user,id);return {saved:savedOptimization(p,job,cap,task),cooling:coolingOptimizers(p.jobs)};});
  if(context.saved){
    const saved=context.saved;
    return await change(p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!;
      if(parent.status!=='dispatching'||parent.waitStoppedAt||parent.prompt!==job.prompt||parent.promptOptimization?.auditId!==previous?.auditId)throw new ProviderError('Подготовка уже остановлена или изменена. Медиа не отправлено.',true,true);
      const audit=p.jobs.find(j=>j.id===saved.auditId)!;
      audit.status='done';audit.error=undefined;audit.timings={...audit.timings,finishedAt:audit.timings?.finishedAt??now()};
      parent.promptOptimization={auditId:saved.auditId,auditIds:[...new Set([...(previous?.auditIds??[]),saved.auditId])],triedModels:previous?.triedModels??[],warnings:previous?.warnings??[],state:'done',original:previous?.original??parent.prompt,limit:cap.limit,unit:cap.unit};
      parent.warning=saved.own?'Сохранённый ответ подготовки восстановлен без нового платного запроса.':'Использован сохранённый компактный промпт для тех же кадров, постановки и модели. Нового списания за подготовку нет.';
      parent.timings={...parent.timings,preparationStartedAt:parent.timings?.preparationStartedAt??now()};
      applyPrompt(parent,saved.prompt,cap);
    });
  }
  if(previous&&previous.state!=='retrying')throw new ProviderError('Оптимизация этой попытки уже выполнялась. Проверьте её запись в журнале. Медиа повторно не отправлялось.',true,true);
  const tried=previous?.triedModels??[],available:{id:string;key:string}[]=[];
  for(const candidate of PROMPT_OPTIMIZERS.filter(id=>!tried.includes(id)&&!context.cooling.includes(id))){
    try{available.push({id:candidate,key:await getKey(user,model(candidate).provider)});}catch{}
  }
  if(!available.length)throw new ProviderError(context.cooling.length?'Доступные LLM подготовки временно пропущены после повторных ошибок. Проверьте подключения или повторите через 10 минут. Видео не отправлено.':'Нет доступной резервной LLM для подготовки промпта. Проверьте подключения xAI, MiniMax и OpenAI. Видео не отправлено.',true,true);
  const {id:optimizer,key:optimizerKey}=available[0];
  const auditId=crypto.randomUUID();
  // Explicit construction avoids inheriting parent receipts, wait clocks,
  // Zen credits, retries, video parameters or a multi-megabyte snapshot.
  const audit:Job={id:auditId,itemId:job.itemId,batchId:job.batchId,kind:'text',model:optimizer,purpose:'prompt-optimization',optimizationParentId:job.id,
    prompt:task.prompt,brief:`Оптимизация промпта для ${model(job.model).name}`,refs:[],
    camera:'',continuity:'',dialogue:'',voiceId:'',duration:0,offset:0,volume:0,deps:job.deps,
    status:'dispatching',created:now(),started:now(),estimate:null,actual:null};
  try {
    await change(p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!;
      if(parent.status!=='dispatching'||parent.waitStoppedAt||
        (previous?parent.promptOptimization?.state!=='retrying'||parent.promptOptimization.auditId!==previous.auditId:!!parent.promptOptimization))throw Error('Подготовка уже остановлена или запущена.');
      // Unknown LLM cost may never silently bypass a configured project cap.
      assertBudget(p,[audit]);
      parent.promptOptimization={auditId,auditIds:[...(previous?.auditIds??(previous?[previous.auditId]:[])),auditId],triedModels:[...tried,optimizer],warnings:previous?.warnings??[],state:'running',original:previous?.original??parent.prompt,limit:cap.limit,unit:cap.unit};
      parent.timings={...parent.timings,preparationStartedAt:parent.timings?.preparationStartedAt??now()};
      if(context.cooling.length){parent.warning='Недавно ошибавшиеся LLM подготовки временно пропущены: '+context.cooling.map(id=>model(id).name).join(', ')+'.';parent.promptOptimization.warnings=[...(parent.promptOptimization.warnings??[]),parent.warning];}
      p.jobs.push(audit);
    });
  } catch(e){throw new ProviderError(`Не удалось запустить оптимизацию: ${(e as Error).message} Медиа не отправлено.`,true,true);}
  let result:Result|undefined;
  try {
    result=await generate(audit,optimizerKey,[],'16:9');
    // Persist paid receipt BEFORE parsing. A malformed answer is not free.
    await change(p=>{const a=p.jobs.find(j=>j.id===auditId)!;a.actual=result!.actual??null;a.usage=result!.usage;a.requestId=result!.requestId;a.output={text:result!.text};});
    if(result.error||!result.text)throw Error(result.error??'LLM не вернула компактный промпт.');
    const prompt=parseOptimizedPrompt(result.text,task.sections,cap);
    return await change(p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!,a=p.jobs.find(j=>j.id===auditId)!;
      a.status='done';a.error=undefined;
      a.timings={...a.timings,finishedAt:now()};
      // Stop/cancel and basis changes cannot be undone by a late optimizer.
      if(parent.status!=='dispatching'||parent.waitStoppedAt||parent.promptOptimization?.auditId!==auditId||parent.promptOptimization.state!=='running')return;
      parent.promptOptimization.state='done';
      if(tried.length){
        parent.warning=`Промпт подготовила резервная модель ${model(optimizer).name}. Предыдущие ответы и возможные списания сохранены в журнале.`;
        for(const id of parent.promptOptimization.auditIds??[]){const old=p.jobs.find(j=>j.id===id);if(old&&old.id!==auditId){old.optimizationRecovered=true;old.newSeriesAllowedAt=now();}}
      }
      applyPrompt(parent,prompt,cap);
    });
  } catch(e) {
    const next=await change(p=>{const a=p.jobs.find(j=>j.id===auditId)!;a.status=result||e instanceof ProviderError&&e.definite?'failed':'unknown';a.error=(e as Error).message;a.timings={...a.timings,finishedAt:now()};
      // A failed receipt write must not throw away the already paid response.
      // The next tick can validate/reuse it without another optimizer call.
      if(result){a.actual=result.actual??null;a.usage=result.usage;a.requestId=result.requestId;a.output={text:result.text};}
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
