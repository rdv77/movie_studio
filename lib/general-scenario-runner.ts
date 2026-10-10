import {loadProject,mutate,getKey,runtime} from './server';
import {model} from './models';
import {generate} from './providers';
import {now,type Project} from './domain';
import {queueSlotIssue} from './queue-policy';
import {parseDirectorJSON} from './directing';
import {generateCinemaResearch,type CinemaResearchReceipt} from './cinema-references-provider';
import {parseCinemaReferenceResult,referenceCanUse} from './cinema-references';
import {applyGeneralScenarioResult,reconcileGeneralScenario} from './general-scenario-workflow';
import type {MediaWorkScope} from './media-work-slot';
import {waitExpired,stopJobWait} from './job-wait';

type Receipt={text:string;requestId?:string;usage?:{inputTokens?:number;outputTokens?:number;[key:string]:unknown};actual:string|null;error?:string;cinema?:CinemaResearchReceipt;};
const receiptKey=(user:string,projectId:string,jobId:string)=>`general-scenario/${encodeURIComponent(user)}/${projectId}/${jobId}.json`;
function storeReceipt(p:Project,jobId:string,receipt:Receipt){
  const job=p.jobs.find(j=>j.id===jobId);if(!job||job.status==='done')return;
  job.output={text:receipt.text};job.requestId=receipt.requestId;job.actual=receipt.actual;job.usage=receipt.usage as typeof job.usage;
  if(receipt.actual!==null)job.actualSource='Ответ API';job.timings={...job.timings,providerCompletedAt:now(),finishedAt:now()};
  try{
    if(receipt.error)throw Error(receipt.error);
    let data:unknown;
    if(receipt.cinema){
      const prep=p.generalScenario?.preparations.find(x=>x.jobId===jobId),run=p.cinemaReferences?.runs.find(r=>r.id===prep?.cinemaRunId);if(!run)throw Error('Исследование не найдено; ответ сохранён.');
      run.sources=receipt.cinema.sources;run.searchPerformed=receipt.cinema.searchPerformed;run.result=parseCinemaReferenceResult(receipt.text,run,receipt.cinema.sources);
      const candidateIds=run.result.candidates.filter(referenceCanUse).map(c=>c.id);if(!candidateIds.length)throw Error('Поиск не дал пригодных предложений с подтверждёнными источниками. Можно повторить поиск или продолжить без кинореференсов.');
      data={runId:run.id,candidateIds};
    }else data=parseDirectorJSON(receipt.text);
    applyGeneralScenarioResult(p,jobId,data);
  }catch(error){job.status='failed';job.error='Ответ получен, но требует правки: '+(error instanceof Error?error.message:String(error));reconcileGeneralScenario(p);}
}
/** One claimed job, one provider POST. A retained private receipt is replayed
 * locally after a failed project write; it never submits another paid call. */
export async function runGeneralScenarioJob(user:string,projectId:string,jobId:string,scope?:MediaWorkScope){
  let p=await loadProject(user,projectId),job=p.jobs.find(j=>j.id===jobId);
  if(!job||job.purpose!=='general-scenario'||['done','failed','cancelled'].includes(job.status))return p;
  const stored=await runtime.FILES.get(receiptKey(user,projectId,jobId));
  if(stored){const receipt=JSON.parse(new TextDecoder().decode(await stored.arrayBuffer())) as Receipt;return mutate(user,projectId,current=>storeReceipt(current,jobId,receipt));}
  if(waitExpired(job))return mutate(user,projectId,current=>{const waiting=current.jobs.find(j=>j.id===jobId);if(waiting&&waitExpired(waiting)){stopJobWait(waiting,'timeout');reconcileGeneralScenario(current);}});
  if(job.status!=='queued')return p;
  let claimed=false;
  p=await mutate(user,projectId,current=>{
    claimed=false;const candidate=current.jobs.find(j=>j.id===jobId);if(!candidate||candidate.status!=='queued'||queueSlotIssue(current,candidate))return;
    if(current.limit!==null){candidate.status='failed';candidate.error='Для текстовой подготовки нет точной предварительной стоимости. Снимите жёсткий лимит или продолжите без ИИ.';candidate.actual='0';candidate.actualSource='Запрос не отправлен';reconcileGeneralScenario(current);return;}
    candidate.status='dispatching';candidate.started=now();candidate.timings={...candidate.timings,queuedAt:candidate.created,providerSubmittedAt:now()};claimed=true;reconcileGeneralScenario(current);
  });
  job=p.jobs.find(j=>j.id===jobId)!;if(!claimed||job.status!=='dispatching')return p;
  let sent=false,receipt:Receipt|undefined;
  try{
    const key=await getKey(user,model(job.model).provider),prep=p.generalScenario?.preparations.find(x=>x.jobId===jobId),research=p.cinemaReferences?.runs.find(r=>r.id===prep?.cinemaRunId);
    const run=async()=>{
      sent=true;
      if(research){const cinema=await generateCinemaResearch(research,job!.prompt,key);return {text:cinema.text,requestId:cinema.requestId,usage:cinema.usage,actual:cinema.actual,error:cinema.error,cinema} as Receipt;}
      const result=await generate(job!,key,[],p.format);return {text:result.text??'',requestId:result.requestId,usage:result.usage,actual:result.actual??null,error:result.error} as Receipt;
    };
    receipt=await (scope?scope.outside(run):run());
    await runtime.FILES.put(receiptKey(user,projectId,jobId),JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
    return await mutate(user,projectId,current=>storeReceipt(current,jobId,receipt!));
  }catch(error){
    return mutate(user,projectId,current=>{
      if(receipt){storeReceipt(current,jobId,receipt);return;}
      const failed=current.jobs.find(j=>j.id===jobId);if(!failed||failed.status==='done')return;
      const notSent=!sent||!!(error as {notSent?:boolean}).notSent,definite=notSent||!!(error as {definite?:boolean}).definite;
      failed.status=definite?'failed':'unknown';failed.error=error instanceof Error?error.message:'Не удалось завершить подготовку.';
      if(notSent){failed.actual='0';failed.actualSource='Запрос не отправлен';}reconcileGeneralScenario(current);
    });
  }
}
export async function advanceGeneralScenario(user:string,projectId:string){
  const before=await loadProject(user,projectId),copy=structuredClone(before);reconcileGeneralScenario(copy);
  let p=JSON.stringify(copy.generalScenario)!==JSON.stringify(before.generalScenario)||copy.jobs.length!==before.jobs.length?await mutate(user,projectId,reconcileGeneralScenario):before;
  const ids=p.jobs.filter(j=>j.purpose==='general-scenario'&&(j.status==='queued'&&!queueSlotIssue(p,j)||j.status==='unknown'&&!j.newSeriesAllowedAt||waitExpired(j))).slice(-3).map(j=>j.id);
  await Promise.allSettled(ids.map(jobId=>runGeneralScenarioJob(user,projectId,jobId)));
  return loadProject(user,projectId);
}
