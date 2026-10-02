import type {Project} from './domain';
import {money} from './domain';
import {MODELS} from './models';
import {isScriptWorkflowRun,scriptWorkflowResultSchema,scriptTaskChain} from './script-workflow';
import {scriptVariantLabel} from './script-labels';
import type {ComparisonVersion} from './version-comparison';

export type ScriptComparisonVersion=ComparisonVersion&{variantId?:string;runId?:string;taskId?:string};

/** The comparison catalog is read-only and always belongs to this film. */
export function scriptComparisonVersions(p:Project):ScriptComparisonVersion[]{
  const versions:ScriptComparisonVersion[]=[];
  for(const item of p.items.filter(i=>i.stage===0&&!i.removedAt&&!i.planArchive))for(const v of item.variants){
    if(v.kind!=='text'||!v.text.trim())continue;
    const job=p.jobs.find(j=>j.id===v.jobId);
    versions.push({id:`variant-${v.id}`,variantId:v.id,label:`Сценарий · ${scriptVariantLabel(p,v)}`,text:v.text,
      metadata:{created:v.created,origin:'Вариант общего сценария',model:MODELS.find(m=>m.id===v.model)?.name??v.model,
        ...(job?{actualCost:money(job.actual)}:{})}});
  }
  for(const run of [...(p.directing?.runs??[])].reverse()){
    if(!isScriptWorkflowRun(run))continue;
    const when=new Date(run.created).toLocaleString('ru-RU');
    for(const task of run.tasks){
      const result=scriptWorkflowResultSchema.safeParse(task.result);
      if(!task.applied||task.error||!result.success)continue;
      const job=p.jobs.find(j=>j.id===task.jobId);
      const chain=scriptTaskChain(p,run,task.id),pass=(p.directing?.runs.filter(isScriptWorkflowRun).findIndex(r=>r.id===run.id)??0)+1;
      versions.push({id:`task-${task.id}`,runId:run.id,taskId:task.id,
        label:`${chain} · ${result.data.title} · проход ${pass}, шаг ${run.tasks.indexOf(task)+1} · ${when}`,text:result.data.text,
        metadata:{created:run.created,origin:chain,model:MODELS.find(m=>m.id===run.model)?.name??run.model,
          settings:{Жанр:run.scriptInput.brief.genre,'Режиссёрский подход':run.scriptInput.brief.director},actualCost:money(job?.actual??null)}});
    }
    // Keep an older frozen source when the editable original has changed.
    if(!versions.some(v=>v.text===run.scriptInput.text&&(v.variantId===run.scriptInput.sourceVariantId||v.id.startsWith('input-')))){
      versions.push({id:`input-${run.id}`,label:`Исходник запуска · ${run.scriptInput.sourceTitle} · ${when}`,text:run.scriptInput.text,
        metadata:{created:run.created,origin:'Сохранённый исходник запуска'}});
    }
  }
  return versions;
}
