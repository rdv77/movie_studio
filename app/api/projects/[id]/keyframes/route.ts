import {approveStoryboardSelection} from '@/lib/storyboard-approval';
import {chosen} from '@/lib/domain';
import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset} from '@/lib/server';
import {getItem,stageReady} from '@/lib/domain';
import {KEYFRAME_ROLES,keyframeConfigSchema,keyframeSelectionSchema,setKeyframeMode,chooseKeyframe,reviewKeyframeForCurrentBasis,approveKeyframes} from '@/lib/keyframes';
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const b=z.object({revision:z.number().int(),itemId:z.string().uuid(),action:z.enum(['mode','select','review','approve']),data:z.any()}).parse(await req.json());
  if(p.revision!==b.revision)throw Error('Проект изменился. Обновите карточку ключевых кадров.');
  const item=getItem(p,b.itemId);const v=b.data;
  if(b.action==='select'||b.action==='review'){const selected=item.variants.find(x=>x.id===v?.variantId);if(selected?.assetId){const a=await asset(user,selected.assetId,p);if(!a.mime.startsWith('image/'))throw Error('Ключевой кадр должен быть изображением.');}}
  if(b.action==='approve')for(const key of ['startId','middleId','endId'] as const){const frame=item.variants.find(x=>x.id===(v?.selection?.[key]??item.keyframeSelection?.[key]??(key==='startId'?item.selectedId:undefined)));if(frame?.assetId){const a=await asset(user,frame.assetId,p);if(!a.mime.startsWith('image/'))throw Error('Ключевой кадр должен быть изображением.');}}
  switch(b.action){
    case 'mode':setKeyframeMode(p,b.itemId,keyframeConfigSchema.parse(v).mode);break;
    case 'select':case 'review':{
      const data=z.object({role:z.enum(KEYFRAME_ROLES),variantId:z.string().uuid()}).parse(v);
      if(b.action==='select')chooseKeyframe(p,b.itemId,data.role,data.variantId);else reviewKeyframeForCurrentBasis(p,b.itemId,data.role,data.variantId);break;
    }
    case 'approve':{
      const data=z.object({selection:keyframeSelectionSchema.optional(),reviewChanged:z.boolean().optional()}).parse(v);
      approveStoryboardSelection(p,{itemId:b.itemId,variantId:chosen(item)?.id??'',keyframes:data.selection},data.reviewChanged);break;
    }
  }
  return Response.json(await saveProject(user,p,p.revision));
});
