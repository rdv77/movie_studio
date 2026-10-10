'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {money,type Project} from '@/lib/domain';
import {CINEMA_RESEARCH_MODELS,cinemaReferenceCurrent,cinemaSourceUrl,referenceCanUse,type CinemaReferenceRun,type CinemaReferenceScope} from '@/lib/cinema-references';
import {VersionComparison} from './version-comparison';
import {scriptVariantLabel} from '@/lib/script-labels';

type Props={p:Project;stage:number;busy:boolean;submit:(action:string,data:unknown)=>Promise<void>;embedded?:boolean;sourceVariantId?:string;onDirtyChange?:(dirty:boolean)=>void};
const scopeKey=(scope:CinemaReferenceScope)=>scope.kind==='script'?'script:'+scope.variantId:scope.kind==='scene'?'scene:'+scope.sceneId:'shot:'+scope.sceneId+':'+scope.shotId;
const statusNames:Record<string,string>={queued:'В очереди',dispatching:'Исследование выполняется',pending:'Ожидается ответ',saving:'Сохранение',done:'Готово',failed:'Ошибка',unknown:'Исход неизвестен',cancelled:'Остановлено'};
const activeStatuses=['queued','dispatching','pending','saving'];

/** Research and adoption are separate: looking at a reference never changes an approved film. */
export function CinemaReferencesPanel({p,stage,busy,submit,embedded=false,sourceVariantId,onDirtyChange}:Props){
  const uid=useId(),script=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive);
  const scripts=p.items.filter(i=>i.stage===0&&!i.removedAt&&!i.planArchive).flatMap(i=>i.variants.filter(v=>v.kind==='text'&&v.text.trim()));
  const scenes=p.directing?.scenes??[],scriptStage=stage===0||stage===13,generalStage=stage===0;
  const [kind,setKind]=useState<'script'|'scene'|'shot'>(scriptStage?'script':'scene');
  const [variantId,setVariantId]=useState(sourceVariantId??script?.selectedId??scripts[0]?.id??'');
  const [sceneId,setSceneId]=useState(scenes[0]?.id??''),[shotId,setShotId]=useState('');
  const [model,setModel]=useState(CINEMA_RESEARCH_MODELS[0].id),[question,setQuestion]=useState('');
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [checked,setChecked]=useState<Record<string,string[]>>({});
  const scene=scenes.find(s=>s.id===sceneId)??scenes[0],shot=scene?.shots.find(s=>s.id===shotId)??scene?.shots[0];
  const sourceId=sourceVariantId??variantId,targetKind=generalStage?'script':kind;
  useEffect(()=>{if(!variantId||!scripts.some(v=>v.id===variantId))setVariantId(script?.selectedId??scripts[0]?.id??'');},[script?.selectedId,scripts.length,variantId]);
  const scope:CinemaReferenceScope|undefined=targetKind==='script'?(scripts.some(v=>v.id===sourceId)?{kind:targetKind,variantId:sourceId}:undefined):scene?(targetKind==='scene'?{kind:targetKind,sceneId:scene.id}:shot?{kind:targetKind,sceneId:scene.id,shotId:shot.id}:undefined):undefined;
  const runs=p.cinemaReferences?.runs??[],matching=scope?runs.filter(r=>scopeKey(r.scope)===scopeKey(scope)):[];
  const latest=matching.at(-1),active=matching.filter(r=>p.jobs.some(j=>j.id===r.jobId&&activeStatuses.includes(j.status)));
  const savedIds=(runId:string)=>{
    const run=runs.find(row=>row.id===runId),selection=p.cinemaReferences?.selections.find(s=>s.runId===runId);
    const preparation=p.generalScenario?.preparations.findLast(row=>row.section==='cinema'&&row.status==='ready'&&row.result&&'runId' in row.result&&row.result.runId===runId);
    return run?.selectedCandidateIds??selection?.candidateIds??(preparation?.result&&'candidateIds' in preparation.result?preparation.result.candidateIds:[]);
  };
  const dirty=matching.some(run=>{const selected=checked[run.id],saved=savedIds(run.id);return selected&&(selected.length!==saved.length||selected.some(key=>!saved.includes(key)));});
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  const primary=matching.filter(r=>r===latest||active.includes(r)||p.cinemaReferences?.selections.some(s=>s.runId===r.id&&s.candidateIds.length>0)).reverse();
  const history=runs.filter(r=>!primary.includes(r)).slice().reverse();
  const pending=active.length>0,locked=busy||working;
  const perform=async(action:string,data:unknown,message:string)=>{setWorking(true);setError('');setNotice('');try{await submit(action,data);if(action==='select'){const runId=(data as {runId:string}).runId;setChecked(current=>{const next={...current};delete next[runId];return next;});}setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');}finally{setWorking(false);}};
  const start=(mode:'propose'|'apply')=>scope&&perform('start',{scope,mode,model,question},'Исследование добавлено в очередь. Предложения появятся в этом разделе.');
  const toggle=(runId:string,id:string)=>setChecked(current=>{const ids=current[runId]??savedIds(runId);return {...current,[runId]:ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]};});
  const renderRun=(run:CinemaReferenceRun)=>{
    const job=p.jobs.find(j=>j.id===run.jobId),saved=savedIds(run.id),selected=checked[run.id]??saved,draft=run.result?.draft,current=cinemaReferenceCurrent(p,run);
    const selectionChanged=selected.length!==saved.length||selected.some(id=>!saved.includes(id));
    return <article key={run.id} className="space-y-3" aria-label={`Исследование: ${run.input.sourceTitle}`}>
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{run.input.sourceTitle}</span><span className="text-muted-foreground">{new Date(run.created).toLocaleString('ru-RU')} · {job?statusNames[job.status]??job.status:'Сохранено'}</span></div>
      {job?.error&&<p role="alert" className="text-sm text-destructive">{job.error}</p>}
      {!current&&<p className="text-sm text-amber-700 dark:text-amber-300">Исходный материал изменился. Предложения сохранены; их можно повторно использовать для текущего сценария.</p>}
      {run.result&&<>
        <div className="grid gap-3 xl:grid-cols-2">{run.result.candidates.map(candidate=><article key={candidate.id} className="space-y-2 rounded border border-border p-3" aria-label={`Предложение: ${candidate.title}`}>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" aria-label={`Использовать: ${candidate.title}`} disabled={locked||!referenceCanUse(candidate)} checked={selected.includes(candidate.id)} onChange={()=>toggle(run.id,candidate.id)}/><strong>{candidate.title}</strong></label>
          <p className="text-sm whitespace-pre-wrap">{candidate.adaptation}</p>
          {!referenceCanUse(candidate)&&<p className="text-xs text-amber-700 dark:text-amber-300">Нет подтверждённого источника — применение недоступно.</p>}
          <details><summary className="cursor-pointer text-sm text-muted-foreground">Обоснование, источники и затраты</summary><div className="mt-3 space-y-2">
            <p className="text-sm"><b>Фильм-референс:</b> {candidate.film.title}{candidate.film.year?` (${candidate.film.year})`:''}</p>
            <p className="text-xs text-muted-foreground">Режиссёр: {candidate.film.director??'не установлен'} · Сценарист: {candidate.film.screenwriter??'не установлен'}</p>
            <p className="text-sm"><b>Сцена источника:</b> {candidate.sourceScene}</p><p className="text-sm"><b>Приём:</b> {candidate.technique}</p><p className="text-sm"><b>Эффект:</b> {candidate.effect}</p>
            <p className="text-sm font-medium">Что увидит зритель</p><ul className="ml-5 list-disc text-sm">{candidate.screenEvidence.map((text,n)=><li key={n}>{text}</li>)}</ul>
            <p className="text-sm font-medium">Изменения и затраты</p><ul className="ml-5 list-disc text-sm">{candidate.changes.map((text,n)=><li key={n}>{text}</li>)}</ul><p className="text-sm">Дополнительные планы: {candidate.additionalShots}. Новые локации: {candidate.additionalLocations.join('; ')||'не требуются'}. Оплата генераций считается отдельно.</p>{candidate.limitations.map((text,n)=><p className="text-sm text-muted-foreground" key={n}>{text}</p>)}
            <p className="text-sm font-medium">Источники и границы подтверждения</p><p className="text-xs text-muted-foreground">Источник подтверждает сведения о фильме. Предложение для нашего сценария — самостоятельная адаптация приёма.</p>{candidate.sources.map((source,n)=><div key={n} className="text-sm">{source.verification==='tool-source'&&cinemaSourceUrl(source.url)?<a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:<span>{source.title} · источник не подтверждён поиском</span>}<p>{source.support}</p></div>)}
          </div></details>
        </article>)}</div>
        {!!run.result.candidates.length&&<div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={locked||!selectionChanged||(!current&&selected.length>0)} onClick={()=>perform('select',{runId:run.id,candidateIds:selected},selected.length?'Предложения применены к настройкам следующего сценария. Существующие версии сохранены.':'Предложения отключены для следующих запусков.')}>Применить выбранные предложения</Button>{!selectionChanged&&saved.length>0&&<span className="text-xs text-muted-foreground">Выбрано предложений: {saved.length}</span>}{selectionChanged&&<span className="text-xs text-amber-700 dark:text-amber-300">Есть неприменённые изменения</span>}</div>
          <details><summary className="cursor-pointer text-sm text-muted-foreground">Повторно использовать эти приёмы</summary><div className="mt-2"><Button type="button" variant="outline" disabled={locked||!scope||!selected.length||pending||p.limit!==null} onClick={()=>scope&&perform('reuse',{runId:run.id,candidateIds:selected,scope,mode:'apply',model,question},'Доработка по сохранённым приёмам добавлена в очередь без нового поиска.')}>Применить выбранные в новом варианте</Button></div></details>
        </div>}
        {draft&&(generalStage?(run.scope.kind==='script'?<p className="text-sm">Новый сценарий «{draft.title}» доступен в <a href="#general-script-comparison" className="underline">сравнении общего сценария</a>.</p>:<p className="text-sm text-muted-foreground">Версия «{draft.title}» сохранена. Её можно применить на этапе разработки сцен и планов.</p>):<details><summary className="cursor-pointer font-medium">Новый вариант · {draft.title}</summary><div className="mt-3 space-y-3"><VersionComparison key={run.id} title="Сравнить исходник и вариант с кинореференсами" versions={[{id:'before',label:'Исходник · '+run.input.sourceTitle,text:run.input.text},{id:'after',label:'Кинореференсы · '+draft.title,text:draft.text}]} initialMode="full" allowFullText disabled={locked}/><p className="text-sm text-muted-foreground">{run.scope.kind==='script'?'Добавление сохранит отдельную версию общего сценария. Выберите и утвердите её на этапе «Общий сценарий».':'Применение перенесёт новую версию в указанную сцену или план, сохранив прежнюю в истории.'}</p><Button type="button" disabled={locked||!!run.importedVariantId||!!run.appliedAt||!current} onClick={()=>perform('import',{runId:run.id},run.scope.kind==='script'?'Добавлен отдельный вариант общего сценария.':'Новая версия применена. Предыдущая сохранена в истории.')}>{run.importedVariantId||run.appliedAt?'✓ Вариант перенесён':run.scope.kind==='script'?'Добавить как вариант сценария':'Применить эту версию'}</Button></div></details>)}
      </>}
      <details><summary className="cursor-pointer text-xs text-muted-foreground">Итог исследования и фактически отправленный промпт</summary><div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{CINEMA_RESEARCH_MODELS.find(m=>m.id===run.model)?.name??run.model} · {run.mode==='apply'?'Поиск и новый вариант':'Предложения'} · {money(job?.actual??null)}</p>{run.result&&<><p className="text-sm">{run.result.summary}</p>{run.result.limitations.map((text,n)=><p key={n} className="text-sm text-muted-foreground">{text}</p>)}</>}<p className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{run.input.text}</p>{job&&<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{job.prompt}</pre>}</div></details>
    </article>;
  };
  const content=<div className="space-y-4">
    {pending&&<p role="status" className="text-sm">Идёт генерация предложений. Можно просматривать прежние результаты.</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
    {primary.length?<div className="space-y-5">{primary.map(renderRun)}</div>:<p className="text-sm text-muted-foreground">Пока нет предложений для выбранного сценария.</p>}
    <details><summary className="cursor-pointer text-sm">Настройки поиска и отдельный запуск</summary><div className="mt-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {!generalStage&&<label className="space-y-2"><span className="block text-sm">Уровень исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="script">Общий сценарий</option><option value="scene" disabled={!scenes.length}>Сцена</option><option value="shot" disabled={!scenes.some(s=>s.shots.length)}>План</option></select></label>}
        <label className="space-y-2"><span className="block text-sm">Модель киноисследователя</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={model} onChange={e=>setModel(e.target.value)}>{CINEMA_RESEARCH_MODELS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </div>
      {targetKind==='script'?(sourceVariantId?<p className="text-sm text-muted-foreground">Источник: {scripts.find(v=>v.id===sourceVariantId)?.title??'Выберите источник общего сценария'}</p>:<label className="block space-y-2"><span className="text-sm">Исходный вариант сценария</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={variantId} onChange={e=>setVariantId(e.target.value)}>{!scripts.length&&<option value="">Сначала сохраните исходный сценарий</option>}{scripts.map(v=><option key={v.id} value={v.id}>{scriptVariantLabel(p,v)}{p.items.some(i=>i.stage===0&&i.approvedId===v.id)?' · утверждён':''}</option>)}</select></label>):<div className="grid gap-3 md:grid-cols-2"><label className="space-y-2"><span className="block text-sm">Сцена для исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={scene?.id??''} onChange={e=>{setSceneId(e.target.value);setShotId('');}}>{!scenes.length&&<option value="">Сначала подготовьте сцены</option>}{scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>{targetKind==='shot'&&<label className="space-y-2"><span className="block text-sm">План для исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={shot?.id??''} onChange={e=>setShotId(e.target.value)}>{!scene?.shots.length&&<option value="">В сцене пока нет планов</option>}{scene?.shots.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}</div>}
      <label className="block space-y-2" htmlFor={`${uid}-question`}><span className="text-sm">Какую задачу помочь решить?</span><Textarea id={`${uid}-question`} rows={3} maxLength={2000} disabled={locked} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Например: первое появление необычного существа. Можно оставить пустым."/></label>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||!scope||pending||!p.directing||p.limit!==null} onClick={()=>start('propose')}>Найти и предложить</Button><Button type="button" variant="outline" disabled={locked||!scope||pending||!p.directing||p.limit!==null} onClick={()=>start('apply')}>Найти и применить в новом варианте</Button></div>
      {!p.directing&&<p className="text-sm">Сначала сохраните творческое задание фильма.</p>}{p.limit!==null&&<p className="text-sm">Установлен жёсткий лимит бюджета. Цена поиска и текстового ответа заранее неизвестна, поэтому запуск заблокирован. Измените режим бюджета в настройках проекта.</p>}
      <p className="text-xs text-muted-foreground">Поиск и работа модели оплачиваются через подключение OpenAI или xAI. Сохранённые приёмы можно повторно применить без нового поиска. Расходы и ошибки доступны в журнале.</p>
    </div></details>
    {!!history.length&&<details><summary className="cursor-pointer text-sm">История и исследования других материалов · {history.length}</summary><div className="mt-4 space-y-5">{history.map(renderRun)}</div></details>}
    <details><summary className="cursor-pointer text-sm text-muted-foreground">Как работают кинореференсы</summary><p className="mt-2 text-sm text-muted-foreground">Исследователь ищет похожую драматургическую задачу и предлагает конкретное решение для нашего фильма. Отметьте подходящие предложения и примените их к настройкам следующей генерации. Готовые новые сценарии сравниваются и утверждаются наверху, в «Сравнении общего сценария».</p></details>
  </div>;
  return embedded?content:<details className="editor-surface p-5 mb-6" aria-label="Кинореференсы: учиться у мастеров"><summary className="cursor-pointer font-medium">Кинореференсы: учиться у мастеров · опционально{pending?' · идёт генерация':latest?.result?' · готово':''}</summary><div className="mt-4">{content}</div></details>;
}
