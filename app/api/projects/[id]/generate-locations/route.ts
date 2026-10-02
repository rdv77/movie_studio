import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset,getKey} from '@/lib/server';
import {stageReady} from '@/lib/domain';
import {model} from '@/lib/models';
import {createLocationImageJobs} from '@/lib/scene-locations';
import {enqueuePlanJobs} from '@/lib/generation-queue';
import {validateCompiledMediaAssets,type PromptAsset} from '@/lib/prompt-assets';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const s=z.object({revision:z.number().int(),batchId:z.string().uuid(),model:z.string(),itemIds:z.array(z.string().uuid()).min(1).max(120),count:z.number().int().min(1).max(4),estimate:z.string().regex(/^\d+$/).nullable()}).parse(await req.json());
  if(p.jobs.some(j=>j.batchId===s.batchId))return Response.json(p);
  if(p.revision!==s.revision)throw Error('Проект изменился. Проверьте описания локаций перед запуском.');
  if(!stageReady(p,3))throw Error('Утвердите сценарий, структуру сцен и визуальный стиль.');
  const jobs=createLocationImageJobs(p,{...s,estimate:model(s.model).estimate}),loaded=new Map<string,Promise<PromptAsset>>();
  const load=(ref:string)=>{let value=loaded.get(ref);if(!value){value=asset(user,ref,p);loaded.set(ref,value);}return value;};
  for(const job of jobs)await validateCompiledMediaAssets(job,load);
  await getKey(user,model(s.model).provider);
  return Response.json(await enqueuePlanJobs(p,jobs,()=>loadProject(user,p.id),(next,revision)=>saveProject(user,next,revision)));
});
