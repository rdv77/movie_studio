'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import type {Project} from '@/lib/domain';
import {money} from '@/lib/domain';
import {directorRunActive} from '@/lib/directing';
import {VersionComparison,type ComparisonVersion} from './version-comparison';
import {SCRIPT_ROLES,SCRIPT_ROLE_NAMES,CINEMA_METHODS,CINEMA_METHOD_IDS,CINEMA_METHODS_NOTE,
  isScriptWorkflowRun,scriptWorkflowResultSchema,createScriptWorkflowRun,scriptWorkflowPrompt,type ScriptRole,type ScriptWorkflowRun} from '@/lib/script-workflow';
import type {CinemaMethodId} from '@/lib/cinema-methods';

type Props={p:Project;model:string;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>};
export function ScriptWorkflowEditor({p,model,busy,submit}:Props){
  const uid=useId();
  const item=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive);
  const sources=item?.variants.filter(v=>v.kind==='text'&&!!v.text.trim())??[];
  const [sourceVariantId,setSourceVariantId]=useState(item?.selectedId??sources[0]?.id??'');
  const [roles,setRoles]=useState<ScriptRole[]>([...SCRIPT_ROLES]);
  const [methodologyIds,setMethodologyIds]=useState<CinemaMethodId[]>([...CINEMA_METHOD_IDS]);
  const [promptOverrides,setPromptOverrides]=useState<Partial<Record<ScriptRole,string>>>({});
  const [branch,setBranch]=useState<{taskId:string;label:string;sourceVariantId:string}>();
  const [operation,setOperation]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [promptPreview,setPromptPreview]=useState('');
  useEffect(()=>{setSourceVariantId(item?.selectedId??sources[0]?.id??'');setBranch(undefined);setError('');setNotice('');},[p.id]);
  useEffect(()=>{setPromptPreview('');},[p,model,sourceVariantId,branch?.taskId,roles,methodologyIds,promptOverrides]);
  const runs=(p.directing?.runs??[]).flatMap(r=>isScriptWorkflowRun(r)?[r]:[]);
  const running=(p.directing?.runs??[]).some(directorRunActive);
  const locked=busy||operation||running;
  const source=sources.find(v=>v.id===sourceVariantId);
  const perform=async(action:string,data:unknown,message:string)=>{
    setOperation(true);setError('');setNotice('');
    try{await submit(action,data);setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Действие не выполнено.');}finally{setOperation(false);}
  };
  const start=(selectedRoles:ScriptRole[])=>perform('scriptRun',{model,roles:selectedRoles,sourceVariantId,sourceTaskId:branch?.taskId,methodologyIds,promptOverrides},'Цепочка поставлена в очередь. Результаты появятся ниже.');
  const preview=()=>{setError('');setPromptPreview('');try{const copy=structuredClone(p),run=createScriptWorkflowRun(copy,model,roles,sourceVariantId,branch?.taskId,{methodologyIds,promptOverrides});setPromptPreview(scriptWorkflowPrompt(copy,run,run.tasks[0]));}catch(e){setError(e instanceof Error?e.message:'Не удалось подготовить промпт.');}};
  const chooseBranch=(run:ScriptWorkflowRun,taskId:string,label:string)=>{setSourceVariantId(run.scriptInput.sourceVariantId);setBranch({taskId,label,sourceVariantId:run.scriptInput.sourceVariantId});setError('');setNotice('Настройте специалистов и запустите новую ветку от этого результата.');};
  return <section className="space-y-4 rounded border border-border p-4" aria-label="Команда разработки общего сценария">
    <h3 className="font-medium">Команда разработки общего сценария</h3>
    <p className="text-sm text-muted-foreground">Выберите исходный текст и специалистов. Каждый проход создаёт один кандидат. Сравните результаты и добавьте подходящий в варианты сценария; выбор и утверждение выполняются отдельно.</p>
    <label className="block space-y-2" htmlFor={`${uid}-source`}><span className="text-sm font-medium">Исходный вариант сценария</span>
      <select id={`${uid}-source`} className="w-full rounded border border-input bg-background p-2 text-sm" disabled={locked} value={sourceVariantId} onChange={e=>{setSourceVariantId(e.target.value);setBranch(undefined);}}>
        {!sources.length&&<option value="">Сначала добавьте исходный сценарий</option>}
        {!!sourceVariantId&&!source&&<option value={sourceVariantId}>Исходная версия недоступна — восстановите её из истории</option>}
        {sources.map(v=><option key={v.id} value={v.id}>{v.title}{item?.approvedId===v.id?' · утверждён':item?.selectedId===v.id?' · выбран':''}</option>)}
      </select>
    </label>
    {source&&<details><summary className="cursor-pointer text-sm">Посмотреть исходный текст</summary><p className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm">{source.text}</p></details>}
    {branch&&<div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-3"><p className="text-sm">Новая ветка от результата: <b>{branch.label}</b>. Используется его полный текст и текущее сохранённое творческое задание.</p><Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>setBranch(undefined)}>Вернуться к исходному варианту</Button></div>}
    <fieldset className="space-y-3"><legend className="text-sm font-medium">Каких специалистов привлекать</legend>
      <div className="grid gap-3 sm:grid-cols-2">{SCRIPT_ROLES.map(role=><label key={role} className="flex items-center gap-2 rounded border border-border p-3 text-sm">
        <input type="checkbox" checked={roles.includes(role)} disabled={locked} onChange={e=>setRoles(current=>e.target.checked?[...current,role]:current.filter(v=>v!==role))}/>{SCRIPT_ROLE_NAMES[role]}
      </label>)}</div>
      <p className="text-xs text-muted-foreground">Порядок: адаптация → критик → драматург → продюсер → контроль. Пропущенный шаг не вызывает модель. Критик и контроль предлагают решения, сохраняя текст кандидата.</p>
    </fieldset>
    <details><summary className="cursor-pointer text-sm font-medium">Методические карточки · {methodologyIds.length}/{CINEMA_METHODS.length}</summary>
      <p className="my-3 text-xs text-muted-foreground">{CINEMA_METHODS_NOTE}</p><div className="space-y-3">{CINEMA_METHODS.map(method=><article key={method.id} className="space-y-2 rounded border border-border p-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={methodologyIds.includes(method.id)} onChange={e=>setMethodologyIds(current=>e.target.checked?[...current,method.id]:current.filter(v=>v!==method.id))}/><b>{method.title}</b></label>
        <ul className="ml-5 list-disc space-y-1 text-xs text-muted-foreground">{method.checks.map(check=><li key={check}>{check}</li>)}</ul>
        <a className="text-xs underline" href={method.sourceUrl} target="_blank" rel="noreferrer">{method.sourceTitle}</a>
      </article>)}</div>
    </details>
    <details><summary className="cursor-pointer text-sm font-medium">Дополнительные задания специалистам</summary>
      <div className="mt-3 space-y-3">{SCRIPT_ROLES.map(role=><label key={role} className="block space-y-2" htmlFor={`${uid}-${role}`}><span className="text-sm">{SCRIPT_ROLE_NAMES[role]}</span><Textarea id={`${uid}-${role}`} rows={3} maxLength={6000} disabled={locked} value={promptOverrides[role]??''} onChange={e=>setPromptOverrides(current=>({...current,[role]:e.target.value}))} placeholder="Пожелания для этого специалиста; обязательные условия фильма сохраняются"/></label>)}</div>
    </details>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||!source||!roles.length||!p.directing} onClick={()=>start(roles)}>{roles.length===SCRIPT_ROLES.length?'Создать весь этап · команда сценария':'Запустить выбранные шаги'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={locked||!source||!roles.length||!p.directing} onClick={preview}>Промпт первого выбранного шага</Button>
      {SCRIPT_ROLES.map(role=><Button type="button" key={role} size="sm" variant="outline" disabled={locked||!source||!p.directing} onClick={()=>start([role])}>Только {SCRIPT_ROLE_NAMES[role].toLocaleLowerCase('ru')}</Button>)}
    </div>
    {promptPreview&&<details open className="space-y-2"><summary className="cursor-pointer text-sm">Предпросмотр первого запроса</summary><p className="text-xs text-muted-foreground">Просмотр не запускает модель. Промпты следующих шагов зависят от ответов предыдущих; фактически отправленные запросы появятся в результатах ниже.</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{promptPreview}</pre></details>}
    {running&&<p className="text-sm text-muted-foreground">Идёт проработка. Можно читать и сравнивать сохранённые результаты. Остановка дальнейших шагов доступна в блоке «Работа команды».</p>}
    {!p.directing&&<p className="text-sm text-muted-foreground">Сначала сохраните творческое задание фильма.</p>}
    {!!error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{!!notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {[...runs].reverse().map((run,n)=>{
      const completed=run.tasks.flatMap(task=>{const parsed=scriptWorkflowResultSchema.safeParse(task.result);return parsed.success?[{task,result:parsed.data}]:[];});
      const versions:ComparisonVersion[]=[{id:`input-${run.id}`,label:'Замороженный исходный текст',text:run.scriptInput.text,selectable:false,metadata:{created:run.created,origin:'Замороженный исходник'}},
        ...completed.map(({task,result})=>({id:task.id,label:SCRIPT_ROLE_NAMES[task.role]+' · '+result.title,text:result.text,metadata:{created:run.created,model:run.model,origin:SCRIPT_ROLE_NAMES[task.role],actualCost:money(p.jobs.find(j=>j.id===task.jobId)?.actual??null)}}))];
      return <details key={run.id} open={n===0} className="space-y-3 rounded border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{new Date(run.created).toLocaleString('ru')} · {run.tasks.filter(t=>t.applied).length}/{run.tasks.length} · {run.stopped?'Остановлен':directorRunActive(run)?'В работе':run.tasks.some(t=>t.error)?'Требует внимания':'Завершён'}</summary>
        <p className="text-xs text-muted-foreground">Основа и настройки этого запуска сохранены отдельно. Утверждённые материалы фильма сохраняются до вашего выбора.</p>
        <details><summary className="cursor-pointer text-xs">Творческое задание этого запуска</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(run.scriptInput.brief,null,2)}</pre></details>
        {completed.length>0&&<VersionComparison key={run.id} versions={versions} title="Сравнить исходный текст и результаты специалистов" initialLeftId={`input-${run.id}`} initialRightId={completed.at(-1)?.task.id}/>}
        <div className="space-y-3">{run.tasks.map(task=>{
          const job=p.jobs.find(j=>j.id===task.jobId),parsed=scriptWorkflowResultSchema.safeParse(task.result),data=parsed.success?parsed.data:undefined;
          const imported=!!task.importedVariantId&&!!item?.variants.some(v=>v.id===task.importedVariantId);
          return <article key={task.id} className="space-y-3 rounded border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{SCRIPT_ROLE_NAMES[task.role]}</b><span className="text-xs text-muted-foreground">{task.error?'Требует внимания':task.applied?'Готово':job?'В работе':run.stopped?'Не запущен':'Ожидает предыдущий шаг'}{job&&<> · расход: {money(job.actual)}</>}</span></div>
            {task.lateResult&&<p className="text-xs text-muted-foreground">Ответ получен после остановки; следующие шаги не запускались.</p>}
            {task.error&&<p role="alert" className="text-sm text-destructive">{task.error}</p>}
            {data&&<><h4 className="text-sm font-medium">{data.title}</h4>{data.changes.length>0&&<ul className="ml-5 list-disc space-y-1 text-sm">{data.changes.map((change,i)=><li key={i}>{change}</li>)}</ul>}
              {data.findings.map((finding,i)=><div key={i} className="space-y-1 rounded border border-border p-2 text-sm"><p><b>{finding.severity==='conflict'?'Конфликт':'Замечание'}:</b> {finding.evidence}</p><p><b>Предложенное решение:</b> {finding.proposal}</p>{finding.requiresDirectorChoice&&<small className="text-muted-foreground">Нужен творческий выбор режиссёра.</small>}</div>)}
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||operation||!task.applied||!!task.error||imported} onClick={()=>perform('importScriptCandidate',{runId:run.id,taskId:task.id},'Кандидат добавлен в варианты общего сценария. Текущий выбор и утверждение сохранены.')}>{imported?'✓ Добавлен в варианты':'Добавить как вариант сценария'}</Button><Button type="button" size="sm" variant="outline" disabled={locked||!task.applied||!!task.error} onClick={()=>chooseBranch(run,task.id,SCRIPT_ROLE_NAMES[task.role]+' · '+data.title)}>Продолжить с этого результата</Button></div>
            </>}
            {job&&<details><summary className="cursor-pointer text-xs">Фактически отправленный промпт</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{job.prompt}</pre></details>}
          </article>;
        })}</div>
      </details>;
    })}
  </section>;
}
