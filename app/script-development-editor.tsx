'use client';
import {useState} from 'react';
import type {Project} from '@/lib/domain';
import {MODELS} from '@/lib/models';
import {Button} from '@/components/ui/button';
import {ScriptWorkflowEditor} from './script-workflow-editor';

export function ScriptDevelopmentEditor({p,busy,submit,open}:{p:Project;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;open:(stage:number)=>void}){
  const [model,setModel]=useState(MODELS.find(m=>m.kind==='text'&&m.provider==='openai')!.id);
  return <section className="editor-surface p-5 mb-6 space-y-5" aria-label="Доработка сценария">
    <div className="row spread wrap"><label className="space-y-2"><span className="block text-sm font-medium">Модель сценарной команды</span>
      <select className="rounded border p-2 bg-background" aria-label="Модель сценарной команды" value={model} disabled={busy} onChange={e=>setModel(e.target.value)}>
        {MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label><Button type="button" variant="outline" onClick={()=>open(0)}>Исходный сценарий и творческое задание</Button></div>
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
