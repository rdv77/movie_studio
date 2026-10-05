import {mutate,getKey} from '@/lib/server';
import {assertBudget,now,type Job,type Project} from './domain';
import {generate,ProviderError,type Result} from './providers';
import {model} from './models';
import {call,json} from './provider-http';
import {mediaPromptCapacity,optimizationTask,parseOptimizedPrompt} from './prompt-optimization';
import {promptSize,type PromptCapacity} from './model-capabilities';
import {zenPromptLimit} from './zencreator-provider';

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
  if(measured.count<=cap.limit){
    if(cap.unit==='tokens'){
      job.promptTokenCount={text:job.prompt,...measured};
      await mutate(user,id,p=>{const j=p.jobs.find(j=>j.id===job.id)!;j.promptTokenCount=job.promptTokenCount;});
    }
    return;
  }
  if(job.promptOptimization)throw new ProviderError('Оптимизация этой попытки уже выполнялась. Проверьте её запись в журнале. Медиа повторно не отправлялось.',true,true);
  let optimizer='',optimizerKey='';
  for(const candidate of ['grok-4.6','gpt-6-astra','MiniMax-M2.7']){
    try{optimizerKey=await getKey(user,model(candidate).provider);optimizer=candidate;break;}catch{}
  }
  if(!optimizer)throw new ProviderError('Длинный промпт требует текстовой LLM. Добавьте ключ xAI, OpenAI или MiniMax в «Подключения». Генерация не отправлена.',true,true);
  const task=optimizationTask(job,cap),auditId=crypto.randomUUID();
  const audit:Job={...job,id:auditId,batchId:job.batchId,kind:'text',model:optimizer,purpose:'prompt-optimization',
    prompt:task.prompt,brief:`Оптимизация промпта для ${model(job.model).name}`,refs:[],characterRefs:undefined,endFrameAssetId:undefined,
    compilation:undefined,promptSections:undefined,promptOptimization:undefined,promptTokenCount:undefined,imageRetry:undefined,keyframe:undefined,
    status:'dispatching',created:now(),started:now(),estimate:null,actual:null,requestId:undefined,output:undefined,usage:undefined};
  try {
    await mutate(user,id,p=>{
      const parent=p.jobs.find(j=>j.id===job.id)!;
      if(parent.status!=='dispatching'||parent.waitStoppedAt||parent.promptOptimization)throw Error('Подготовка уже остановлена или запущена.');
      // Unknown LLM cost may never silently bypass a configured project cap.
      assertBudget(p,[audit]);
      parent.promptOptimization={auditId,state:'running',original:parent.prompt,limit:cap.limit,unit:cap.unit};
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
      a.status='done';a.error=undefined;parent.promptOptimization!.state='done';
      // Stop/cancel and basis changes cannot be undone by a late optimizer.
      if(parent.status!=='dispatching'||parent.waitStoppedAt)return;
      parent.prompt=prompt;parent.promptSections=undefined;
      parent.promptTokenCount=cap.unit==='tokens'?{text:prompt,count:promptSize(prompt,cap),method:'utf8-upper-bound'}:undefined;
      if(parent.compilation){parent.compilation.budget={...parent.compilation.budget,limit:cap.limit,unit:cap.unit,used:promptSize(prompt,cap),compiledCharacters:prompt.length,remaining:cap.limit-promptSize(prompt,cap),needsOptimization:false};parent.compilation.compression.shortened=true;}
      parent.status='queued';parent.started=undefined;
    });
  } catch(e) {
    await mutate(user,id,p=>{const a=p.jobs.find(j=>j.id===auditId)!;a.status=result||e instanceof ProviderError&&e.definite?'failed':'unknown';a.error=(e as Error).message;
      if(e instanceof ProviderError&&e.notSent){a.actual='0';a.actualSource='Оптимизация не отправлена';}
      const parent=p.jobs.find(j=>j.id===job.id)!;if(parent.promptOptimization)parent.promptOptimization.state='failed';});
    throw new ProviderError(`Не удалось подготовить компактный промпт: ${(e as Error).message} Изображение или видео не запрашивалось.`,true,true);
  }
}
