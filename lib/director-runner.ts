import {queueSlotIssue} from './queue-policy';
import { loadProject, mutate, getKey, imageData } from './server';
import { model } from './models';
import { generate } from './providers';
import { now, assertBudget } from './domain';
import { directorBasis, directorRunBasis, directorJob, taskReady, parseDirectorJSON, applyDirectorResult,publishDirectorScript } from './directing';
import {normalizeDirectorAnswer,scheduleDirectorFallback} from './director-reliability';

// All admission and task dependencies are decided on the server. CAS claims
// prevent two tabs/workers from sending the same paid request twice.
export async function runDirectorStep(user:string,projectId:string,options:{dispatch?:boolean}={}){
  const snapshot=await loadProject(user,projectId);
  const expired=snapshot.jobs.some(j=>j.purpose==='directing'&&j.status==='dispatching'&&Date.now()-Date.parse(j.started??j.created)>15*60*1000);
  const ready=options.dispatch!==false&&snapshot.directing?.runs.some(r=>!r.stopped&&(r.basis!==directorRunBasis(snapshot,r)||r.tasks.some(t=>taskReady(r,t))));
  if(!expired&&!ready)return snapshot;
  const claimed:string[]=[];
  let p=await mutate(user,projectId,p=>{
    claimed.length=0;
    const d=p.directing;if(!d)return;
    for(const run of d.runs){
      for(const t of run.tasks){const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='dispatching'&&Date.now()-Date.parse(j.started??j.created)>15*60*1000){j.status='unknown';j.error='Прервалось ожидание ответа. Проверьте расход; автоматического повтора нет.';t.error=j.error;}}
      if(options.dispatch===false)continue; // Hosted watchdog cannot claim a synchronous paid task.
      if(run.stopped)continue;
      if(run.basis!==directorRunBasis(p,run)){run.stopped=true;run.queueIssue='Основа задания изменилась; дальнейшая проработка остановлена.';continue;}
      const waiting=run as typeof run&{queueIssue?:string};waiting.queueIssue=undefined;
      for(const t of run.tasks.filter(t=>taskReady(run,t))){
        const j=directorJob(p,run,t),issue=queueSlotIssue(p,j,new Set(),t);
        if(issue){if(issue.includes('неизвестным исходом'))waiting.queueIssue=issue;continue;}
        assertBudget(p,[j]);j.status='dispatching';j.started=now();t.jobId=j.id;p.jobs.push(j);claimed.push(j.id);
      }
    }
  });
  await Promise.allSettled(claimed.map(async jobId=>{
    const job=p.jobs.find(j=>j.id===jobId)!;
    let sent=false;
    try{
      const key=await getKey(user,model(job.model).provider);
      const refs=await Promise.all(job.refs.map(ref=>imageData(user,ref,p)));
      sent=true;
      const result=await generate(job,key,refs,p.format);
      await mutate(user,projectId,current=>{
        const j=current.jobs.find(j=>j.id===jobId)!;
        j.requestId=result.requestId;j.usage=result.usage;j.actual=result.actual??null;
        if(result.actual!=null)j.actualSource='Ответ API';
        j.output={text:result.text};
        const run=current.directing?.runs.find(r=>r.id===j.batchId),task=run?.tasks.find(t=>t.jobId===jobId);
        if(!run||!task){j.status='failed';j.error='Задание удалено; ответ сохранён.';return;}
        try{
          if(result.error)throw Error(result.error);
          const data=normalizeDirectorAnswer(current,task.role,task.sceneId,parseDirectorJSON(result.text??''));
          const proposal=structuredClone(current),proposedRun=proposal.directing!.runs.find(r=>r.id===run.id)!,proposedTask=proposedRun.tasks.find(t=>t.id===task.id)!;
          applyDirectorResult(proposal,proposedRun,proposedTask,data);
          const completed=proposal.jobs.find(j=>j.id===jobId)!;completed.status='done';completed.error=proposedTask.error;
          if(proposedRun.mode==='compress'&&!proposedRun.stopped&&!proposedRun.published&&proposedRun.tasks.every(t=>t.applied)){publishDirectorScript(proposal);proposedRun.published=true;}
          Object.assign(current,proposal);
        }catch(e){task.error=e instanceof Error?e.message:String(e);j.status='failed';j.error='Ответ получен, но требует правки: '+task.error;scheduleDirectorFallback(current,run,task,j,true);}
      });
    }catch(e){
      await mutate(user,projectId,current=>{
        const j=current.jobs.find(j=>j.id===jobId)!;
        if(j.status==='done'||j.status==='failed')return;
        const notSent=!sent||(e as {notSent?:boolean}).notSent;
        const definite=notSent||(e as {definite?:boolean}).definite;
        j.status=definite?'failed':'unknown';j.error=e instanceof Error?e.message:String(e);
        if(notSent){j.actual='0';j.actualSource='Запрос не отправлен';}
        const run=current.directing?.runs.find(r=>r.id===j.batchId),t=run?.tasks.find(t=>t.jobId===jobId);if(t&&run){t.error=j.error;scheduleDirectorFallback(current,run,t,j);}
      });
    }
  }));
  return loadProject(user,projectId);
}
