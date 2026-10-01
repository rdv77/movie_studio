'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {batchScopeIds,type BatchCandidate,type BatchScope} from '@/lib/batch-scope';
const modes:{id:BatchScope;label:string}[]=[{id:'all',label:'Весь этап'},{id:'selected',label:'Выбранные'},{id:'remaining',label:'Оставшиеся'},{id:'attention',label:'Требуют внимания'}];
export function BatchScopeSelector({rows,selected,disabled=false,onChange}:{rows:BatchCandidate[];selected:string[];disabled?:boolean;onChange:(ids:string[])=>void}){
  const [mode,setMode]=useState<BatchScope>('selected');
  return <section className="space-y-2 my-3" aria-label="Набор для генерации"><div className="flex flex-wrap gap-2">{modes.map(m=><Button key={m.id} type="button" variant={mode===m.id?'secondary':'outline'} disabled={disabled} onClick={()=>{setMode(m.id);onChange(batchScopeIds(rows,m.id,selected));}}>{m.label} · {batchScopeIds(rows,m.id,selected).length}</Button>)}</div><p className="text-sm opacity-75">Отметьте нужные карточки вручную или выберите набор. «Требуют внимания» выбирает отсутствующий или устаревший материал. Незавершённые и неизвестные запросы пропускаются. Новая генерация готового материала создаёт дополнительный платный вариант; состав и смета показаны до запуска.</p></section>;
}
