import type {Project,Variant} from './domain';
import {isScriptWorkflowRun,scriptTaskChain} from './script-workflow';

/** Use frozen provenance, never the film's currently edited settings. */
export function scriptVariantLabel(p:Project,v:Variant):string{
  const settings=v.versionInfo?.settings as {runId?:string;taskId?:string;brief?:{genre?:string;director?:string}}|undefined;
  const run=p.directing?.runs.find(r=>r.id===settings?.runId);
  const chain=isScriptWorkflowRun(run)&&settings?.taskId?scriptTaskChain(p,run,settings.taskId):'';
  if(chain){
    const pass=(p.directing?.runs.filter(isScriptWorkflowRun).findIndex(r=>r.id===run!.id)??0)+1;
    const step=isScriptWorkflowRun(run)?run.tasks.findIndex(t=>t.id===settings?.taskId)+1:0;
    return `${chain} · ${v.title} · проход ${pass}, шаг ${step} · ${new Date(v.created).toLocaleString('ru-RU')}`;
  }
  if(v.jobId&&settings?.brief)return ['Творческая адаптация',settings.brief.director,settings.brief.genre,v.title,new Date(v.created).toLocaleString('ru-RU')].filter(Boolean).join(' · ');
  return v.title;
}
