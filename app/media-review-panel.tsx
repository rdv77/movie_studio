'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Item,Project,Variant} from '@/lib/domain';
import {money} from '@/lib/domain';
import {mediaReviewCurrent,type MediaReview,type ReviewSample} from '@/lib/media-review';
import {sampleVideo} from '@/lib/video-samples';
export function MediaReviewPanel({p,item,variant,busy,upload,run}:{p:Project;item:Item;variant?:Variant;busy:boolean;upload:(file:File)=>Promise<{id:string}>;run:(data:{itemId:string;variantId:string;samples:ReviewSample[];kind:MediaReview['kind']})=>Promise<unknown>}){
  const [working,setWorking]=useState(false),[message,setMessage]=useState('');
  const reviews=(p as Project&{mediaReviews?:MediaReview[]}).mediaReviews?.filter(r=>r.itemId===item.id&&r.variantId===variant?.id&&!r.removedAt)??[];
  if(!variant?.assetId||!['image','video'].includes(variant.kind))return null;
  return <details className="editor-surface p-4 mb-4"><summary>Визуальная проверка ИИ</summary><div className="space-y-3 mt-3"><p>Редактор предложит корректировки композиции, героев и реквизита. Это отдельный запрос к Grok 4.7 с оплатой по токенам. Утверждение остаётся за вами.</p>{variant.kind==='video'&&<p className="muted">Проверяются три выборочных кадра. Звук, плавность движения и синхронизацию губ нужно оценить при просмотре ролика.</p>}
    <Button disabled={busy||working} onClick={async()=>{setWorking(true);setMessage('');try{let samples:ReviewSample[];if(variant.kind==='image')samples=[{assetId:variant.assetId!,role:'target'}];else{setMessage('Извлекаем три кадра видео…');const frames=await sampleVideo(variant.assetId!);samples=[];for(const frame of frames)samples.push({assetId:(await upload(frame.file)).id,at:frame.at,role:'video-sample'});}await run({itemId:item.id,variantId:variant.id,samples,kind:item.stage===8?'film':variant.kind==='image'?'image':'video'});setMessage('Проверка добавлена в очередь.');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}}>Проверить выбранный вариант</Button>{message&&<p role="status">{message}</p>}
    {[...reviews].reverse().map(r=>{const job=p.jobs.find(j=>j.id===r.jobId);return <article className="border rounded p-3 space-y-2" key={r.id}><strong>{new Date(r.created).toLocaleString('ru-RU')} · {job?money(job.actual):'Стоимость уточняется'}</strong>{!mediaReviewCurrent(p,r)&&<p>Постановка или материал изменились после этой проверки.</p>}{!r.result&&<p>{job?.error??'Проверка выполняется…'}</p>}{r.result&&<><p>{r.result.summary}</p>{r.result.issues.map((i,n)=><div className="border-l pl-3" key={n}><b>{i.criterion}</b><p>{i.evidence}</p><p>Предложение: {i.suggestion}</p></div>)}<details><summary>Критерии и пределы проверки</summary>{r.result.checks.map((c,n)=><p key={n}>{c.criterion} · {c.result}: {c.evidence}</p>)}{r.result.limitations.map((l,n)=><p key={n}>{l}</p>)}</details></>}</article>;})}
  </div></details>;
}
