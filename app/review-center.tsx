'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { reviewRows } from '@/lib/review-center';
import { STAGES,chosen,type Project } from '@/lib/domain';
import { audioDuration,videoDuration } from '@/lib/audio-duration';
export function ReviewCenter({p,stage,busy,submit,open}:{p:Project;stage?:number;busy:boolean;submit:(action:string,data:unknown)=>Promise<void>;open:(stage:number,itemId:string)=>void}){
  const [checked,setChecked]=useState<string[]>([]),[measuring,setMeasuring]=useState(false),[error,setError]=useState('');
  const storyboard=stage===5,rows=reviewRows(p).filter(r=>stage===undefined||r.stage===stage),pending=rows.filter(r=>r.status!=='approved');
  const selected=pending.filter(r=>checked.includes(r.itemId)&&r.variantId&&!['conflict','missing'].includes(r.status));
  async function measure(){setMeasuring(true);setError('');try{
    const media=p.items.filter(i=>[6,7].includes(i.stage)&&!i.removedAt&&!i.planArchive).flatMap(i=>{const v=chosen(i);return v?.assetId&&['audio','video'].includes(v.kind)?[v]:[];});
    const durations:Record<string,number>={};
    // Limit simultaneous browser decoders; probe actual files, not estimates.
    const controller=new AbortController();
    for(let n=0;n<media.length;n+=3)await Promise.all(media.slice(n,n+3).map(async v=>{durations[v.assetId!]=await (v.kind==='audio'?audioDuration:videoDuration)(v.assetId!,controller.signal);}));
    await submit('saveMediaDurations',{durations});
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setMeasuring(false);}}
  return <details className="editor-surface p-5 mb-5" open={pending.some(r=>r.status==='conflict')}><summary><b>Проверка и быстрое утверждение · {pending.length} {storyboard?'кадров':'материалов'}</b></summary>
    <p className="muted">{storyboard?'Здесь только кадры раскадровки. Готовые изображения можно утвердить вместе. Кадры с изменённой основой отметьте после просмотра.':'Здесь собраны все промежуточные этапы. Новые готовые варианты можно утвердить вместе. Материалы с изменённой основой отметьте после просмотра; конфликты сначала нужно исправить.'}</p>
    <div className="row wrap my-3">{!storyboard&&<Button variant="outline" disabled={busy||measuring} onClick={measure}>{measuring?'Проверяем файлы…':'Проверить длительность видео и речи'}</Button>}<Button variant="outline" disabled={busy} onClick={()=>setChecked(pending.filter(r=>r.status==='ready').map(r=>r.itemId))}>Выбрать все готовые</Button></div>
    {error&&<p role="alert">{error}</p>}
    <div className="space-y-3">{pending.map(row=><article key={row.itemId} className="border rounded p-3"><label className="row"><input type="checkbox" checked={checked.includes(row.itemId)} disabled={busy||['conflict','missing'].includes(row.status)} onChange={e=>setChecked(ids=>e.target.checked?[...ids,row.itemId]:ids.filter(id=>id!==row.itemId))}/><strong>{STAGES[row.stage]} · {row.title}</strong></label><p>{row.reason}</p>
      {row.status==='review'&&(()=>{const v=chosen(p.items.find(i=>i.id===row.itemId)!);return v?.assetId?<details><summary>Посмотреть выбранный материал</summary>{v.kind==='image'?<img className="max-h-64" alt={row.title} src={'/api/assets/'+v.assetId}/>:v.kind==='audio'?<audio controls preload="none" src={'/api/assets/'+v.assetId}/>:<video controls preload="none" className="max-h-64" src={'/api/assets/'+v.assetId}/>}</details>:<p className="whitespace-pre-wrap">{v?.text}</p>;})()}
      <Button size="sm" variant="link" onClick={()=>open(row.stage,row.itemId)}>Открыть карточку</Button>{row.status==='conflict'&&row.stage===7&&<Button size="sm" variant="link" onClick={()=>{const voice=p.items.find(i=>i.stage===6&&i.sourceShot?.title===p.items.find(i=>i.id===row.itemId)?.sourceShot?.title);open(6,voice?.id??'');}}>Переозвучить план</Button>}
    </article>)}</div>
    <Button className="mt-4" disabled={busy||measuring||!selected.length} onClick={async()=>{await submit('approveReview',{selections:selected.map(r=>({itemId:r.itemId,variantId:r.variantId,reviewed:r.status==='review'}))});setChecked([]);}}>Утвердить отмеченные {storyboard?'кадры':'материалы'} ({selected.length})</Button>
    {!storyboard&&<p className="muted small">Изменившийся аниматик нужно собрать заново: утверждение карточек не меняет уже сохранённый видеофайл.</p>}
  </details>;
}
