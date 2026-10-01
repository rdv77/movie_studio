import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset} from '@/lib/server';
import {prepareVideosFromAnimatic,overridePreparedVideoFrame} from '@/lib/video-from-animatic';
export const POST=api(async(req,ctx)=>{
 const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
 const s=z.object({revision:z.number().int(),action:z.enum(['prepare','override']),variantId:z.string().uuid(),itemId:z.string().uuid().optional(),role:z.enum(['start','end']).optional()}).parse(await req.json());
 if(s.revision!==p.revision)throw Error('Проект изменился. Просмотрите текущий состав аниматика.');
 const next=structuredClone(p);
 if(s.action==='prepare')prepareVideosFromAnimatic(next,s.variantId);
 else {if(!s.itemId||!s.role)throw Error('Выберите план и роль кадра.');overridePreparedVideoFrame(next,s.itemId,s.role,s.variantId);}
 for(const item of next.items.filter(i=>i.stage===7&&i.videoPreparation))for(const f of [item.videoPreparation!.startFrame,item.videoPreparation!.endFrame,item.videoPreparation!.middleFrame].filter(Boolean)){
  if(!['image/png','image/jpeg','image/webp'].includes((await asset(user,f!.assetId,p)).mime))throw Error('Исходный кадр должен быть изображением этого проекта.');
 }
 return Response.json(await saveProject(user,next,p.revision));
});
