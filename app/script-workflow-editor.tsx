'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import type {Project} from '@/lib/domain';
import {money} from '@/lib/domain';
import {MODELS} from '@/lib/models';
import {directorRunActive} from '@/lib/directing';
import {VersionComparison,type ComparisonVersion} from './version-comparison';
import {scriptComparisonVersions} from '@/lib/script-comparison';
import {scriptVariantLabel} from '@/lib/script-labels';
import {SCRIPT_SPECIALIST_ROLES,SCRIPT_ROLE_NAMES,scriptTaskChain,CINEMA_METHODS,CINEMA_METHOD_IDS,CINEMA_METHODS_NOTE,
  isScriptWorkflowRun,isRecoverableUnsentScriptRun,scriptWorkflowResultSchema,createScriptWorkflowRun,scriptWorkflowPrompt,type ScriptRole,type ScriptWorkflowRun} from '@/lib/script-workflow';
import type {CinemaMethodId} from '@/lib/cinema-methods';

type Props={p:Project;model:string;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;openScenario?:()=>void};
export function ScriptWorkflowEditor({p,model,busy,submit,openScenario}:Props){
  const uid=useId();
  const item=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive);
  const sources=item?.variants.filter(v=>v.kind==='text'&&!!v.text.trim())??[];
  const [sourceVariantId,setSourceVariantId]=useState(item?.selectedId??sources[0]?.id??'');
  const [roles,setRoles]=useState<ScriptRole[]>([...SCRIPT_SPECIALIST_ROLES]);
  const [methodologyIds,setMethodologyIds]=useState<CinemaMethodId[]>([...CINEMA_METHOD_IDS]);
  const [promptOverrides,setPromptOverrides]=useState<Partial<Record<ScriptRole,string>>>({});
  const [branch,setBranch]=useState<{taskId:string;label:string;sourceVariantId:string}>();
  const [operation,setOperation]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [promptPreview,setPromptPreview]=useState('');
  useEffect(()=>{setSourceVariantId(item?.selectedId??sources[0]?.id??'');setBranch(undefined);setError('');setNotice('');},[p.id]);
  const preferredSourceId=item?.selectedId??sources[0]?.id??'';
  useEffect(()=>{setSourceVariantId(current=>current||preferredSourceId);},[preferredSourceId]);
  useEffect(()=>{setPromptPreview('');},[p,model,sourceVariantId,branch?.taskId,roles,methodologyIds,promptOverrides]);
  const runs=(p.directing?.runs??[]).flatMap(r=>isScriptWorkflowRun(r)?[r]:[]);
  const versions=scriptComparisonVersions(p);
  const [comparisonTarget,setComparisonTarget]=useState<string>();
  const [setupOpen,setSetupOpen]=useState(!runs.length);
  const running=(p.directing?.runs??[]).some(directorRunActive);
  const locked=busy||operation||running;
  const source=sources.find(v=>v.id===sourceVariantId);
  const perform=async(action:string,data:unknown,message:string)=>{
    setOperation(true);setError('');setNotice('');
    try{await submit(action,data);setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Действие не выполнено.');}finally{setOperation(false);}
  };
  const start=(selectedRoles:ScriptRole[])=>perform('scriptRun',{model,roles:selectedRoles,sourceVariantId,sourceTaskId:branch?.taskId,methodologyIds,promptOverrides},'Цепочка поставлена в очередь. Результаты появятся ниже.');
  const preview=()=>{setError('');setPromptPreview('');try{const copy=structuredClone(p),run=createScriptWorkflowRun(copy,model,roles,sourceVariantId,branch?.taskId,{methodologyIds,promptOverrides});setPromptPreview(scriptWorkflowPrompt(copy,run,run.tasks[0]));}catch(e){setError(e instanceof Error?e.message:'Не удалось подготовить промпт.');}};
  const chooseBranch=(run:ScriptWorkflowRun,taskId:string,label:string)=>{setSourceVariantId(run.scriptInput.sourceVariantId);setBranch({taskId,label,sourceVariantId:run.scriptInput.sourceVariantId});setSetupOpen(true);setError('');setNotice('Настройте специалистов и запустите новую ветку от этого результата.');};
  const renderVersionActions=(version:ComparisonVersion)=>{
    const entry=versions.find(v=>v.id===version.id),run=runs.find(r=>r.id===entry?.runId),task=run?.tasks.find(t=>t.id===entry?.taskId);
    if(!run||!task)return entry?.variantId&&openScenario?<Button type="button" size="sm" variant="outline" onClick={openScenario}>Открыть общий сценарий для выбора и утверждения</Button>:null;
    const parsed=scriptWorkflowResultSchema.safeParse(task.result);
    if(!parsed.success)return null;
    const data=parsed.data,imported=!!task.importedVariantId&&p.items.some(i=>i.stage===0&&!i.removedAt&&!i.planArchive&&i.variants.some(v=>v.id===task.importedVariantId)),job=p.jobs.find(j=>j.id===task.jobId);
    return <div className="space-y-3 border-t border-border pt-3">
      {['script-critic','script-control'].includes(task.role)&&<p className="text-xs text-muted-foreground">Это проверка: полный текст сохранён без изменений. Решения и замечания — в заключении ниже.</p>}
      <p className="text-xs text-muted-foreground">В варианты будет добавлен полный сценарий, показанный выше. Выбор и утверждение выполняются на этапе «Общий сценарий».</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||operation||!task.applied||!!task.error||imported} onClick={()=>perform('importScriptCandidate',{runId:run.id,taskId:task.id},'Полный сценарий добавлен в варианты. Текущий выбор и утверждение сохранены.')}>{imported?'✓ Добавлен в варианты':'Добавить полный сценарий в варианты'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={locked||!task.applied||!!task.error} onClick={()=>chooseBranch(run,task.id,scriptTaskChain(p,run,task.id)+' · '+data.title)}>Продолжить с этого результата</Button></div>
      {!!data.changes.length&&<details><summary className="cursor-pointer text-sm">Что изменено и почему</summary><ul className="ml-5 mt-2 list-disc space-y-1 text-sm">{data.changes.map((change,n)=><li key={n}>{change}</li>)}</ul></details>}
      {(data.findings.length>0||['script-critic','script-control'].includes(task.role))&&<details open={['script-critic','script-control'].includes(task.role)}><summary className="cursor-pointer text-sm">Заключение специалиста · {data.findings.length} замечаний</summary>
        {!data.findings.length&&<p className="mt-2 text-sm">Замечаний не предложено.</p>}{data.findings.map((finding,n)=><div key={n} className="mt-2 space-y-1 rounded border border-border p-2 text-sm"><p><b>{finding.severity==='conflict'?'Конфликт':'Замечание'}:</b> {finding.evidence}</p><p><b>Предложенное решение:</b> {finding.proposal}</p>{finding.requiresDirectorChoice&&<small className="text-muted-foreground">Нужен творческий выбор режиссёра.</small>}</div>)}
      </details>}
      {job&&<details><summary className="cursor-pointer text-xs">Фактически отправленный промпт</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{job.prompt}</pre></details>}
    </div>;
  };
  return <section className="space-y-4 rounded border border-border p-4" aria-label="Команда разработки общего сценария">
    <h3 className="font-medium">Команда разработки общего сценария</h3>
    <p className="text-sm text-muted-foreground">Дорабатываем сценарий, выбранный на первом этапе. Критик, драматург, продюсер и контроль используют сохранённый жанр и режиссёрский подход. Каждый проход сохраняется отдельно; готовый текст можно добавить в варианты общего сценария для выбора и утверждения.</p>
    {versions.length>1&&<VersionComparison key={p.id+':'+(comparisonTarget??'all')} versions={versions} title="Сравнить любые два сценария"
      initialLeftId={item?.selectedId?`variant-${item.selectedId}`:versions[0]?.id} initialRightId={comparisonTarget??versions.find(v=>v.taskId)?.id??versions[1]?.id}
      initialMode="full" allowFullText renderActions={renderVersionActions}/>}
    <details open={setupOpen} onToggle={e=>setSetupOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Настроить и запустить новый проход специалистов</summary><div className="mt-4 space-y-4">
    <label className="block space-y-2" htmlFor={`${uid}-source`}><span className="text-sm font-medium">Сценарий для доработки · выбранный на первом этапе</span>
      <select id={`${uid}-source`} className="w-full rounded border border-input bg-background p-2 text-sm" disabled={locked} value={sourceVariantId} onChange={e=>{setSourceVariantId(e.target.value);setBranch(undefined);}}>
        {!sources.length&&<option value="">Сначала добавьте исходный сценарий</option>}
        {!!sourceVariantId&&!source&&<option value={sourceVariantId}>Исходная версия недоступна — восстановите её из истории</option>}
        {sources.map(v=><option key={v.id} value={v.id}>{scriptVariantLabel(p,v)}{item?.approvedId===v.id?' · утверждён':item?.selectedId===v.id?' · выбран':''}</option>)}
      </select>
    </label>
    {source&&<details><summary className="cursor-pointer text-sm">Посмотреть исходный текст</summary><p className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm">{source.text}</p></details>}
    {branch&&<div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-3"><p className="text-sm">Новая ветка от результата: <b>{branch.label}</b>. Используется его полный текст и текущее сохранённое творческое задание.</p><Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>setBranch(undefined)}>Вернуться к исходному варианту</Button></div>}
    <fieldset className="space-y-3"><legend className="text-sm font-medium">Каких специалистов привлекать</legend>
      <div className="grid gap-3 sm:grid-cols-2">{SCRIPT_SPECIALIST_ROLES.map(role=><label key={role} className="flex items-center gap-2 rounded border border-border p-3 text-sm">
        <input type="checkbox" checked={roles.includes(role)} disabled={locked} onChange={e=>setRoles(current=>e.target.checked?[...current,role]:current.filter(v=>v!==role))}/>{SCRIPT_ROLE_NAMES[role]}
      </label>)}</div>
      <p className="text-xs text-muted-foreground">Порядок: критик → драматург → продюсер → контроль. Творческая адаптация выполняется на этапе «Общий сценарий». Пропущенный шаг не вызывает модель. Критик и контроль предлагают решения, сохраняя текст кандидата.</p>
    </fieldset>
    <details><summary className="cursor-pointer text-sm font-medium">Методические карточки · {methodologyIds.length}/{CINEMA_METHODS.length}</summary>
      <p className="my-3 text-xs text-muted-foreground">{CINEMA_METHODS_NOTE}</p><div className="space-y-3">{CINEMA_METHODS.map(method=><article key={method.id} className="space-y-2 rounded border border-border p-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={methodologyIds.includes(method.id)} onChange={e=>setMethodologyIds(current=>e.target.checked?[...current,method.id]:current.filter(v=>v!==method.id))}/><b>{method.title}</b></label>
        <p className="text-sm"><b>Принцип:</b> {method.principle}</p>
        <p className="text-xs text-muted-foreground">{method.example}</p>
        <p className="text-xs text-muted-foreground"><b>Границы применения:</b> {method.limits}</p>
        <ul className="ml-5 list-disc space-y-1 text-xs text-muted-foreground">{method.checks.map(check=><li key={check}>{check}</li>)}</ul>
        <a className="text-xs underline" href={method.sourceUrl} target="_blank" rel="noreferrer">{method.sourceTitle}</a>
      </article>)}</div>
    </details>
    <details><summary className="cursor-pointer text-sm font-medium">Дополнительные задания специалистам</summary>
      <div className="mt-3 space-y-3">{SCRIPT_SPECIALIST_ROLES.map(role=><label key={role} className="block space-y-2" htmlFor={`${uid}-${role}`}><span className="text-sm">{SCRIPT_ROLE_NAMES[role]}</span><Textarea id={`${uid}-${role}`} rows={3} maxLength={6000} disabled={locked} value={promptOverrides[role]??''} onChange={e=>setPromptOverrides(current=>({...current,[role]:e.target.value}))} placeholder="Пожелания для этого специалиста; обязательные условия фильма сохраняются"/></label>)}</div>
    </details>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||!source||!roles.length||!p.directing} onClick={()=>start(roles)}>{roles.length===SCRIPT_SPECIALIST_ROLES.length?'Создать весь этап · команда сценария':'Запустить выбранные шаги'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={locked||!source||!roles.length||!p.directing} onClick={preview}>Промпт первого выбранного шага</Button>
      {SCRIPT_SPECIALIST_ROLES.map(role=><Button type="button" key={role} size="sm" variant="outline" disabled={locked||!source||!p.directing} onClick={()=>start([role])}>Только {SCRIPT_ROLE_NAMES[role].toLocaleLowerCase('ru')}</Button>)}
    </div>
    {promptPreview&&<details open className="space-y-2"><summary className="cursor-pointer text-sm">Предпросмотр первого запроса</summary><p className="text-xs text-muted-foreground">Просмотр не запускает модель. Промпты следующих шагов зависят от ответов предыдущих; фактически отправленные запросы появятся в результатах ниже.</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{promptPreview}</pre></details>}
    </div></details>
    {running&&<p className="text-sm text-muted-foreground">Идёт проработка. Можно читать и сравнивать сохранённые результаты. Остановка дальнейших шагов доступна в блоке «Работа команды».</p>}
    {!p.directing&&<p className="text-sm text-muted-foreground">Сначала сохраните творческое задание фильма.</p>}
    {!!error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{!!notice&&<p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!!runs.length&&<details open={running||runs.some(r=>isRecoverableUnsentScriptRun(p,r))}><summary className="cursor-pointer text-sm font-medium">История запусков · {runs.length}</summary><div className="mt-3 space-y-3">{[...runs].reverse().map((run)=>{
      return <details key={run.id} open={directorRunActive(run)||isRecoverableUnsentScriptRun(p,run)} className="space-y-3 rounded border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{new Date(run.created).toLocaleString('ru')} · {run.tasks.filter(t=>t.applied).length}/{run.tasks.length} · {run.stopped?'Остановлен':directorRunActive(run)?'В работе':run.tasks.some(t=>t.error)?'Требует внимания':'Завершён'} · {run.tasks.map(t=>SCRIPT_ROLE_NAMES[t.role]).join(' → ')}</summary>
        <p className="text-xs text-muted-foreground">Основа и настройки этого запуска сохранены отдельно. Утверждённые материалы фильма сохраняются до вашего выбора.</p>
        {isRecoverableUnsentScriptRun(p,run)&&<div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm">Запрос к модели не отправлен. Можно продолжить этот запуск с сохранённым исходным текстом, настройками и моделью: {MODELS.find(m=>m.id===run.model)?.name??run.model}.</p>
          <Button type="button" size="sm" disabled={locked} onClick={()=>perform('resumeScriptRun',{runId:run.id},'Этот запуск продолжен с сохранённой основой. Результаты появятся ниже.')}>Продолжить этот запуск</Button>
        </div>}
        <details><summary className="cursor-pointer text-xs">Творческое задание этого запуска</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(run.scriptInput.brief,null,2)}</pre></details>
        <div className="space-y-3">{run.tasks.map(task=>{
          const job=p.jobs.find(j=>j.id===task.jobId),parsed=scriptWorkflowResultSchema.safeParse(task.result),data=parsed.success?parsed.data:undefined;
          return <article key={task.id} className="space-y-3 rounded border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{scriptTaskChain(p,run,task.id)}</b><span className="text-xs text-muted-foreground">{task.error?'Требует внимания':task.applied?'Готово':job?'В работе':run.stopped?'Не запущен':'Ожидает предыдущий шаг'}{job&&<> · расход: {money(job.actual)}</>}</span></div>
            {task.lateResult&&<p className="text-xs text-muted-foreground">Ответ получен после остановки; следующие шаги не запускались.</p>}
            {task.error&&<p role="alert" className="text-sm text-destructive">{task.error}</p>}
            {task.error&&<Button type="button" size="sm" variant="outline" disabled={busy||operation} onClick={()=>perform('retry',{runId:run.id,taskId:task.id,acknowledgeCost:true},'Повтор этого задания поставлен в очередь.')}>{job?.status==='unknown'?'Повторить с возможным повторным списанием':'Повторить только это задание'}</Button>}
            {data&&<><h4 className="text-sm font-medium">{data.title}</h4>
              <Button type="button" size="sm" variant="outline" onClick={()=>setComparisonTarget(`task-${task.id}`)}>Показать в сравнении</Button>
            </>}
            {job&&<details><summary className="cursor-pointer text-xs">Фактически отправленный промпт</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{job.prompt}</pre></details>}
          </article>;
        })}</div>
        {directorRunActive(run)&&<Button type="button" size="sm" variant="outline" disabled={busy||operation} onClick={()=>perform('stop',{runId:run.id},'Дальнейшие шаги остановлены. Уже отправленные запросы могут завершиться.')}>Остановить дальнейшую проработку</Button>}
      </details>;
    })}</div></details>}
  </section>;
}
