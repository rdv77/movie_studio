'use client';
import {useId,useState} from 'react';
import {CameraPolicyControl} from './camera-policy-control';
import type {CameraPolicy} from '@/lib/camera-policy';
import {STAGING_MODE_LABELS,STAGING_MODE_HELP,FRAME_POLICY_LABELS,FRAME_POLICY_HELP,type StagingMode,type FramePolicy} from '@/lib/staging-policy';

export function StagingModeControl({value,inherited,shot=false,disabled=false,name,allowLegacy=true,onChange}:{
  value?:StagingMode;inherited?:StagingMode;shot?:boolean;disabled?:boolean;name?:string;allowLegacy?:boolean;
  onChange:(value:StagingMode|undefined)=>void;
}){
  const id=useId(),effective=value??(shot?inherited:undefined);
  return <div className="rounded border p-4 space-y-2">
    <label htmlFor={id} className="block font-medium">{shot?'Постановка этого плана':'Способ постановки фильма'}</label>
    <select id={id} name={name} className="w-full rounded border p-2 bg-background" aria-describedby={id+'-help'} disabled={disabled} value={value??''} onChange={e=>onChange((e.target.value||undefined) as StagingMode|undefined)}>
      {(shot||allowLegacy)&&<option value="">{shot?`Как в фильме · ${inherited?STAGING_MODE_LABELS[inherited]:'прежняя постановка'}`:'Прежняя постановка · режим не задан'}</option>}
      {(Object.keys(STAGING_MODE_LABELS) as StagingMode[]).map(mode=><option key={mode} value={mode}>{STAGING_MODE_LABELS[mode]}</option>)}
    </select>
    <p id={id+'-help'} className="text-sm text-muted-foreground">{effective?STAGING_MODE_HELP[effective]:'Сохраняются прежние инструкции. Выберите режим, чтобы применять новые правила при дальнейшей проработке.'}</p>
  </div>;
}

export function FramePolicyControl({value,disabled=false,name,allowLegacy=true,onChange}:{value?:FramePolicy;disabled?:boolean;name?:string;allowLegacy?:boolean;onChange:(value:FramePolicy|undefined)=>void}){
  const id=useId();
  return <div className="rounded border p-4 space-y-2">
    <label htmlFor={id} className="block font-medium">Опорные изображения</label>
    <select id={id} name={name} className="w-full rounded border p-2 bg-background" aria-describedby={id+'-help'} disabled={disabled} value={value??''} onChange={e=>onChange((e.target.value||undefined) as FramePolicy|undefined)}>
      {allowLegacy&&<option value="">Прежний подбор кадров · режим не задан</option>}
      {(Object.keys(FRAME_POLICY_LABELS) as FramePolicy[]).map(mode=><option key={mode} value={mode}>{FRAME_POLICY_LABELS[mode]}</option>)}
    </select>
    <p id={id+'-help'} className="text-sm text-muted-foreground">{value?FRAME_POLICY_HELP[value]:'Сохраняется прежний способ подбора ключевых кадров.'}</p>
    <p className="text-sm text-muted-foreground">Один исходный кадр допускает движение. Конечное состояние описывается текстом в любом режиме. При автоматическом выборе второй кадр нужен только для точно заданной конечной композиции, отмеченной в постановке плана.</p>
  </div>;
}

/** Defaults belong only to this explicit new-project form, never to legacy hydration. */
export function NewProjectPolicyFields({disabled=false}:{disabled?:boolean}){
  const [stagingMode,setStagingMode]=useState<StagingMode|undefined>('readable'),[framePolicy,setFramePolicy]=useState<FramePolicy|undefined>('auto'),[cameraPolicy,setCameraPolicy]=useState<CameraPolicy|undefined>('cinematic');
  return <div className="space-y-3 my-3" aria-label="Постановка нового фильма">
    <StagingModeControl name="stagingMode" value={stagingMode} allowLegacy={false} disabled={disabled} onChange={setStagingMode}/>
    <CameraPolicyControl name="cameraPolicy" value={cameraPolicy} allowLegacy={false} disabled={disabled} onChange={setCameraPolicy}/>
    <FramePolicyControl name="framePolicy" value={framePolicy} allowLegacy={false} disabled={disabled} onChange={setFramePolicy}/>
    <p className="text-sm text-muted-foreground">Настройки задаются для нового фильма. Их можно изменить позже в творческом задании или отдельно для плана.</p>
  </div>;
}
