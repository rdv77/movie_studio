'use client';
import {useState} from 'react';
import type {Project} from '@/lib/domain';
import {MODELS} from '@/lib/models';
import {Button} from '@/components/ui/button';
import {ScriptWorkflowEditor} from './script-workflow-editor';
import {screenplayModel} from '@/lib/general-script-source';

export function ScriptDevelopmentEditor({p,busy,submit,open}:{p:Project;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;open:(stage:number)=>void}){
  const model=screenplayModel(p);
  return <section className="editor-surface p-5 mb-6 space-y-5" aria-label="Доработка сценария">
    <div className="row spread wrap"><p className="text-sm">Модель сценарной команды: {MODELS.find(m=>m.id===model)?.name??model} · выбор в «Параметрах фильма»</p><Button type="button" variant="outline" onClick={()=>open(0)}>Исходный сценарий и творческое задание</Button></div>
    {p.directing&&<details><summary className="cursor-pointer text-sm">Текущее творческое задание · {p.directing.brief.genre} · {p.directing.brief.director}</summary>
      <p className="mt-3 whitespace-pre-wrap text-sm">{p.directing.brief.effect}\n{p.directing.brief.techniques}\n{p.directing.brief.locked}</p>
      <p className="text-sm text-muted-foreground">Сохранение задания обновляет настройки. Каждый запуск специалистов создаёт отдельный результат.</p>
    </details>}
    <ScriptWorkflowEditor p={p} model={model} busy={busy} submit={submit} openScenario={()=>open(0)}/>
    <Button type="button" variant="outline" onClick={()=>open(12)}>Перейти к сценам</Button>
    {p.directing?.critic&&<details><summary className="cursor-pointer text-sm">Прежняя рецензия сценария</summary><p className="mt-3 whitespace-pre-wrap text-sm">{p.directing.critic.review}</p>
      {p.directing.critic.alternatives.map((v,n)=><details key={n}><summary>{v.title}</summary><p className="whitespace-pre-wrap text-sm">{v.text}</p><Button type="button" disabled={busy} onClick={()=>submit('useAlternative',{index:n})}>Добавить полный сценарий в варианты</Button></details>)}
    </details>}
  </section>;
}
