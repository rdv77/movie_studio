'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {money,type Project} from '@/lib/domain';
import {CINEMA_RESEARCH_MODELS,cinemaReferenceCurrent,cinemaSourceUrl,referenceCanUse,type CinemaReferenceScope} from '@/lib/cinema-references';
import {VersionComparison} from './version-comparison';
import {scriptVariantLabel} from '@/lib/script-labels';

type Props={p:Project;stage:number;busy:boolean;submit:(action:string,data:unknown)=>Promise<void>};
const scopeKey=(scope:CinemaReferenceScope)=>scope.kind==='script'?'script:'+scope.variantId:scope.kind==='scene'?'scene:'+scope.sceneId:'shot:'+scope.sceneId+':'+scope.shotId;
const statusNames:Record<string,string>={queued:'В очереди',dispatching:'Исследование выполняется',pending:'Ожидается ответ',saving:'Сохранение',done:'Готово',failed:'Ошибка',unknown:'Исход неизвестен',cancelled:'Остановлено'};

/** Research and adoption are separate: looking at a reference never changes an approved film. */
export function CinemaReferencesPanel({p,stage,busy,submit}:Props){
  const uid=useId(),script=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive);
  const scripts=script?.variants.filter(v=>v.kind==='text'&&v.text.trim())??[],scenes=p.directing?.scenes??[];
  const scriptStage=stage===0||stage===13;
  const [kind,setKind]=useState<'script'|'scene'|'shot'>(scriptStage?'script':'scene');
  const [variantId,setVariantId]=useState(script?.selectedId??scripts[0]?.id??'');
  const [sceneId,setSceneId]=useState(scenes[0]?.id??''),[shotId,setShotId]=useState('');
  const [model,setModel]=useState(CINEMA_RESEARCH_MODELS[0].id),[question,setQuestion]=useState('');
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [checked,setChecked]=useState<Record<string,string[]>>({}),[showLibrary,setShowLibrary]=useState(false);
  const scene=scenes.find(s=>s.id===sceneId)??scenes[0],shot=scene?.shots.find(s=>s.id===shotId)??scene?.shots[0];
  useEffect(()=>{if(!variantId)setVariantId(script?.selectedId??scripts[0]?.id??'');},[script?.selectedId,scripts.length,variantId]);
  const scope:CinemaReferenceScope|undefined=kind==='script'?(scripts.some(v=>v.id===variantId)?{kind,variantId}:undefined):scene?(kind==='scene'?{kind,sceneId:scene.id}:shot?{kind,sceneId:scene.id,shotId:shot.id}:undefined):undefined;
  const runs=p.cinemaReferences?.runs??[],visible=runs.filter(r=>showLibrary||kind==='script'&&r.scope.kind==='script'||scope&&scopeKey(r.scope)===scopeKey(scope));
  const pending=scope&&runs.some(r=>scopeKey(r.scope)===scopeKey(scope)&&p.jobs.some(j=>j.id===r.jobId&&['queued','dispatching','pending','saving'].includes(j.status)));
  const locked=busy||working;
  const perform=async(action:string,data:unknown,message:string)=>{setWorking(true);setError('');setNotice('');try{await submit(action,data);setNotice(message);}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');}finally{setWorking(false);}};
  const start=(mode:'propose'|'apply')=>scope&&perform('start',{scope,mode,model,question},'Исследование добавлено в очередь. Результат и использованные источники появятся ниже.');
  const toggle=(runId:string,id:string)=>setChecked(current=>{const ids=current[runId]??p.cinemaReferences?.selections.find(s=>s.runId===runId)?.candidateIds??[];return {...current,[runId]:ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]};});
  return <details className="editor-surface p-5 mb-6" aria-label="Кинореференсы: учиться у мастеров">
    <summary className="cursor-pointer font-medium">Кинореференсы: учиться у мастеров · опционально</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm">Ищем похожую драматургическую задачу и способы её решения в кино. Приём переносится в наш жанр, масштаб и мир; утверждённый материал сохраняется до вашего выбора.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2"><span className="block text-sm">Уровень исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="script">Общий сценарий</option><option value="scene" disabled={!scenes.length}>Сцена</option><option value="shot" disabled={!scenes.some(s=>s.shots.length)}>План</option></select></label>
        <label className="space-y-2"><span className="block text-sm">Модель киноисследователя</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={model} onChange={e=>setModel(e.target.value)}>{CINEMA_RESEARCH_MODELS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </div>
      {kind==='script'?<label className="block space-y-2"><span className="text-sm">Исходный вариант сценария</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={variantId} onChange={e=>setVariantId(e.target.value)}>{!scripts.length&&<option value="">Сначала сохраните исходный сценарий</option>}{scripts.map(v=><option key={v.id} value={v.id}>{scriptVariantLabel(p,v)}{script?.approvedId===v.id?' · утверждён':''}</option>)}</select></label>:<div className="grid gap-3 md:grid-cols-2"><label className="space-y-2"><span className="block text-sm">Сцена для исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={scene?.id??''} onChange={e=>{setSceneId(e.target.value);setShotId('');}}>{!scenes.length&&<option value="">Сначала подготовьте сцены</option>}{scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>{kind==='shot'&&<label className="space-y-2"><span className="block text-sm">План для исследования</span><select className="w-full rounded border bg-background p-2" disabled={locked} value={shot?.id??''} onChange={e=>setShotId(e.target.value)}>{!scene?.shots.length&&<option value="">В сцене пока нет планов</option>}{scene?.shots.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}</div>}
      <label className="block space-y-2" htmlFor={`${uid}-question`}><span className="text-sm">Какую задачу помочь решить?</span><Textarea id={`${uid}-question`} rows={3} maxLength={2000} disabled={locked} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Например: первое появление необычного существа; зритель замечает опасность раньше героя. Можно оставить пустым — исследователь определит задачу по материалу."/></label>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked||!scope||!!pending||!p.directing||p.limit!==null} onClick={()=>start('propose')}>Найти и предложить</Button><Button type="button" variant="outline" disabled={locked||!scope||!!pending||!p.directing||p.limit!==null} onClick={()=>start('apply')}>Найти и применить в новом варианте</Button></div>
      {!p.directing&&<p className="text-sm">Сначала сохраните творческое задание фильма.</p>}
      {p.limit!==null&&<p className="text-sm">Установлен жёсткий лимит бюджета. Цена поиска и текстового ответа заранее неизвестна, поэтому запуск заблокирован. Для работы киноисследователя измените режим бюджета в настройках проекта.</p>}
      <p className="text-xs text-muted-foreground">Поиск в интернете и работа модели оплачиваются через существующее подключение OpenAI или xAI. Повторное использование сохранённых приёмов не запускает новый веб-поиск. Стоимость и ошибки — в журнале. Для режима с применением результат сначала сохраняется отдельным черновиком.</p>
      {pending&&<p role="status" className="text-sm">Для этого материала уже выполняется исследование. Можно просматривать прежние результаты.</p>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
      {!!runs.length&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showLibrary} onChange={e=>setShowLibrary(e.target.checked)}/>Показать исследования всего фильма для повторного использования</label>}
      {[...visible].reverse().map(run=>{const job=p.jobs.find(j=>j.id===run.jobId),saved=p.cinemaReferences?.selections.find(s=>s.runId===run.id)?.candidateIds??[],selected=checked[run.id]??saved,draft=run.result?.draft,current=cinemaReferenceCurrent(p,run);return <article key={run.id} className="space-y-3 rounded border border-border p-4" aria-label={`Исследование: ${run.input.sourceTitle}`}>
        <div className="flex flex-wrap justify-between gap-2"><strong>{run.input.sourceTitle}</strong><small>{new Date(run.created).toLocaleString('ru-RU')}</small></div>
        <p className="text-xs text-muted-foreground">{CINEMA_RESEARCH_MODELS.find(m=>m.id===run.model)?.name??run.model} · {run.mode==='apply'?'Поиск и новый вариант':'Предложения'} · {job?statusNames[job.status]??job.status:'Сохранённый результат'} · {money(job?.actual??null)}</p>
        {job?.error&&<p role="alert" className="text-sm text-destructive">{job.error}</p>}
        {!current&&<p className="text-sm text-amber-700 dark:text-amber-300">Исходный материал изменился. Ссылки и предложения сохранены; используйте подходящие приёмы для нового варианта текущего материала.</p>}
        {run.result&&<><p>{run.result.summary}</p><div className="grid gap-3 xl:grid-cols-2">{run.result.candidates.map(candidate=><article key={candidate.id} className="space-y-2 rounded border border-border p-3">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={locked||!referenceCanUse(candidate)} checked={selected.includes(candidate.id)} onChange={()=>toggle(run.id,candidate.id)}/><strong>{candidate.title}</strong></label>
          <p className="text-sm"><b>Фильм-референс:</b> {candidate.film.title}{candidate.film.year?` (${candidate.film.year})`:''}</p>
          <p className="text-xs text-muted-foreground">Режиссёр: {candidate.film.director??'не установлен'} · Сценарист: {candidate.film.screenwriter??'не установлен'}</p>
          <p className="text-sm"><b>Сцена источника:</b> {candidate.sourceScene}</p><p className="text-sm"><b>Приём:</b> {candidate.technique}</p><p className="text-sm"><b>Эффект:</b> {candidate.effect}</p>
          <p className="text-sm"><b>Наша адаптация:</b> {candidate.adaptation}</p><ul className="ml-5 list-disc text-sm">{candidate.screenEvidence.map((text,n)=><li key={n}>{text}</li>)}</ul>
          <details><summary className="cursor-pointer text-sm">Изменения и затраты</summary><ul className="ml-5 mt-2 list-disc text-sm">{candidate.changes.map((text,n)=><li key={n}>{text}</li>)}</ul><p className="text-sm">Дополнительные планы: {candidate.additionalShots}. Новые локации: {candidate.additionalLocations.join('; ')||'не требуются'}. Оплата генераций считается отдельно.</p>{candidate.limitations.map((text,n)=><p className="text-sm text-muted-foreground" key={n}>{text}</p>)}</details>
          <details><summary className="cursor-pointer text-sm">Источники и границы подтверждения</summary><p className="my-2 text-xs text-muted-foreground">Ссылка из поиска подтверждает происхождение материала, а не безошибочность каждого вывода модели. Адаптация для нашего фильма — новое предложение.</p>{candidate.sources.map((source,n)=><div key={n} className="mt-2 text-sm">{source.verification==='tool-source'&&cinemaSourceUrl(source.url)?<a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:<span>{source.title} · источник не подтверждён поиском</span>}<p>{source.support}</p></div>)}</details>
        </article>)}</div>
          {!!run.result.candidates.length&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked||!selected.length||!current} onClick={()=>perform('select',{runId:run.id,candidateIds:selected},'Выбранные приёмы сохранены для дальнейшей работы специалистов. Текущий сценарий не переписан.')}>Передать выбранные приёмы специалистам</Button>{saved.length>0&&<Button type="button" variant="ghost" disabled={locked} onClick={()=>perform('select',{runId:run.id,candidateIds:[]},'Приёмы отключены для следующих запусков специалистов.')}>Не использовать эти приёмы</Button>}<Button type="button" disabled={locked||!scope||!selected.length||!!pending||p.limit!==null} onClick={()=>scope&&perform('reuse',{runId:run.id,candidateIds:selected,scope,mode:'apply',model,question},'Доработка по сохранённым приёмам добавлена в очередь без нового поиска.')}>Применить выбранные в новом варианте</Button></div>}
          {draft&&<details open><summary className="cursor-pointer font-medium">Новый вариант · {draft.title}</summary><div className="mt-3 space-y-3"><VersionComparison key={run.id} title="Сравнить исходник и вариант с кинореференсами" versions={[{id:'before',label:'Исходник · '+run.input.sourceTitle,text:run.input.text},{id:'after',label:'Кинореференсы · '+draft.title,text:draft.text}]} initialMode="full" allowFullText disabled={locked}/><p className="text-sm text-muted-foreground">{run.scope.kind==='script'?'Добавление сохранит отдельную карточку сценария. Выберите и утвердите её на этапе «Общий сценарий».':'Применение сохранит прежнее состояние в истории и перенесёт этот вариант только в указанную сцену или план. Изменённые материалы потребуют проверки.'}</p><Button type="button" disabled={locked||!!run.importedVariantId||!!run.appliedAt||!current} onClick={()=>perform('import',{runId:run.id},run.scope.kind==='script'?'Добавлен отдельный вариант общего сценария. Выбор и утверждение остаются за вами.':'Новая версия применена. Предыдущая сохранена в истории.')}>{run.importedVariantId||run.appliedAt?'✓ Вариант перенесён':run.scope.kind==='script'?'Добавить как вариант сценария':'Применить эту версию'}</Button></div></details>}
          {run.result.limitations.map((text,n)=><p key={n} className="text-sm text-muted-foreground">{text}</p>)}
        </>}
        <details><summary className="cursor-pointer text-xs">Исходный материал и фактически отправленный промпт</summary><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">{run.input.text}</p>{job&&<pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{job.prompt}</pre>}</details>
      </article>;})}
    </div>
  </details>;
}
