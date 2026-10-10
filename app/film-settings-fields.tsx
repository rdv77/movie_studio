'use client';

import {useState} from 'react';
import type {Project} from '@/lib/domain';
import {plannedRuntime,runtimeMode} from '@/lib/runtime-policy';
import {Input} from '@/components/ui/input';
import {FramePolicyControl} from './staging-policy-controls';

const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;

export function FilmSettingsFields({p,busy=false}:{p:Project;busy?:boolean}){
  const [mode,setMode]=useState(runtimeMode(p));
  const [framePolicy,setFramePolicy]=useState(p.directing?.brief.framePolicy);
  const seconds=plannedRuntime(p),scenes=p.directing?.scenes??[];
  const complete=scenes.length>0&&scenes.every(scene=>scene.shots.length>0);
  return <fieldset disabled={busy} className="space-y-5" aria-label="Технические параметры фильма">
    <Field label="Название"><Input name="title" defaultValue={p.title} required maxLength={100}/></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Режим хронометража"><select name="durationMode" className="w-full rounded border p-2 bg-background" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="free">Свободная длительность</option><option value="strict">Строгий хронометраж</option></select></Field>
      <Field label="Ориентир длительности, сек"><Input type="number" name="seconds" min={10} max={3600} step="any" defaultValue={p.directing?.brief.targetSeconds??Math.max(10,p.seconds)} required/></Field>
    </div>
    <p className="text-sm text-muted-foreground">{mode==='free'?'Это примерный ориентир, а не предел. Можно оставить текущее значение. Его изменение не требует заново утверждать материалы.':'В строгом режиме ориентир — верхний предел длительности фильма.'} Длительность сборки определяется кадрами и репликами.</p>
    {seconds>0?<p className="rounded border p-3 text-sm" role="status">{complete?'По текущим планам':'По подготовленной части планов'}: <strong>{seconds.toLocaleString('ru-RU')} сек.</strong> Ориентир не изменяется автоматически.</p>:<p className="text-xs text-muted-foreground">После разработки планов здесь появится расчётная длительность. Общий сценарий пока не задаёт точного времени каждого действия.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Формат"><select name="format" className="w-full rounded border p-2 bg-background" defaultValue={p.format}><option value="16:9">16:9 · горизонтальный</option><option value="9:16">9:16 · вертикальный</option></select></Field>
      <Field label="Лимит расходов, USD"><Input name="limit" defaultValue={p.limit===null?'':String(Number(p.limit)/1e10)} inputMode="decimal"/><small className="text-muted-foreground">Пустое поле — без ограничения. При лимите серия с неизвестной оценкой не отправляется.</small></Field>
    </div>
    <Field label="Порядок производства"><select name="productionOrder" className="w-full rounded border p-2 bg-background" defaultValue={p.productionOrder??'voice-first'}><option value="voice-first">Сначала голоса и аниматик, затем видео</option><option value="video-first">Сначала видео, затем голоса под его длительность</option></select></Field>
    <FramePolicyControl name="framePolicy" value={framePolicy} disabled={busy} onChange={setFramePolicy}/>
    <p className="text-xs text-muted-foreground">Выбранные комплекты кадров сохраняются. Политика опорных изображений применяется при следующей подготовке. Изменение формата потребует пересмотра зависимых материалов.</p>
  </fieldset>;
}
