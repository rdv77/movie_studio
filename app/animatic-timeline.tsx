'use client';
import {useMemo,useState} from 'react';
import {participates,type Project,type Variant} from '../lib/domain';
import {animaticBasis} from '../lib/animatic';
import type {AnimaticManifest} from '../lib/animatic-manifest';
import {selectedKeyframe} from '../lib/keyframes';
import {FRAMING_NAMES} from '../lib/shot-direction';

const seconds=(value:number)=>value.toFixed(2);
export function AnimaticTimeline({p,busy,save,jump}:{p:Project;busy:boolean;save:(value:{sound:'silent'|'voices';music:boolean;motion:boolean})=>Promise<unknown>;jump:(id:string)=>void}){
 const value=p.animaticSettings;
 const [error,setError]=useState('');
 const v=p.animatic?.variants.find(v=>v.id===p.animatic?.selectedId) as (Variant&{animaticManifest?:AnimaticManifest})|undefined,m=v?.animaticManifest;
 const sourceIssue=useMemo(()=>{
  if(!m||!v)return '';
  try{return v.animaticBasis===animaticBasis(p)?'':'Сохранённый аниматик устарел. Ниже показаны кадры и время из выбранного MP4, а не текущий состав раскадровки. Нажмите «Собрать аниматик», чтобы включить новый выбор в новый файл.';}
  catch(e){return `Ниже показан сохранённый MP4. Проверка текущей сборки: ${(e as Error).message}`;}
 },[p,v,m]);
 const currentItems=p.items.filter(i=>i.stage===5&&participates(p,i));
 async function change(patch:Partial<{sound:'silent'|'voices';music:boolean;motion:boolean}>){setError('');try{await save({sound:value?.sound??'voices',music:value?.music??false,motion:value?.motion??false,...patch});}catch(e){setError((e as Error).message);}}
 return <section className="editor-surface p-5 space-y-4" aria-label="Настройки и состав аниматика"><h2>Просмотр постановки</h2><label>Звук <select disabled={busy} value={value?.sound??'voices'} onChange={e=>void change({sound:e.target.value as 'silent'|'voices'})}><option value="voices">Выбранная озвучка</option><option value="silent">Без речи · сначала проверяем изображение</option></select></label><label className="row"><input type="checkbox" disabled={busy} checked={value?.motion??false} onChange={e=>void change({motion:e.target.checked})}/>Схематическое движение камеры</label><p className="muted">Наезд и панорама показываются как движение по картинке. Начальное и конечное состояния показаны отдельными исходными кадрами. Это предварительная постановка, движения персонажей появятся в видео.</p><label className="row"><input type="checkbox" disabled={busy} checked={value?.music??false} onChange={e=>void change({music:e.target.checked})}/>Добавить утверждённую музыку и звуковые слои</label>{error&&<p role="alert">{error}</p>}
 {m?<>
  <h3>Сохранённый аниматик: {v?.title} · {seconds(m.seconds)} сек</h3>
  <p>Настройки выше применятся при следующей сборке. Ниже — исходные изображения выбранного сохранённого файла. Интервалы отсчитываются от начала фильма; «показ» означает время удержания картинки в аниматике.</p>
  {sourceIssue&&<p className="note" role="status">{sourceIssue}</p>}
  <div className="space-y-4">{m.clips.map((c,index)=>{
   // Match by stable item ID: moving/removing a plan must never borrow its neighbour's frames.
   const currentIndex=currentItems.findIndex(i=>i.id===c.itemId),item=currentItems[currentIndex];
   return <article className="border rounded p-3 space-y-2" key={c.itemId} aria-label={'Сохранённый план · '+c.title}>
    <button type="button" disabled={!item} onClick={()=>jump(c.itemId)}>{c.title} · {seconds(c.offset)}–{seconds(c.offset+c.duration)} сек фильма · длительность {seconds(c.duration)} сек</button>
    {!item?<p role="status">Этот план больше не участвует в текущей раскадровке.</p>:currentIndex!==index&&<p role="status">Порядок изменён: в текущей раскадровке этот план стоит под номером {currentIndex+1}.</p>}
    {c.direction&&<p>{c.direction.framingStart?FRAMING_NAMES[c.direction.framingStart]:'Крупность не задана'} → {c.direction.framingEnd?FRAMING_NAMES[c.direction.framingEnd]:'Крупность не задана'}{c.direction.cameraMovement?` · ${c.direction.cameraMovement.type==='static'?'Статичная камера':c.direction.cameraMovement.description||c.direction.cameraMovement.type}`:''}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{c.frames.map(f=>{
     const current=item&&selectedKeyframe(item,f.role),changed=!!item&&(!current||current.id!==f.variantId||current.assetId!==f.assetId);
     const label=f.role==='start'?'Первый кадр':f.role==='end'?'Последний кадр':'Промежуточный кадр',at=c.offset+f.at;
     return <figure key={f.role} aria-label={`${c.title} · ${label}`}>
      <img src={'/api/assets/'+f.assetId} alt={`${c.title}: ${label.toLowerCase()}`} style={{width:'100%',maxWidth:240,aspectRatio:'16/9',objectFit:'contain'}}/>
      <figcaption><strong>{label}</strong><span className="block">Показ: {seconds(at)}–{seconds(at+f.duration)} сек фильма</span><span className="block muted">Длительность показа: {seconds(f.duration)} сек</span></figcaption>
      {changed&&<p className="note" role="status">{current?'В раскадровке выбран другой вариант этого кадра.':'В раскадровке этот кадр сейчас не выбран.'} Здесь сохранён прежний. Новый выбор попадёт в MP4 после повторной сборки.</p>}
     </figure>;
    })}</div>
   </article>;
  })}</div>
 </>:<p>Соберите новый аниматик, чтобы сохранить его кадры и таймлайн. Прежние файлы доступны в истории.</p>}</section>;
}
