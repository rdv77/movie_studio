import {z} from 'zod';
import {api,owner,loadProject,saveProject,getKey} from '@/lib/server';
import {CINEMA_RESEARCH_MODELS,cinemaResearchStartSchema,createCinemaReferenceRun,selectCinemaReferences,importCinemaReferenceDraft} from '@/lib/cinema-references';
const choice=z.object({runId:z.string().uuid(),candidateIds:z.array(z.string().min(1).max(80)).max(6)}).strict();
const schema=z.discriminatedUnion('action',[
  z.object({revision:z.number().int(),action:z.literal('start'),data:cinemaResearchStartSchema}).strict(),
  z.object({revision:z.number().int(),action:z.literal('reuse'),data:cinemaResearchStartSchema.extend({runId:z.string().uuid(),candidateIds:z.array(z.string().min(1).max(80)).min(1).max(6)})}).strict(),
  z.object({revision:z.number().int(),action:z.literal('select'),data:choice}).strict(),
  z.object({revision:z.number().int(),action:z.literal('import'),data:z.object({runId:z.string().uuid()}).strict()}).strict(),
]);
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id),body=schema.parse(await req.json());
  if(p.revision!==body.revision)throw Error('Проект изменился. Обновите данные перед действием.');
  if(body.action==='start'||body.action==='reuse'){
    await getKey(user,CINEMA_RESEARCH_MODELS.find(m=>m.id===body.data.model)!.provider);
    if(body.action==='reuse'){const {runId,candidateIds,...input}=body.data;createCinemaReferenceRun(p,input,{runId,candidateIds});}
    else createCinemaReferenceRun(p,body.data);
  }else if(body.action==='select')selectCinemaReferences(p,body.data.runId,body.data.candidateIds);
  else importCinemaReferenceDraft(p,body.data.runId);
  return Response.json(await saveProject(user,p,p.revision));
});
