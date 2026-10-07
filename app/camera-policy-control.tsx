'use client';
import {useId} from 'react';
import {CAMERA_POLICIES,CAMERA_POLICY_LABELS,CAMERA_POLICY_HELP,type CameraPolicy} from '@/lib/camera-policy';

export function CameraPolicyControl({value,disabled=false,name,allowLegacy=true,onChange}:{value?:CameraPolicy;disabled?:boolean;name?:string;allowLegacy?:boolean;onChange:(value:CameraPolicy|undefined)=>void}){
  const id=useId();
  return <div className="rounded border p-4 space-y-2">
    <label htmlFor={id} className="block font-medium">Работа камеры</label>
    <select id={id} name={name} className="w-full rounded border p-2 bg-background" aria-describedby={id+'-help'} disabled={disabled} value={value??''} onChange={e=>onChange((e.target.value||undefined) as CameraPolicy|undefined)}>
      {allowLegacy&&<option value="">Прежняя постановка · политика не задана</option>}
      {CAMERA_POLICIES.map(mode=><option key={mode} value={mode}>{CAMERA_POLICY_LABELS[mode]}</option>)}
    </select>
    <p id={id+'-help'} className="text-sm text-muted-foreground">{value?CAMERA_POLICY_HELP[value]:'Сохраняются прежние операторские задания. Выберите политику для дальнейшей проработки.'}</p>
    <p className="text-sm text-muted-foreground">Для готовых планов: сохраните задание, запустите «Доработать: Оператор», проверьте и утвердите планы, затем подготовьте промпты. Конкретное утверждённое движение камеры имеет приоритет над общей политикой.</p>
  </div>;
}
