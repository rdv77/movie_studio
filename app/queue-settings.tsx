'use client';
import {useEffect,useState} from 'react';
import type {Project} from '@/lib/domain';
import {PROVIDERS} from '@/lib/models';
import {queueSettings,queueSettingsSchema,type QueueSettings} from '@/lib/queue-policy';

export function QueueSettingsEditor({project,onSave,disabled=false}:{project:Project;onSave:(settings:QueueSettings)=>void|Promise<void>;disabled?:boolean}){
  const saved=JSON.stringify(queueSettings(project));
  const [draft,setDraft]=useState<QueueSettings>(()=>queueSettings(project)),[saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setDraft(JSON.parse(saved));setError('');},[project.id,saved]);
  const save=async()=>{setError('');const parsed=queueSettingsSchema.safeParse(draft);if(!parsed.success){setError('Укажите целые лимиты от 1 до 8. Пустое поле провайдера использует общий предел, но не больше 3.');return;}setSaving(true);try{await onSave(parsed.data);}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить очередь.');}finally{setSaving(false);}};
  return <section className="grid gap-3 rounded-xl border p-4" aria-label="Настройки очереди"><h3 className="font-semibold">Параллельная генерация</h3><p className="text-sm opacity-75">Разные планы, модели и независимые этапы используют общую очередь. Неизвестный исход запроса требует проверки; он не запускается повторно автоматически.</p>
    <fieldset disabled={disabled||saving} className="grid gap-3"><label className="grid gap-1 text-sm">Одновременных задач в проекте<input type="number" min={1} max={8} step={1} value={Number.isNaN(draft.concurrency)?'':draft.concurrency} onChange={e=>setDraft({...draft,concurrency:e.target.value===''?NaN:Number(e.target.value)})} className="w-24 rounded border bg-transparent p-2"/></label>
      <details><summary className="cursor-pointer text-sm">Ограничения провайдеров</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">{PROVIDERS.map(provider=><label key={provider.id} className="grid gap-1 text-sm">{provider.name}<input type="number" min={1} max={8} step={1} placeholder={String(Math.min(draft.concurrency||3,3))} value={draft.providerLimits[provider.id]??''} onChange={e=>{const providerLimits={...draft.providerLimits};if(e.target.value==='')delete providerLimits[provider.id];else providerLimits[provider.id]=Number(e.target.value);setDraft({...draft,providerLimits});}} className="w-24 rounded border bg-transparent p-2"/></label>)}</div></details>
      <p className="text-sm opacity-70">Фактический предел провайдера не превышает предел проекта. Текущие запросы не отменяются при уменьшении лимита; новые ждут свободного места.</p>
      <button type="button" onClick={save} className="w-fit rounded border px-3 py-2">{saving?'Сохранение…':'Сохранить очередь'}</button>
    </fieldset>{error&&<p role="alert" className="text-sm">{error}</p>}
  </section>;
}
