'use client';
import { useEffect,useRef,useState } from 'react';
import { Button } from '@/components/ui/button';
import { reviewRows,selectableReviewRows,reviewKeyframePreviews,reviewApprovalSelection,reviewVoiceItem } from '@/lib/review-center';
import { STAGES,chosen,type Project } from '@/lib/domain';
import { audioDuration,videoDuration } from '@/lib/audio-duration';
export function ReviewCenter({p,stage,scope='all',busy,submit,open}:{p:Project;stage?:number;scope?:'all'|'animatic';busy:boolean;submit:(action:string,data:unknown)=>Promise<void>;open:(stage:number,itemId:string)=>void}){
  const [checked,setChecked]=useState<string[]>([]),[measuring,setMeasuring]=useState(false),[error,setError]=useState('');
  const animatic=scope==='animatic',storyboard=stage===5,rows=reviewRows(p,scope).filter(r=>stage===undefined||r.stage===stage),pending=rows.filter(r=>r.status!=='approved');
  const selectable=selectableReviewRows(pending),selected=selectable.filter(r=>checked.includes(r.itemId));
  const allSelected=selectable.length>0&&selected.length===selectable.length,partiallySelected=selected.length>0&&!allSelected,selectAll=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=partiallySelected;},[partiallySelected]);
  async function approveSelected(){await submit('approveReview',{selections:selected.map(reviewApprovalSelection),scope});setChecked([]);}
  async function measure(){setMeasuring(true);setError('');try{
    const media=p.items.filter(i=>[6,7].includes(i.stage)&&!i.removedAt&&!i.planArchive).flatMap(i=>{const v=chosen(i);return v?.assetId&&['audio','video'].includes(v.kind)?[v]:[];});
    const durations:Record<string,number>={};
    // Limit simultaneous browser decoders; probe actual files, not estimates.
    const controller=new AbortController();
    for(let n=0;n<media.length;n+=3)await Promise.all(media.slice(n,n+3).map(async v=>{durations[v.assetId!]=await (v.kind==='audio'?audioDuration:videoDuration)(v.assetId!,controller.signal);}));
    await submit('saveMediaDurations',{durations});
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setMeasuring(false);}}
  return <details className="editor-surface p-5 mb-5" open={pending.some(r=>r.status==='conflict')}><summary><b>Проверка и быстрое утверждение · {pending.length} {storyboard?'кадров':'материалов'}</b></summary>
    <p className="muted">{animatic?(p.animaticSettings?.sound==='silent'?'Здесь только кадры для беззвучного аниматика.':'Здесь кадры раскадровки и голоса для аниматика.'):storyboard?'Здесь только кадры раскадровки. Готовые изображения можно утвердить вместе. Кадры с изменённой основой отметьте после просмотра.':'Здесь собраны все промежуточные этапы. Новые готовые варианты можно утвердить вместе. Материалы с изменённой основой отметьте после просмотра; конфликты сначала нужно исправить.'}</p>
    <div className="space-y-2 my-3">
      <label className="row"><input ref={selectAll} type="checkbox" checked={allSelected} aria-checked={partiallySelected?'mixed':allSelected} disabled={busy||measuring||!selectable.length} onChange={e=>setChecked(e.target.checked?selectable.map(row=>row.itemId):[])}/><strong>Выбрать все доступные {storyboard?'кадры':'материалы'} · {selectable.length}</strong></label>
      <p className="muted small">Включая материалы с пометкой «Основа изменилась». Перед утверждением проверьте, что они подходят. Карточки без файла и с конфликтами не выбираются.</p>
      <div className="row wrap">{!storyboard&&!animatic&&<Button variant="outline" disabled={busy||measuring} onClick={measure}>{measuring?'Проверяем файлы…':'Проверить длительность видео и речи'}</Button>}<Button variant="outline" disabled={busy||measuring||!pending.some(r=>r.status==='ready')} onClick={()=>setChecked(pending.filter(r=>r.status==='ready').map(r=>r.itemId))}>Выбрать все готовые</Button><Button disabled={busy||measuring||!selected.length} onClick={approveSelected}>Утвердить отмеченные {storyboard?'кадры':'материалы'} ({selected.length})</Button></div>
    </div>
    {error&&<p role="alert">{error}</p>}
    <div className="space-y-3">{pending.map(row=><article key={row.itemId} className="border rounded p-3"><label className="row"><input type="checkbox" checked={checked.includes(row.itemId)} disabled={busy||['conflict','missing'].includes(row.status)} onChange={e=>setChecked(ids=>e.target.checked?[...ids,row.itemId]:ids.filter(id=>id!==row.itemId))}/><strong>{STAGES[row.stage]} · {row.title}</strong></label><p>{row.reason}</p>
      {row.stage===5&&(()=>{const frames=reviewKeyframePreviews(p,row.itemId);return frames.length?<details open={row.status==='review'}><summary>Посмотреть выбранный набор · {frames.length} {frames.length===1?'кадр':'кадра'}</summary><p className="muted small">Одно утверждение относится ко всем показанным кадрам. Если основа изменилась, проверьте каждое отмеченное изображение перед подтверждением.</p><div className="grid gap-3 sm:grid-cols-2">{frames.map(frame=><figure key={frame.role} className="border rounded p-3" data-keyframe-role={frame.role} data-preview-variant={frame.variantId}>
        <figcaption><strong>{frame.label}</strong> · {frame.status==='current'?'Актуален':frame.status==='review'?'Нужен пересмотр':frame.status==='missing'?'Нет изображения':'Конфликт'}</figcaption>{frame.assetId&&<a href={'/api/assets/'+frame.assetId} target="_blank" rel="noreferrer"><img className="max-h-64" alt={`${row.title}: ${frame.label}`} src={'/api/assets/'+frame.assetId}/></a>}<p className={frame.status==='current'?'muted small':'warning-text small'}>{frame.reason}</p>
      </figure>)}</div></details>:null;})()}
      {row.stage!==5&&row.status==='review'&&(()=>{const v=chosen(p.items.find(i=>i.id===row.itemId)!);return v?.assetId?<details><summary>Посмотреть выбранный материал</summary>{v.kind==='image'?<img className="max-h-64" alt={row.title} src={'/api/assets/'+v.assetId}/>:v.kind==='audio'?<audio controls preload="none" src={'/api/assets/'+v.assetId}/>:<video controls preload="none" className="max-h-64" src={'/api/assets/'+v.assetId}/>}</details>:<p className="whitespace-pre-wrap">{v?.text}</p>;})()}
      <Button size="sm" variant="link" onClick={()=>open(row.stage,row.itemId)}>Открыть карточку</Button>{row.status==='conflict'&&row.stage===7&&(()=>{const voice=reviewVoiceItem(p,row.itemId);return voice?<Button size="sm" variant="link" onClick={()=>open(6,voice.id)}>Переозвучить план</Button>:null;})()}
    </article>)}</div>
    <Button className="mt-4" disabled={busy||measuring||!selected.length} onClick={approveSelected}>Утвердить отмеченные {storyboard?'кадры':'материалы'} ({selected.length})</Button>
    {!storyboard&&<p className="muted small">Изменившийся аниматик нужно собрать заново: утверждение карточек не меняет уже сохранённый видеофайл.</p>}
  </details>;
}
