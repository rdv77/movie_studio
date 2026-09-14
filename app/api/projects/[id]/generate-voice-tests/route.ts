import { z } from 'zod';
import { api, owner, loadProject, saveProject, getKey } from '@/lib/server';
import { id, now, assertBudget, type Job } from '@/lib/domain';
import { model } from '@/lib/models';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const s=z.object({revision:z.number().int(),batchId:z.string().uuid(),phrase:z.string().trim().min(1).max(500),
    voices:z.array(z.object({model:z.string(),voiceId:z.string().trim().min(1).max(150),name:z.string().trim().min(1).max(160),
      estimate:z.string().regex(/^\d+$/).nullable()})).min(1).max(8)}).parse(await req.json());
  if(p.jobs.some(j=>j.batchId===s.batchId))return Response.json(p);
  if(p.revision!==s.revision)throw new Error('Проект изменился. Проверьте сравнение ещё раз.');
  if(new Set(s.voices.map(v=>JSON.stringify([v.model,v.voiceId]))).size!==s.voices.length)throw new Error('Один голос одной модели можно включить в сравнение только один раз.');
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw new Error('Дождитесь завершения текущей серии.');
  const comparisonId=id(),created=now(),providers=new Set<string>();
  const jobs:Job[]=s.voices.map(v=>{
    const m=model(v.model);if(m.kind!=='audio'||!['minimax','elevenlabs'].includes(m.provider))throw new Error('Выберите модель озвучки MiniMax или ElevenLabs.');
    providers.add(m.provider);
    return {id:id(),itemId:comparisonId,batchId:s.batchId,purpose:'voice-test',voiceName:v.name,model:m.id,voiceId:v.voiceId,
      kind:'audio',dialogue:s.phrase,prompt:s.phrase,brief:'Проба голоса · '+v.name,speechType:'voiceover',speaker:'',
      refs:[],duration:5,offset:0,volume:1,camera:'',continuity:'',deps:'voice-test-v1',created,status:'queued',transportVersion:2,estimate:v.estimate,actual:null};
  });
  assertBudget(p,jobs);
  for(const provider of providers)await getKey(user,provider);
  p.voiceComparisons??=[];
  p.voiceComparisons.push({id:comparisonId,phrase:s.phrase,created,samples:jobs.map(j=>({jobId:j.id,model:j.model,voiceId:j.voiceId,name:j.voiceName!}))});
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user,p,s.revision));
});
