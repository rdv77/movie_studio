import {z} from 'zod';
import {api,owner,loadProject,saveProject} from '@/lib/server';
import {queueSettingsSchema,saveQueueSettings} from '@/lib/queue-policy';
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const body=z.object({revision:z.number().int(),settings:queueSettingsSchema}).strict().parse(await req.json());
  if(p.revision!==body.revision)throw Error('Проект изменился. Обновите настройки очереди.');
  saveQueueSettings(p,body.settings);
  // Running receipts are retained and continue polling even if a new limit is lower.
  return Response.json(await saveProject(user,p,p.revision));
});
