'use client';
import {useState,useEffect,useRef} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CREATIVE_STRENGTH_KEYS, CREATIVE_STRENGTH_LABELS, CREATIVE_STRENGTH_HELP, SUGGESTED_CREATIVE_STRENGTHS, type CreativeStrengths, type CreativeOverrides, type CreativeBrief } from '@/lib/creative-brief';

export function CreativeStrengthControls({value,inherited,disabled,onChange}:{value?:CreativeStrengths;inherited?:CreativeStrengths;disabled?:boolean;onChange:(value:CreativeStrengths|undefined)=>void}){
  const set=(key:typeof CREATIVE_STRENGTH_KEYS[number],n:number|undefined)=>{const next={...value};if(n===undefined)delete next[key];else next[key]=n;onChange(Object.keys(next).length?next:undefined);};
  return <div className="border rounded p-4 space-y-4"><div className="row spread wrap"><b>Выразительность · 0–10</b><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>onChange({...SUGGESTED_CREATIVE_STRENGTHS})}>Включить рекомендуемые значения</Button><Button type="button" size="sm" variant="ghost" disabled={disabled||!value} onClick={()=>onChange(undefined)}>Сбросить шкалы</Button></div>
    {CREATIVE_STRENGTH_KEYS.map(key=><div key={key}><label className="row wrap"><input type="checkbox" disabled={disabled} checked={value?.[key]!==undefined} onChange={e=>set(key,e.target.checked?inherited?.[key]??SUGGESTED_CREATIVE_STRENGTHS[key]:undefined)}/><span>{CREATIVE_STRENGTH_LABELS[key]}: <b>{value?.[key]??(inherited?.[key]!==undefined?`${inherited[key]} · наследуется`:'без шкалы')}</b></span><input aria-label={CREATIVE_STRENGTH_LABELS[key]+' · значение'} className="min-w-32 flex-1" type="range" min={0} max={10} step={1} disabled={disabled||value?.[key]===undefined} value={value?.[key]??inherited?.[key]??SUGGESTED_CREATIVE_STRENGTHS[key]} onChange={e=>set(key,Number(e.target.value))}/></label><p className="muted text-sm">{CREATIVE_STRENGTH_HELP[key]}</p></div>)}
    <p className="muted">Аудитория, факты и обязательные события имеют приоритет. Шкалы меняют предложения модели; выбор версии остаётся за вами.</p>
  </div>;
}
export function SceneCreativeControls({brief,value,disabled,onChange}:{brief:CreativeBrief;value?:CreativeOverrides;disabled?:boolean;onChange:(value:CreativeOverrides|undefined)=>void}){
  return <details className="border rounded p-3"><summary>Настройки этой сцены · {value?'свои параметры':'наследуются от фильма'}</summary><p className="muted">Пустое поле наследует задание фильма. Аудитория и обязательные события общие для всех сцен.</p>
    {(['genre','effect','director','techniques'] as const).map((key,n)=><label key={key} className="block my-3">{['Жанр','Чувство зрителя','Режиссёрский подход','Приёмы'][n]}{key==='techniques'?<Textarea disabled={disabled} placeholder={brief[key]} value={value?.[key]??''} onChange={e=>{const next={...value};if(e.target.value)next[key]=e.target.value;else delete next[key];onChange(next);}}/>:<Input disabled={disabled} placeholder={brief[key]} value={value?.[key]??''} onChange={e=>{const next={...value};if(e.target.value)next[key]=e.target.value;else delete next[key];onChange(next);}}/>}</label>)}
    <CreativeStrengthControls disabled={disabled} value={value?.strengths} inherited={brief.strengths} onChange={strengths=>onChange({...value,strengths})}/><Button type="button" variant="ghost" disabled={disabled||!value} onClick={()=>onChange(undefined)}>Вернуться к настройкам фильма</Button>
  </details>;
}
export function SceneCreativeSettings({brief,value,disabled,save}:{brief:CreativeBrief;value?:CreativeOverrides;disabled?:boolean;save:(value:CreativeOverrides|undefined)=>Promise<void>}){
  const [draft,setDraft]=useState(value),dirty=useRef(false),[changed,setChanged]=useState(false);
  const signature=JSON.stringify(value);
  useEffect(()=>{if(!dirty.current)setDraft(value);},[signature]);
  return <div><SceneCreativeControls brief={brief} value={draft} disabled={disabled} onChange={v=>{dirty.current=true;setChanged(true);setDraft(v);}}/>{changed&&<Button disabled={disabled} onClick={async()=>{await save(draft);dirty.current=false;setChanged(false);}}>Сохранить настройки сцены</Button>}</div>;
}
