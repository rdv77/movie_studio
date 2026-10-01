import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset} from '@/lib/server';
import {prepareVideosFromAnimatic,overridePreparedVideoFrame,cropPreparedVideoFrame} from '@/lib/video-from-animatic';
import {frameCropTransformSchema} from '@/lib/frame-crop';
export const POST=api(async(req,ctx)=>{
 const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
 const base={revision:z.number().int()},frame={itemId:z.string().uuid(),role:z.enum(['start','end'])};
 const s=z.discriminatedUnion('action',[
  z.object({...base,action:z.literal('prepare'),variantId:z.string().uuid()}),
  z.object({...base,...frame,action:z.literal('override'),variantId:z.string().uuid()}),
  z.object({...base,...frame,action:z.literal('crop'),sourceVariantId:z.string().uuid(),expectedAssetId:z.string().uuid(),assetId:z.string().uuid(),transform:frameCropTransformSchema}),
 ]).parse(await req.json());
 if(s.revision!==p.revision)throw Error('Проект изменился. Просмотрите текущий состав аниматика.');
 const next=structuredClone(p);
 if(s.action==='prepare')prepareVideosFromAnimatic(next,s.variantId);
 else if(s.action==='override')overridePreparedVideoFrame(next,s.itemId,s.role,s.variantId);
 else {
  // Incoming files must belong before mutation; adding their IDs to the next
  // snapshot must not grant cross-project membership.
  const derived=await asset(user,s.assetId,p),original=await asset(user,s.transform.sourceAssetId,p);
  if(derived.project_id!==p.id)throw Error('Подготовленный PNG должен быть сохранён в этом проекте.');
  if(derived.mime!=='image/png'||derived.size<=0||derived.size>10*1024*1024)throw Error('Подготовленный кадр: PNG до 10 МБ.');
  if(!['image/png','image/jpeg','image/webp'].includes(original.mime)||original.size<=0)throw Error('Исходный файл должен быть изображением этого плана.');
  cropPreparedVideoFrame(next,s.itemId,s.role,s);
 }
 for(const item of next.items.filter(i=>i.stage===7&&i.videoPreparation))for(const f of [item.videoPreparation!.startFrame,item.videoPreparation!.endFrame,item.videoPreparation!.middleFrame].filter(Boolean)){
  if(!['image/png','image/jpeg','image/webp'].includes((await asset(user,f!.assetId,p)).mime))throw Error('Исходный кадр должен быть изображением этого проекта.');
  if(f!.transform)await asset(user,f!.transform.sourceAssetId,p);
 }
 return Response.json(await saveProject(user,next,p.revision));
});
