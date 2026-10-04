'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Project} from '@/lib/domain';
import {storyboardProgress,storyboardProgressSummary,type FrameProgressStatus} from '@/lib/storyboard-progress';

const statusNames:Record<FrameProgressStatus,string>={missing:'Нет изображения',queued:'В очереди',generating:'Создаётся',saving:'Сохраняется',failed:'Ошибка',unknown:'Исход неизвестен',choose:'Нужен выбор',review:'Нужен пересмотр',conflict:'Конфликт',ready:'Выбрано'};
export function StoryboardProgress({p,busy,open,createEnds,createStarts}:{p:Project;busy:boolean;open:(itemId:string)=>void;createEnds:()=>void;createStarts?:()=>void}){
  const rows=storyboardProgress(p),summary=storyboardProgressSummary(rows);
  const [filter,setFilter]=useState<'start'|'missing'|'attention'|'all'>(()=>summary.startImages<summary.total?'start':summary.missing?'missing':summary.attention?'attention':'all');
  const visible=rows.filter(row=>filter==='all'||(filter==='start'?!row.frames[0]?.imageCount:filter==='missing'?row.missingImages:row.attention));
  const endings=rows.filter(row=>row.frames.some(frame=>frame.role==='end'&&!frame.imageCount));
  if(!rows.length)return null;
  return <section aria-label="Готовность раскадровки" className="editor-surface p-4 mb-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><strong>Готовность раскадровки</strong><span className="muted">Утверждены планы: {summary.approved} / {summary.total}</span></div>
    <div className="flex flex-wrap gap-x-6 gap-y-2" aria-live="polite"><span>Начальные изображения: <strong>{summary.startImages} / {summary.total}</strong></span><span>Полные наборы изображений: <strong>{summary.completeImages} / {summary.total}</strong></span><span>Выбраны комплекты: <strong>{summary.selected} / {summary.total}</strong></span></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Показать планы раскадровки">
      <Button variant={filter==='start'?'secondary':'outline'} aria-pressed={filter==='start'} onClick={()=>setFilter('start')}>Без начального кадра · {summary.total-summary.startImages}</Button>
      <Button variant={filter==='missing'?'secondary':'outline'} aria-pressed={filter==='missing'} onClick={()=>setFilter('missing')}>Не хватает изображений · {summary.missing}</Button>
      <Button variant={filter==='attention'?'secondary':'outline'} aria-pressed={filter==='attention'} onClick={()=>setFilter('attention')}>Требуют внимания · {summary.attention}</Button>
      <Button variant={filter==='all'?'secondary':'outline'} aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Все планы · {summary.total}</Button>
    </div>
    <p className="muted">Считаются только сохранённые изображения. Для двух или трёх ключевых кадров показана готовность каждого момента; текстовое описание в этот счёт не входит.</p>
    <div className="max-h-[34rem] overflow-y-auto space-y-3">
      {!visible.length&&<p>{filter==='start'?'Начальные изображения всех планов сохранены. Проверьте окончания и выбранные комплекты.':filter==='missing'?'Все необходимые изображения сохранены. Проверьте выбранные варианты и утвердите комплекты.':'В этом списке нет планов.'}</p>}
      {visible.map(row=><article key={row.itemId} className="border rounded p-3 space-y-3" data-storyboard-plan={row.itemId}>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.title}{row.approved?' · Утверждён':''}</strong><Button variant="outline" aria-label={'Открыть план: '+row.title} onClick={()=>open(row.itemId)}>Открыть план</Button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{row.frames.map(frame=><div className="flex gap-3 min-w-0" key={frame.role} data-frame-role={frame.role} data-frame-status={frame.status}>
          {frame.assetId?<img loading="lazy" src={'/api/assets/'+frame.assetId} alt={frame.label+' · '+row.title+(frame.selectedId?' · выбран':' · доступный вариант')} className="w-24 h-16 object-contain rounded border shrink-0"/>:<span aria-hidden="true" className="w-24 h-16 rounded border flex items-center justify-center shrink-0 text-sm muted">Нет кадра</span>}
          <div className="min-w-0 space-y-1"><div>{frame.label} · <strong>{statusNames[frame.status]}</strong></div><p className="text-sm break-words">{frame.message}</p>{frame.jobMessage&&<p className="text-sm muted">{frame.jobMessage}</p>}</div>
        </div>)}</div>
      </article>)}
    </div>
    <div className="border-t pt-3 space-y-2"><p>{summary.startImages<summary.total?'Сначала создайте недостающие начальные изображения через «Создать кадры всех планов» и выберите лучшие варианты.':endings.length?'Начальные изображения готовы. Для планов с движением создайте конечные кадры по выбранным первым изображениям.':'Изображения готовы. Выберите все моменты каждого плана, затем утвердите комплект ключевых кадров.'}</p>
      {summary.startImages<summary.total&&createStarts&&<Button variant="outline" disabled={busy} onClick={createStarts}>Создать недостающие первые кадры · {summary.total-summary.startImages}</Button>}
      {!!endings.length&&<Button variant="outline" disabled={busy||!endings.some(row=>row.frames[0]?.status==='ready'&&!row.frames[0].jobMessage)} onClick={createEnds}>Создать окончания планов</Button>}
      <p className="text-sm muted">В тройном наборе также нужен промежуточный кадр. После выбора всех изображений откройте «Проверка и быстрое утверждение», отметьте готовые планы и утвердите их одной кнопкой.</p>
    </div>
  </section>;
}
