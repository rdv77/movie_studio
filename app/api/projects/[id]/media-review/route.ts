import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset,getKey} from '@/lib/server';
import {id,now,getItem,dependencies,type Job,type Project} from '@/lib/domain';
import {mediaReviewReferences,mediaReviewPrompt,reviewBasis,type MediaReview} from '@/lib/media-review';
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const b=z.object({revision:z.number().int(),itemId:z.string().uuid(),variantId:z.string().uuid(),kind:z.enum(['image','video','film']),samples:z.array(z.object({assetId:z.string().uuid(),at:z.number().finite().min(0).max(10000).optional(),role:z.enum(['target','start','end','reference','video-sample'])})).min(1).max(8)}).parse(await req.json());
  if(p.revision!==b.revision)throw Error('Проект изменился. Повторите проверку выбранного материала.');
  const item=getItem(p,b.itemId),v=item.variants.find(v=>v.id===b.variantId);
  if(item.planArchive||item.removedAt||!v?.assetId||!['image','video'].includes(v.kind))throw Error('Выберите готовое изображение или видео этого проекта.');
  if(b.kind==='image'&&v.kind!=='image'||b.kind!=='image'&&v.kind!=='video'||b.kind==='film'&&item.stage!==8)throw Error('Тип проверки не соответствует материалу.');
  if(b.kind==='image'&&!b.samples.some(s=>s.assetId===v.assetId&&s.role==='target'))throw Error('Для проверки нужен сам выбранный кадр.');
  const samples=[...b.samples,...mediaReviewReferences(p,item,v)].filter((s,n,a)=>a.findIndex(x=>x.assetId===s.assetId)===n).slice(0,8);
  for(const sample of samples){const a=await asset(user,sample.assetId,p);if(!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024)throw Error('Для проверки нужны изображения PNG/JPEG/WebP до 10 МБ.');}
  if(p.limit!==null)throw Error('Стоимость визуального редактора определяется по токенам. Снимите лимит на время проверки и сверяйте журнал.');await getKey(user,'xai');
  const project=p as Project&{mediaReviews?:MediaReview[]};
  if(project.mediaReviews?.some(r=>r.variantId===v.id&&p.jobs.some(j=>j.id===r.jobId&&['queued','dispatching','pending','saving','unknown'].includes(j.status))))throw Error('Для этого варианта уже есть текущая проверка или запрос с неизвестным исходом. Откройте журнал.');
  const key=id(),created=now();const review:MediaReview={id:key,jobId:key,itemId:item.id,variantId:v.id,basis:reviewBasis(p,item,v),kind:b.kind,model:'grok-4.7',created,samples};
  const job={id:key,batchId:id(),itemId:item.id,purpose:'media-review',model:'grok-4.7',kind:'text',prompt:mediaReviewPrompt(p,item,v,samples,b.kind),brief:'Визуальный редактор',refs:samples.map(s=>s.assetId),dialogue:'',camera:'',continuity:'',voiceId:'',duration:0,offset:0,volume:1,created,status:'queued',transportVersion:2,deps:dependencies(p,item.stage),estimate:null,actual:null} as unknown as Job;
  (project.mediaReviews??=[]).push(review);p.jobs.push(job);return Response.json(await saveProject(user,p,p.revision));
});
