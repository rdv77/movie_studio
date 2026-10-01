import {z} from 'zod';
import {id,now,assertBudget,type Job,type Project} from './domain';
import {model} from './models';
import {chosen} from './domain';
import {voiceStudio,readVoiceStudio,voiceDeliverySchema,voiceProfileSchema,saveVoiceDelivery,type VoiceStudioProject,type VoiceDelivery,type VoiceDesign,type VoicePreview,type VoiceProfile} from './voice-direction';

export const voiceDesignInputSchema=z.object({provider:z.enum(['elevenlabs','minimax']),name:z.string().trim().min(1).max(100),description:z.string().trim().min(1).max(1000),previewText:z.string().trim().min(1).max(1000),model:z.enum(['eleven_multilingual_ttv_v2','eleven_ttv_v3']).optional(),variants:z.number().int().min(1).max(3).optional()}).strict();
export type VoiceDesignInput=z.infer<typeof voiceDesignInputSchema>;
export type VoiceWorkflowInput={operation:'design';designId:string;input:VoiceDesignInput}|{operation:'save';designId:string;previewId:string;generatedVoiceId:string;name:string;description:string}|{operation:'direction';itemId:string;sourceDialogue:string;prompt:string};
export type VoiceWorkflowJob=Omit<Job,'purpose'>&{purpose:'voice-design';voiceWorkflow:{provider:string;input:VoiceWorkflowInput;previews?:VoicePreview[];savedVoiceId?:string;late?:boolean}};
export function isVoiceWorkflowJob(value:unknown):value is VoiceWorkflowJob{return !!value&&typeof value==='object'&&(value as VoiceWorkflowJob).purpose==='voice-design'&&!!(value as VoiceWorkflowJob).voiceWorkflow;}
export function voiceWorkflowJobs(p:Project){return p.jobs.filter(isVoiceWorkflowJob) as unknown as VoiceWorkflowJob[];}
export function validateVoiceDesignInput(value:unknown){
  const input=voiceDesignInputSchema.parse(value);
  if(input.provider==='elevenlabs'){
    if(input.description.length<20||input.previewText.length<100)throw Error('ElevenLabs: описание голоса — 20–1000 символов, пробная фраза — 100–1000 символов.');
    if(input.variants!==undefined&&input.variants!==1)throw Error('ElevenLabs возвращает несколько вариантов одним запросом; число вариантов определяется провайдером.');
  }else if(input.previewText.length>500)throw Error('MiniMax: пробная фраза должна содержать не более 500 символов.');
  return input;
}
export function voiceDesignEstimate(input:VoiceDesignInput){return input.provider==='minimax'?(BigInt(input.previewText.length)*300000n).toString():null;}
function job(input:VoiceWorkflowInput,provider:string,modelId:string,batchId:string,itemId:string,estimate:string|null,prompt:string):VoiceWorkflowJob{
  return {id:id(),itemId,batchId,purpose:'voice-design',voiceWorkflow:{provider,input:structuredClone(input)},model:modelId,kind:input.operation==='design'?'audio':'text',voiceId:'',dialogue:input.operation==='design'?input.input.previewText:input.operation==='direction'?input.sourceDialogue:'',prompt,brief:input.operation==='design'?'Создание голоса':input.operation==='save'?'Сохранение выбранного голоса':'Агент исполнения реплики',refs:[],duration:5,offset:0,volume:1,camera:'',continuity:'',deps:'voice-workflow-v1',created:now(),status:'queued',transportVersion:2,estimate,actual:null};
}
function addJobs(p:Project,jobs:VoiceWorkflowJob[]){assertBudget(p,jobs as unknown as Job[]);p.jobs.push(...jobs as unknown as Job[]);}
export function queueVoiceDesign(p:VoiceStudioProject,batchId:string,value:unknown):VoiceDesign|undefined{
  if(voiceWorkflowJobs(p).some(j=>j.batchId===batchId))return readVoiceStudio(p).designs.find(d=>d.jobIds.some(id=>voiceWorkflowJobs(p).some(j=>j.id===id&&j.batchId===batchId)));
  z.string().uuid().parse(batchId);const input=validateVoiceDesignInput(value),designId=id(),count=input.provider==='minimax'?input.variants??1:1;
  const modelId=input.provider==='elevenlabs'?input.model??'eleven_ttv_v3':'minimax-voice-design';
  const jobs=Array.from({length:count},()=>job({operation:'design',designId,input},input.provider,modelId,batchId,designId,voiceDesignEstimate(input),JSON.stringify(voiceDesignPayload(input))));
  assertBudget(p,jobs as unknown as Job[]);const design:VoiceDesign={id:designId,provider:input.provider,name:input.name,description:input.description,previewText:input.previewText,model:modelId,created:now(),jobIds:jobs.map(j=>j.id),previews:[]};
  const s=voiceStudio(p);if(s.designs.filter(d=>!d.removedAt).length>=100)throw Error('В рабочем списке 100 серий голосов. Удалите ненужные серии.');
  s.designs.push(design);p.jobs.push(...jobs as unknown as Job[]);return design;
}
export function voiceDesignPayload(input:VoiceDesignInput):Record<string,unknown>{
  validateVoiceDesignInput(input);return input.provider==='minimax'?{prompt:input.description,preview_text:input.previewText}:{voice_description:input.description,text:input.previewText,auto_generate_text:false,model_id:input.model??'eleven_ttv_v3',stream_previews:false};
}
export function selectVoicePreview(p:VoiceStudioProject,designId:string,previewId:string){
  const d=readVoiceStudio(p).designs.find(d=>d.id===designId&&!d.removedAt),preview=d?.previews.find(v=>v.id===previewId&&v.assetId);
  if(!d||!preview)throw Error('Готовый вариант голоса текущего проекта не найден.');d.selectedPreviewId=preview.id;
}
export function saveVoiceProfile(p:VoiceStudioProject,value:unknown,profileId?:string){
  const input=voiceProfileSchema.parse(value);if(input.characterId&&!p.items.some(i=>i.id===input.characterId&&i.stage===1&&!i.removedAt))throw Error('Герой текущего проекта не найден.');
  const s=voiceStudio(p),existing=profileId?s.profiles.find(v=>v.id===profileId&&!v.removedAt):undefined;if(profileId&&!existing)throw Error('Профиль голоса не найден.');
  if(existing){Object.assign(existing,input);return existing;}
  if(s.profiles.filter(p=>!p.removedAt).length>=100)throw Error('В рабочем списке максимум 100 профилей голосов.');const profile:VoiceProfile={...input,id:id(),created:now()};s.profiles.push(profile);return profile;
}
export function chooseVoiceProfile(p:VoiceStudioProject,profileId:string){
  const s=voiceStudio(p),profile=s.profiles.find(v=>v.id===profileId&&!v.removedAt);if(!profile)throw Error('Профиль голоса не найден.');
  s.selectedProfileId=profileId;p.preferredVoice={model:profile.provider==='elevenlabs'?'eleven_v3':'speech-2.8-hd',voiceId:profile.voiceId,name:profile.name};
}
export function assignVoiceProfile(p:VoiceStudioProject,itemId:string,profileId?:string){
  if(!p.items.some(i=>i.id===itemId&&i.stage===6&&!i.removedAt&&!i.excludedAt&&!i.planArchive))throw Error('План озвучки текущего проекта не найден.');
  const s=voiceStudio(p);if(profileId&&!s.profiles.some(v=>v.id===profileId&&!v.removedAt))throw Error('Профиль голоса текущего проекта не найден.');
  s.castings??={};if(profileId)s.castings[itemId]=profileId;else delete s.castings[itemId];
}
export function queueSaveVoice(p:VoiceStudioProject,batchId:string,designId:string):VoiceWorkflowJob|VoiceProfile{
  z.string().uuid().parse(batchId);const d=readVoiceStudio(p).designs.find(d=>d.id===designId&&!d.removedAt),preview=d?.previews.find(v=>v.id===d.selectedPreviewId&&v.assetId);
  if(!d||!preview)throw Error('Сначала прослушайте и выберите готовый вариант голоса.');
  if(d.profileId){const existing=readVoiceStudio(p).profiles.find(v=>v.id===d.profileId);if(existing)return existing;}
  const existing=d.saveJobId?voiceWorkflowJobs(p).find(j=>j.id===d.saveJobId):undefined;
  if(existing&&(!(existing.status==='failed'||existing.status==='cancelled')||existing.batchId===batchId))return existing;
  if(voiceWorkflowJobs(p).some(j=>j.batchId===batchId))throw Error('Идентификатор серии уже использован.');
  if(d.provider==='minimax')return completeVoiceSave(p,d.id,preview.generatedVoiceId,undefined,preview.id);
  const input:VoiceWorkflowInput={operation:'save',designId:d.id,previewId:preview.id,generatedVoiceId:preview.generatedVoiceId,name:d.name,description:d.description};
  const j=job(input,d.provider,'elevenlabs-voice-save',batchId,d.id,null,JSON.stringify(voiceSavePayload(input)));addJobs(p,[j]);d.saveJobId=j.id;return j;
}
export function voiceSavePayload(input:Extract<VoiceWorkflowInput,{operation:'save'}>){return {voice_name:input.name,voice_description:input.description,generated_voice_id:input.generatedVoiceId,labels:{language:'ru'}};}
export function completeVoiceSave(p:VoiceStudioProject,designId:string,voiceId:string,jobId?:string,previewId?:string){
  const d=voiceStudio(p).designs.find(d=>d.id===designId);if(!d)throw Error('Серия голосов больше не существует.');
  const existing=d.profileId?readVoiceStudio(p).profiles.find(v=>v.id===d.profileId):undefined;if(existing)return existing;
  const preview=d.previews.find(v=>v.id===(previewId??d.selectedPreviewId));
  const profile=saveVoiceProfile(p,{name:d.name,description:d.description,provider:d.provider,voiceId,delivery:{}});profile.sourceJobId=jobId??d.jobIds[0];profile.previewAssetId=preview?.assetId;d.profileId=profile.id;d.savedVoiceId=voiceId;
  return profile;
}
export function voiceDirectionPrompt(p:Project,itemId:string,instruction:string){
  const item=p.items.find(i=>i.id===itemId&&i.stage===6&&!i.removedAt&&!i.planArchive),v=item&&chosen(item);if(!item||!v?.dialogue.trim())throw Error('Сначала подготовьте реплику выбранного плана.');
  const shot=p.directing?.scenes.flatMap(scene=>scene.shots.map(shot=>({scene,shot}))).find(row=>row.shot.id===item.sourceShot?.shotId);
  const cast=p.items.filter(i=>i.stage===1&&!i.removedAt&&shot&&(shot.shot.characterIds?.includes(i.id)||shot.shot.cast.includes(i.character?.name??i.title))).map(i=>({name:i.character?.name??i.title,profile:i.character}));
  return {dialogue:v.dialogue,prompt:`Ты режиссёр озвучки анимационного фильма. Предложи один вариант исполнения, сохрани все произносимые слова. Не создавай аудио и не выбирай/утверждай голос. targetSeconds — ориентир, точная длительность TTS не гарантирована. intention — задача актёра, она не произносится. emotion только neutral,happy,sad,angry,fearful,disgusted,surprised. speed 0.7–1.2 для совместимости. Каждая pauses.after — уникальная буквальная подстрока реплики, после которой есть ещё слова; seconds 0.01–3. Не добавляй служебные инструкции в реплику. Ответ только JSON {"delivery":{"emotion":"neutral","intention":"...","speed":1,"targetSeconds":5,"pauses":[]},"notes":["почему подходит"]}.\nЗамороженные данные фильма: ${JSON.stringify({brief:p.directing?.brief,scene:shot?.scene.title,shot:shot?.shot,heroes:cast,dialogue:v.dialogue,availableSeconds:v.duration})}\nПожелания режиссёра: ${instruction}`};
}
export function queueVoiceDirection(p:VoiceStudioProject,batchId:string,itemId:string,modelId:string,instruction:string){
  z.string().uuid().parse(batchId);if(voiceWorkflowJobs(p).some(j=>j.batchId===batchId))return;
  const m=model(modelId);if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Выберите текстовую модель для агента.');
  const source=voiceDirectionPrompt(p,itemId,z.string().max(2000).parse(instruction));addJobs(p,[job({operation:'direction',itemId,sourceDialogue:source.dialogue,prompt:source.prompt},m.provider,m.id,batchId,itemId,null,source.prompt)]);
}
export const voiceDirectionResultSchema=z.object({delivery:voiceDeliverySchema,notes:z.array(z.string().max(1000)).max(20)}).strict();
export function applyVoiceDirectionCandidate(p:VoiceStudioProject,candidateId:string){
  const s=voiceStudio(p),candidate=s.candidates.find(v=>v.id===candidateId);if(!candidate)throw Error('Предложение исполнения не найдено.');if(candidate.applied)return;
  const j=voiceWorkflowJobs(p).find(j=>j.id===candidate.jobId),input=j?.voiceWorkflow.input,item=p.items.find(i=>i.id===candidate.itemId),v=item&&chosen(item);
  if(input?.operation!=='direction'||v?.dialogue!==input.sourceDialogue)throw Error('Реплика изменилась после предложения. Проверьте исполнение для новой версии.');
  saveVoiceDelivery(p,candidate.itemId,candidate.delivery);candidate.applied=true;
}
