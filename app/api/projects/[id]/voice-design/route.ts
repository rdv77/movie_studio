import {z} from 'zod';
import {api,owner,loadProject,saveProject,getKey,HttpError} from '@/lib/server';
import {model} from '@/lib/models';
import {queueVoiceDesign,validateVoiceDesignInput,queueSaveVoice,selectVoicePreview,saveVoiceProfile,chooseVoiceProfile,assignVoiceProfile,queueVoiceDirection,applyVoiceDirectionCandidate,voiceWorkflowJobs,completeVoiceSave} from '@/lib/voice-design';
import {saveVoiceDelivery,voiceStudio,characterAudioModeSchema,type VoiceStudioProject} from '@/lib/voice-direction';
import {runVoiceWorkflowStep,stopVoiceWorkflow} from '@/lib/voice-design-runner';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),projectId=(await ctx.params).id,p=await loadProject(user,projectId) as VoiceStudioProject;
  const body=z.object({revision:z.number().int(),action:z.enum(['setCharacterAudioMode','design','advance','selectPreview','saveVoice','importSavedVoice','saveProfile','chooseProfile','assignProfile','saveDelivery','proposeDelivery','applyDelivery','stop','removeDesign','restoreDesign','removeProfile','restoreProfile']),data:z.any()}).parse(await req.json());
  const v=body.data;
  if(body.action==='advance'){
    const jobId=v?.jobId===undefined?undefined:z.string().uuid().parse(v.jobId);
    if(jobId&&!voiceWorkflowJobs(p).some(j=>j.id===jobId))throw Error('Попытка текущего проекта не найдена.');
    return Response.json(await runVoiceWorkflowStep(user,projectId,jobId));
  }
  // Duplicate series IDs are acknowledged before revision admission; no new charge.
  if(['design','proposeDelivery','saveVoice'].includes(body.action)&&typeof v?.batchId==='string'&&voiceWorkflowJobs(p).some(j=>j.batchId===v.batchId))return Response.json(p);
  if(body.revision!==p.revision)throw new HttpError('Проект изменился. Обновите данные перед сохранением.',409);
  switch(body.action){
    case 'setCharacterAudioMode':voiceStudio(p).characterAudioMode=characterAudioModeSchema.parse(v.mode);break;
    case 'design':{
      const input=validateVoiceDesignInput(v.input);await getKey(user,input.provider);queueVoiceDesign(p,z.string().uuid().parse(v.batchId),input);break;
    }
    case 'selectPreview':selectVoicePreview(p,z.string().uuid().parse(v.designId),z.string().uuid().parse(v.previewId));break;
    case 'saveVoice':{
      const design=voiceStudio(p).designs.find(d=>d.id===v.designId&&!d.removedAt);if(!design)throw Error('Серия голосов не найдена.');
      if(design.provider==='elevenlabs')await getKey(user,'elevenlabs');queueSaveVoice(p,z.string().uuid().parse(v.batchId),z.string().uuid().parse(v.designId));break;
    }
    case 'importSavedVoice':{
      const j=voiceWorkflowJobs(p).find(j=>j.id===z.string().uuid().parse(v.jobId));if(!j?.voiceWorkflow.savedVoiceId||j.voiceWorkflow.input.operation!=='save')throw Error('Провайдер ещё не подтвердил сохранение этого голоса.');
      const input=j.voiceWorkflow.input;completeVoiceSave(p,input.designId,j.voiceWorkflow.savedVoiceId,j.id,input.previewId);break;
    }
    case 'saveProfile':saveVoiceProfile(p,v.profile,v.profileId===undefined?undefined:z.string().uuid().parse(v.profileId));break;
    case 'chooseProfile':chooseVoiceProfile(p,z.string().uuid().parse(v.profileId));break;
    case 'assignProfile':assignVoiceProfile(p,z.string().uuid().parse(v.itemId),v.profileId===null?undefined:z.string().uuid().parse(v.profileId));break;
    case 'saveDelivery':saveVoiceDelivery(p,z.string().uuid().parse(v.itemId),v.delivery);break;
    case 'proposeDelivery':{
      const m=model(z.string().parse(v.model));if(m.kind!=='text')throw Error('Выберите текстовую модель.');await getKey(user,m.provider);
      queueVoiceDirection(p,z.string().uuid().parse(v.batchId),z.string().uuid().parse(v.itemId),m.id,z.string().max(2000).parse(v.instruction));break;
    }
    case 'applyDelivery':applyVoiceDirectionCandidate(p,z.string().uuid().parse(v.candidateId));break;
    case 'stop':stopVoiceWorkflow(p,z.string().uuid().parse(v.jobId));break;
    case 'removeDesign':case 'restoreDesign':{
      const d=voiceStudio(p).designs.find(d=>d.id===z.string().uuid().parse(v.designId));if(!d)throw Error('Серия голосов не найдена.');
      if(body.action==='removeDesign'&&voiceWorkflowJobs(p).some(j=>j.itemId===d.id&&['queued','dispatching','saving'].includes(j.status)))throw Error('Сначала остановите незавершённые попытки этой серии.');
      d.removedAt=body.action==='removeDesign'?new Date().toISOString():undefined;break;
    }
    case 'removeProfile':case 'restoreProfile':{
      const s=voiceStudio(p),profile=s.profiles.find(p=>p.id===z.string().uuid().parse(v.profileId));if(!profile)throw Error('Профиль голоса не найден.');
      profile.removedAt=body.action==='removeProfile'?new Date().toISOString():undefined;
      if(profile.removedAt){if(s.selectedProfileId===profile.id){s.selectedProfileId=undefined;if(p.preferredVoice?.voiceId===profile.voiceId)p.preferredVoice=undefined;}for(const [itemId,profileId] of Object.entries(s.castings??{}))if(profileId===profile.id)delete s.castings![itemId];}break;
    }
  }
  return Response.json(await saveProject(user,p,p.revision));
});
