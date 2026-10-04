'use client';
import type {ImageRetryOptions} from '@/lib/image-retries';
import {money} from '@/lib/domain';
import {GROK_IMAGE_MODEL,FINAL_IMAGE_SETTINGS,grokImageEstimate} from '@/lib/image-quality';
export function ImageRetrySettings({value,onChange,choices,initialEstimate,count=1,referenceCount=0}:{value:ImageRetryOptions;onChange:(v:ImageRetryOptions)=>void;choices:{id:string;name:string;estimate:string|null}[];initialEstimate?:string|null;count?:number;referenceCount?:number}){
  const fallback=choices.find(m=>m.id===value.fallbackModel);
  const fallbackCost=fallback?.id===GROK_IMAGE_MODEL?grokImageEstimate(FINAL_IMAGE_SETTINGS,Math.min(5,referenceCount)):fallback?.estimate;
  const total=initialEstimate!=null&&(!fallback||fallbackCost!=null)?(BigInt(initialEstimate)*BigInt(value.maxAttempts)+BigInt(fallbackCost??'0')*BigInt(count)).toString():null;
  return <section className="note space-y-3" aria-label="Повторы и резервная модель"><strong>Повторы и резервная модель</strong>
    <label className="block">Попыток основной моделью, включая первую<select className="caption-select w-full" aria-label="Число попыток изображения" value={value.maxAttempts} onChange={e=>onChange({...value,maxAttempts:Number(e.target.value)})}>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    <label className="block">Резервная модель · одна попытка<select className="caption-select w-full" aria-label="Резервная модель изображений" value={value.fallbackModel??''} onChange={e=>onChange({...value,fallbackModel:e.target.value||undefined})}><option value="">Без резервной модели</option>{choices.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <p className="muted">Если изображение получено, повторы прекращаются. Между попытками — пауза 15 секунд. Ошибки ключа, баланса, параметров и отказы по содержимому требуют исправления; при неизвестном исходе платный запрос не повторяется.</p>
    <p className="muted">Оценка при использовании всех попыток: {money(total)}. Каждая попытка оплачивается и учитывается отдельно. Лимит проекта проверяется перед каждым повтором; неизвестные списания при установленном лимите требуют сверки. Старые серии автоматически не перезапускаются.</p>
  </section>;
}
