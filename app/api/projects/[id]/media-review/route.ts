import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset,getKey} from '@/lib/server';
import {id,now,getItem,dependencies,type Job} from '@/lib/domain';
import {mediaObservationPrompt,mediaComparisonPrompt,mediaReviewComparisonIssue,mediaReviewMeanings,filmStoryReviewContext,reviewBasis,type MediaReview} from '@/lib/media-review';
const requestSchema=z.union([
  z.object({revision:z.number().int(),action:z.literal('compare'),reviewId:z.string().uuid()}),
  z.object({revision:z.number().int(),itemId:z.string().uuid(),variantId:z.string().uuid(),kind:z.enum(['image','video','film']),samples:z.array(z.object({assetId:z.string().uuid(),at:z.number().finite().min(0).max(10000).optional(),role:z.enum(['target','video-sample'])})).min(1).max(8)})
]);
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const b=requestSchema.parse(await req.json());
  if(p.revision!==b.revision)throw Error('Проект изменился. Повторите проверку выбранного материала.');
  // Each phase is an independent paid request, with its own ledger entry.
  if(p.limit!==null)throw Error('Стоимость визуального редактора определяется по токенам. Для каждого этапа нужен режим без лимита и контроль журнала.');
  await getKey(user,'xai');
  if('action' in b){
    const review=p.mediaReviews?.find(r=>r.id===b.reviewId);if(!review)throw Error('Проверка не найдена.');
    const issue=mediaReviewComparisonIssue(p,review);if(issue)throw Error(issue);
    const item=getItem(p,review.itemId),v=item.variants.find(v=>v.id===review.variantId)!;
    // Reuse a valid older blind observation. Freeze the global story only for
    // comparison; the independent observer never sees this context.
    if(!review.filmStory){review.filmStory=filmStoryReviewContext(p,item);review.basis=reviewBasis(p,item,v,true);}
    const key=id(),created=now(),prompt=mediaComparisonPrompt(p,item,v,review);
    p.jobs.push({id:key,batchId:review.id,itemId:item.id,purpose:'media-review',mediaReviewPhase:'compare',model:'grok-4.7',kind:'text',prompt,brief:'Смысловая проверка · сравнение с замыслом',refs:[],dialogue:'',camera:'',continuity:'',voiceId:'',duration:0,offset:0,volume:1,created,status:'queued',transportVersion:2,deps:dependencies(p,item.stage),estimate:null,actual:null} as Job);
    review.jobId=key;
    return Response.json(await saveProject(user,p,p.revision));
  }
  const item=getItem(p,b.itemId),v=item.variants.find(v=>v.id===b.variantId);
  if(item.planArchive||item.removedAt||!v?.assetId||!['image','video'].includes(v.kind))throw Error('Выберите готовое изображение или видео этого проекта.');
  if(b.kind==='image'&&v.kind!=='image'||b.kind!=='image'&&v.kind!=='video'||b.kind==='film'&&item.stage!==8||item.stage===8&&b.kind!=='film')throw Error('Тип проверки не соответствует материалу.');
  if(b.kind==='image'&&(b.samples.length!==1||b.samples[0].assetId!==v.assetId||b.samples[0].role!=='target'||b.samples[0].at!==undefined))throw Error('Для проверки нужен только сам выбранный кадр.');
  if(b.kind!=='image'&&b.samples.some(s=>s.role!=='video-sample'||s.at===undefined))throw Error('Для видео нужны извлечённые кадры с отметками времени.');
  const samples=b.samples.filter((s,n,a)=>a.findIndex(x=>x.assetId===s.assetId)===n);
  for(const sample of samples){const a=await asset(user,sample.assetId,p);if(!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024)throw Error('Для проверки нужны изображения PNG/JPEG/WebP до 10 МБ.');}
  if(p.mediaReviews?.some(r=>r.variantId===v.id&&p.jobs.some(j=>(j.id===r.jobId||j.id===r.observationJobId)&&['queued','dispatching','pending','saving','unknown'].includes(j.status))))throw Error('Для этого варианта уже есть текущая проверка или запрос с неизвестным исходом. Откройте журнал.');
  const key=id(),created=now();const review:MediaReview={id:key,jobId:key,observationJobId:key,meaningTargets:structuredClone(mediaReviewMeanings(p,item)),filmStory:filmStoryReviewContext(p,item),itemId:item.id,variantId:v.id,basis:reviewBasis(p,item,v,true),kind:b.kind,model:'grok-4.7',created,samples};
  const job={id:key,batchId:key,itemId:item.id,purpose:'media-review',mediaReviewPhase:'observe',model:'grok-4.7',kind:'text',prompt:mediaObservationPrompt(samples,b.kind),brief:'Визуальная проверка · независимое наблюдение',refs:samples.map(s=>s.assetId),dialogue:'',camera:'',continuity:'',voiceId:'',duration:0,offset:0,volume:1,created,status:'queued',transportVersion:2,deps:dependencies(p,item.stage),estimate:null,actual:null} as Job;
  (p.mediaReviews??=[]).push(review);p.jobs.push(job);return Response.json(await saveProject(user,p,p.revision));
});
