import { loadProject, mutate, getKey } from './server';
import { model } from './models';
import { generate } from './providers';
import { now, assertBudget } from './domain';
import { directorBasis, directorJob, taskReady, parseDirectorJSON, applyDirectorResult,publishDirectorScript } from './directing';

// All admission and task dependencies are decided on the server. CAS claims
// prevent two tabs/workers from sending the same paid request twice.
export async function runDirectorStep(user:string,projectId:string){
  const snapshot=await loadProject(user,projectId);
  const expired=snapshot.jobs.some(j=>j.purpose==='directing'&&j.status==='dispatching'&&Date.now()-Date.parse(j.started??j.created)>15*60*1000);
  const ready=snapshot.directing?.runs.some(r=>!r.stopped&&(r.basis!==directorBasis(snapshot)||r.tasks.some(t=>taskReady(r,t))));
  if(!expired&&!ready)return snapshot;
  const claimed:string[]=[];
  let p=await mutate(user,projectId,p=>{
    claimed.length=0;
    const d=p.directing;if(!d)return;
    for(const run of d.runs){
      for(const t of run.tasks){const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='dispatching'&&Date.now()-Date.parse(j.started??j.created)>15*60*1000){j.status='unknown';j.error='Прервалось ожидание ответа. Проверьте расход; автоматического повтора нет.';t.error=j.error;}}
      if(run.stopped)continue;
      if(run.basis!==directorBasis(p)){run.stopped=true;continue;}
      const occupied=p.jobs.filter(j=>j.purpose==='directing'&&j.status==='dispatching').length;
      for(const t of run.tasks.filter(t=>taskReady(run,t)).slice(0,Math.max(0,3-occupied))){
        const j=directorJob(p,run,t);assertBudget(p,[j]);j.status='dispatching';j.started=now();t.jobId=j.id;p.jobs.push(j);claimed.push(j.id);
      }
    }
  });
  await Promise.allSettled(claimed.map(async jobId=>{
    const job=p.jobs.find(j=>j.id===jobId)!;
    let sent=false;
    try{
      const key=await getKey(user,model(job.model).provider);
      sent=true;
      const result=await generate(job,key,[],p.format);
      await mutate(user,projectId,current=>{
        const j=current.jobs.find(j=>j.id===jobId)!;
        j.requestId=result.requestId;j.usage=result.usage;j.actual=result.actual??null;
        if(result.actual!=null)j.actualSource='Ответ API';
        j.output={text:result.text};
        const run=current.directing?.runs.find(r=>r.id===j.batchId),task=run?.tasks.find(t=>t.jobId===jobId);
        if(!run||!task){j.status='failed';j.error='Задание удалено; ответ сохранён.';return;}
        try{
          if(result.error)throw Error(result.error);
          const data=parseDirectorJSON(result.text??'');
          const proposal=structuredClone(current),proposedRun=proposal.directing!.runs.find(r=>r.id===run.id)!,proposedTask=proposedRun.tasks.find(t=>t.id===task.id)!;
          applyDirectorResult(proposal,proposedRun,proposedTask,data);
          const completed=proposal.jobs.find(j=>j.id===jobId)!;completed.status='done';completed.error=proposedTask.error;
          if(proposedRun.mode==='compress'&&!proposedRun.stopped&&!proposedRun.published&&proposedRun.tasks.every(t=>t.applied)){publishDirectorScript(proposal);proposedRun.published=true;}
          Object.assign(current,proposal);
        }catch(e){task.error=e instanceof Error?e.message:String(e);j.status='failed';j.error='Ответ получен, но требует правки: '+task.error;}
      });
    }catch(e){
      await mutate(user,projectId,current=>{
        const j=current.jobs.find(j=>j.id===jobId)!;
        if(j.status==='done'||j.status==='failed')return;
        const notSent=!sent||(e as {notSent?:boolean}).notSent;
        const definite=notSent||(e as {definite?:boolean}).definite;
        j.status=definite?'failed':'unknown';j.error=e instanceof Error?e.message:String(e);
        if(notSent){j.actual='0';j.actualSource='Запрос не отправлен';}
        const t=current.directing?.runs.flatMap(r=>r.tasks).find(t=>t.jobId===jobId);if(t)t.error=j.error;
      });
    }
  }));
  return loadProject(user,projectId);
}
