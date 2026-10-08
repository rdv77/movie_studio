import {loadProject,mutate,getKey,runtime} from './server';
import {now,type Project,type Job} from './domain';
import {queueSlotIssue} from './queue-policy';
import {ProviderError,providerDetail} from './provider-http';
import {CINEMA_RESEARCH_MODELS,cinemaReferenceRun,cinemaReferenceCurrent,parseCinemaReferenceResult} from './cinema-references';
import {generateCinemaResearch,type CinemaResearchReceipt} from './cinema-references-provider';
import type {MediaWorkScope} from './media-work-slot';
const receiptKey=(user:string,p:string,j:string)=>`cinema-research/${encodeURIComponent(user)}/${p}/${j}.json`;
function storeReceipt(p:Project,job:Job,receipt:CinemaResearchReceipt){
  const run=cinemaReferenceRun(p,job.batchId);job.output={text:receipt.text};job.requestId=receipt.requestId;job.usage=receipt.usage;job.actual=receipt.actual;
  if(receipt.actual!==null)job.actualSource='Ответ API';run.sources=receipt.sources;run.searchPerformed=receipt.searchPerformed;
  job.timings={...job.timings,providerCompletedAt:now(),finishedAt:now()};
  if(receipt.error){job.status='failed';job.error=receipt.error;return;}
  try{run.result=parseCinemaReferenceResult(receipt.text,run,receipt.sources);job.status='done';job.error=job.waitStoppedAt?'Поздний ответ сохранён как предложение. Текущий сценарий не изменён.':undefined;}
  catch(error){job.status='failed';job.error=error instanceof Error?error.message:'Ответ требует исправления.';}
}
/** Paid POST is made once, outside CAS. A lost receipt never triggers an automatic retry. */
export async function runCinemaResearchStep(user:string,projectId:string,jobId:string,scope?:MediaWorkScope){
  let p=await loadProject(user,projectId),j=p.jobs.find(j=>j.id===jobId);if(!j||j.purpose!=='cinema-research')return p;
  if(j.status==='done'||j.status==='failed'||j.status==='cancelled')return p;
  if(j.status!=='queued'){
    const stored=await runtime.FILES.get(receiptKey(user,projectId,jobId));
    if(stored){const receipt=JSON.parse(new TextDecoder().decode(await stored.arrayBuffer())) as CinemaResearchReceipt;return mutate(user,projectId,current=>{const job=current.jobs.find(j=>j.id===jobId);if(job&&job.status!=='done')storeReceipt(current,job,receipt);});}
    return p;
  }
  let claimed=false;
  p=await mutate(user,projectId,current=>{
    claimed=false;
    const job=current.jobs.find(j=>j.id===jobId);if(!job||job.status!=='queued'||queueSlotIssue(current,job))return;
    const run=cinemaReferenceRun(current,job.batchId);
    if(current.limit!==null||!cinemaReferenceCurrent(current,run)){job.status='cancelled';job.actual='0';job.actualSource='Запрос не отправлен';job.error=current.limit!==null?'Неизвестную стоимость поиска нельзя отправить при жёстком лимите.':'Исходный материал изменился до поиска. Создайте новое исследование.';return;}
    job.status='dispatching';job.started=now();job.timings={...job.timings,queuedAt:job.created,providerSubmittedAt:now()};claimed=true;
  });
  j=p.jobs.find(j=>j.id===jobId)!;if(!claimed||j.status!=='dispatching')return p;
  let key='',received:CinemaResearchReceipt|undefined;
  try{
    const run=cinemaReferenceRun(p,j.batchId),m=CINEMA_RESEARCH_MODELS.find(m=>m.id===j!.model)!;key=await getKey(user,m.provider);
    p=undefined!;
    received=await (scope?scope.outside(()=>generateCinemaResearch(run,j!.prompt,key)):generateCinemaResearch(run,j.prompt,key));
    // Save the received text before large project CAS. Recovery reads this private receipt without another paid request.
    await runtime.FILES.put(receiptKey(user,projectId,jobId),JSON.stringify(received),{httpMetadata:{contentType:'application/json'}});
    return await mutate(user,projectId,current=>{const job=current.jobs.find(j=>j.id===jobId);if(job&&job.status!=='done')storeReceipt(current,job,received!);});
  }catch(error){
    return mutate(user,projectId,current=>{
      const job=current.jobs.find(j=>j.id===jobId);if(!job||job.status==='done')return;
      if(received){storeReceipt(current,job,received);return;}
      const notSent=!key||error instanceof ProviderError&&error.notSent;
      job.status=notSent||error instanceof ProviderError&&error.definite?'failed':'unknown';
      job.error=providerDetail(error instanceof Error?error.message:'Не удалось завершить поиск.',key);
      if(notSent){job.actual='0';job.actualSource='Запрос не отправлен';}job.timings={...job.timings,finishedAt:now()};
    });
  }
}
