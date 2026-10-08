'use client';
import {montageProposalIssue,montageReviewCurrent} from '../lib/montage-review';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Item,Project,Variant} from '@/lib/domain';
import {money} from '@/lib/domain';
import {mediaReviewCurrent,mediaReviewComparisonIssue,mediaReviewCorrection,mediaReviewMeanings,mediaReviewSamplingPlan,type MediaReview,type ReviewSample,type MediaReviewRequest} from '@/lib/media-review';
import {sampleVideo} from '@/lib/video-samples';
const resultNames={pass:'Подтверждено',fail:'Противоречие',uncertain:'Неясно'};
export function MediaReviewPanel({p,item,variant,busy,upload,run,apply,useCorrection}:{p:Project;item:Item;variant?:Variant;busy:boolean;upload:(file:File)=>Promise<{id:string}>;apply?:(reviewId:string,index:number)=>Promise<unknown>;useCorrection?:(text:string)=>void;run:(data:MediaReviewRequest)=>Promise<unknown>}){
  const [working,setWorking]=useState(false),[message,setMessage]=useState('');
  const reviews=p.mediaReviews?.filter(r=>r.itemId===item.id&&r.variantId===variant?.id&&!r.removedAt)??[];
  if(!variant?.assetId||!['image','video'].includes(variant.kind))return null;
  const meanings=mediaReviewMeanings(p,item);
  const sampleLink=(r:MediaReview,n:number)=>{const sample=r.samples[n-1];return sample?<a className="underline mr-3" key={n} href={'/api/assets/'+sample.assetId} target="_blank" rel="noreferrer">Кадр {n}{sample.at!==undefined?' · '+sample.at.toFixed(2)+' сек':''}</a>:null;};
  return <details className="editor-surface p-4 mb-4"><summary>Визуальная проверка ИИ · смысл сцены</summary><div className="space-y-3 mt-3">
    <p>Сначала независимый зритель описывает видимое без сценария. Затем вы можете отдельно сравнить его наблюдения с замыслом. Каждый шаг — запрос к Grok 4.7 с оплатой по токенам и своей записью в журнале.</p>
    <p className="muted">Повтор и новая генерация запускаются вручную. Проверка не утверждает материал. Для каждого шага действует проверка бюджета; при неизвестной цене заранее заданный лимит блокирует отправку.</p>
    {meanings.length?<p>Проверяемые смыслы: {meanings.map(m=>m.title).join('; ')}.</p>:<p className="muted">К материалу ещё не привязаны смыслы. Наблюдения будут доступны, а смысловая проверка останется без целей.</p>}
    {variant.kind==='video'?<p className="muted">Выборка до {item.stage===8?8:6} кадров: начало, конец и моменты вокруг заданных событий. При отсутствии временных отметок добавляются обзорные кадры. Выборка не подтверждает непрерывность движения, событие между кадрами, качество звука и синхронизацию губ.</p>:<p className="muted">Изображение показывает состояние одного момента. Движение и причинный переход по одному кадру подтвердить нельзя.</p>}
    <Button disabled={busy||working} onClick={async()=>{setWorking(true);setMessage('');try{let samples:ReviewSample[];if(variant.kind==='image')samples=[{assetId:variant.assetId!,role:'target'}];else{setMessage('Извлекаем кадры вокруг заданных событий…');const frames=await sampleVideo(variant.assetId!,mediaReviewSamplingPlan(p,item,variant));samples=[];for(const frame of frames)samples.push({assetId:(await upload(frame.file)).id,at:frame.at,role:'video-sample'});}await run({itemId:item.id,variantId:variant.id,samples,kind:item.stage===8?'film':variant.kind==='image'?'image':'video'});setMessage('Независимое наблюдение добавлено в очередь.');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}}>1. Получить независимые наблюдения</Button>
    {message&&<p role="status">{message}</p>}
    {[...reviews].reverse().map(r=>{
      const job=p.jobs.find(j=>j.id===r.jobId),observationJob=p.jobs.find(j=>j.id===r.observationJobId),current=mediaReviewCurrent(p,r),comparisonIssue=mediaReviewComparisonIssue(p,r);
      return <article className="border rounded p-3 space-y-3" key={r.id}>
        <strong>{new Date(r.created).toLocaleString('ru-RU')}</strong>
        {observationJob?<p>Наблюдение: {money(observationJob.actual)}{r.jobId!==r.observationJobId?' · Сравнение: '+(job?money(job.actual):'стоимость уточняется'):''}</p>:<p>{job?money(job.actual):'Стоимость уточняется'} · прежняя проверка в один шаг</p>}
        {!current&&<p>Постановка, смысл или материал изменились после этой проверки.</p>}
        {r.observation&&<details open={!r.result}><summary>Что зритель увидел без сценария</summary><p>{r.observation.summary}</p>{r.observation.observations.map(o=><div key={o.id} className="border-l pl-3 my-3"><p><b>Видно:</b> {o.visible}</p>{o.interpretation&&<p><b>Предположение:</b> {o.interpretation}</p>}{o.uncertainties.map((u,n)=><p key={n}>Не установлено: {u}</p>)}<p>{o.sampleIndices.map(n=>sampleLink(r,n))}</p></div>)}{r.observation.limitations.map((l,n)=><p key={n}>{l}</p>)}</details>}
        {r.observationJobId&&r.observation&&r.jobId===r.observationJobId&&<Button disabled={busy||working||!!comparisonIssue} title={comparisonIssue||undefined} onClick={async()=>{setWorking(true);setMessage('');try{await run({action:'compare',reviewId:r.id});setMessage('Сравнение добавлено в очередь отдельным запросом.');}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}}>2. Сравнить наблюдения с замыслом</Button>}
        {!r.result&&!(r.observation&&r.jobId===r.observationJobId)&&<p>{job?.error??(job?.status==='cancelled'?'Запрос отменён.':r.observation?'Сравнение выполняется…':'Наблюдение выполняется…')}</p>}
        {r.result&&<>
          <p>{r.result.summary}</p>
          {r.result.meaningChecks?.map(c=>{const target=r.meaningTargets?.find(m=>m.id===c.meaningId),correction=mediaReviewCorrection(r,c.meaningId);return <article key={c.meaningId} className="border rounded p-3 space-y-2"><strong>{target?.title??c.meaningId} · {resultNames[c.result]}</strong><p>{c.evidence}</p><p>{c.sampleIndices.map(n=>sampleLink(r,n))}</p>{c.missingEvidence&&<p>Не хватает: {c.missingEvidence}</p>}{c.correction&&<p>Поправка: {c.correction}</p>}{correction&&useCorrection&&item.stage!==8&&<Button variant="outline" disabled={busy||working||!current} onClick={()=>{useCorrection(correction);setMessage('Поправка добавлена в задание. Проверьте текст и запустите новую генерацию вручную.');}}>Использовать исправление в промпте</Button>}</article>;})}
          {r.result.issues.map((i,n)=><div className="border-l pl-3" key={n}><b>{i.criterion}</b><p>{i.evidence}</p><p>Предложение: {i.suggestion}</p></div>)}
          {r.result.montage?.map((m,n)=><article key={n} className="border rounded p-3"><p>{p.items.find(i=>i.id===m.itemId)?.title}: от {m.trim.toFixed(2)} сек, оставить {m.duration.toFixed(2)} сек</p><p>{m.reason}</p>{montageProposalIssue(p,m)&&<p role="status">{montageProposalIssue(p,m)}</p>}<Button disabled={busy||working||!apply||!montageReviewCurrent(p,r)||r.appliedMontage?.includes(n)||!!montageProposalIssue(p,m)} onClick={async()=>{setWorking(true);try{await apply!(r.id,n);}catch(e){setMessage((e as Error).message);}finally{setWorking(false);}}}>{r.appliedMontage?.includes(n)?'✓ Применено':'Применить этот монтажный участок'}</Button></article>)}
          <details><summary>Критерии и пределы проверки</summary>{r.result.checks.map((c,n)=><p key={n}>{c.criterion} · {resultNames[c.result]}: {c.evidence}</p>)}{r.result.limitations.map((l,n)=><p key={n}>{l}</p>)}</details>
        </>}
      </article>;
    })}
  </div></details>;
}
