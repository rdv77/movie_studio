import {queueSlotIssue} from './queue-policy';
import { loadProject, mutate, getKey, imageData } from './server';
import { model } from './models';
import { generate } from './providers';
import { now, assertBudget } from './domain';
import { directorBasis, directorRunBasis, directorJob, taskReady, parseDirectorJSON, applyDirectorResult,publishDirectorScript } from './directing';
import {normalizeDirectorAnswer,scheduleDirectorFallback} from './director-reliability';
import type {Project} from './domain';

/** A ready dependency is not necessarily an admissible paid request. Waiting
 * on an unchanged queue refusal must not rewrite the whole project every tick. */
function directorAdvanceChanges(p:Project,dispatch=true){
  let preview:Project|undefined;
  for(const run of p.directing?.runs??[]){
    if(run.tasks.some(t=>{const j=p.jobs.find(j=>j.id===t.jobId);return j?.status==='dispatching'&&Date.now()-Date.parse(j.started??j.created)>15*60*1000;}))return true;
    if(!dispatch||run.stopped)continue;
    if(run.basis!==directorRunBasis(p,run))return true;
    const ready=run.tasks.filter(t=>taskReady(run,t));
    if(!ready.length)continue;
    let issue:string|undefined;
    for(const task of ready){
      // directorJob records an input basis on its task. Preserve the entire
      // project/run/task graph in the read-only preview: script workflows check
      // task ownership by identity, not just matching IDs.
      preview??=structuredClone(p);
      const previewRun=preview.directing!.runs.find(r=>r.id===run.id)!,previewTask=previewRun.tasks.find(t=>t.id===task.id)!;
      const candidate=directorJob(preview,previewRun,previewTask),blocked=queueSlotIssue(p,candidate,new Set(),task);
      if(!blocked)return true;
      if(blocked.includes('неизвестным исходом'))issue=blocked;
    }
    if(run.queueIssue!==issue)return true;
  }
  return false;
}
class DirectorQueueUnchanged extends Error {}

// All admission and task dependencies are decided on the server. CAS claims
// prevent two tabs/workers from sending the same paid request twice.
export async function runDirectorStep(user:string,projectId:string,options:{dispatch?:boolean}={}){
  const snapshot=await loadProject(user,projectId);
  if(!directorAdvanceChanges(snapshot,options.dispatch!==false))return snapshot;
  const claimed:string[]=[];
  let p:Project;
  try{p=await mutate(user,projectId,p=>{
    claimed.length=0;
    // Another tab may have recorded this queue issue or claimed the task since
    // the snapshot. Recheck inside CAS before saving or dispatching anything.
    if(!directorAdvanceChanges(p,options.dispatch!==false))throw new DirectorQueueUnchanged();
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
  });}catch(e){if(e instanceof DirectorQueueUnchanged)return loadProject(user,projectId);throw e;}
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
