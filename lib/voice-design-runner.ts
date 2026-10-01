import {queueSlotIssue} from './queue-policy';
import {loadProject,saveProject,mutate,getKey,storeAsset,runtime,HttpError} from '@/lib/server';
import {id,now,type Project,type Job} from './domain';
import {callVoiceWorkflow,VoiceWorkflowResponseError,safeVoiceError,type VoiceProviderResult} from './voice-design-provider';
import {voiceWorkflowJobs,completeVoiceSave,type VoiceWorkflowJob} from './voice-design';
import {voiceStudio,type VoiceStudioProject,type VoicePreview} from './voice-direction';

const stageKey=(user:string,projectId:string,jobId:string,previewId:string)=>`voice-workflow/${encodeURIComponent(user)}/${projectId}/${jobId}/${previewId}`;
function receipt(j:VoiceWorkflowJob,result:Pick<VoiceProviderResult,'requestId'|'actual'|'usage'|'text'>){
  j.requestId=result.requestId;j.actual=result.actual;j.usage=result.usage;if(result.actual!==null)j.actualSource='Ответ API';if(result.text!==undefined)j.output={text:result.text};
}
async function savePreviews(user:string,projectId:string,jobId:string){
  const p=await loadProject(user,projectId),j=voiceWorkflowJobs(p).find(j=>j.id===jobId);if(!j||j.status!=='saving'||j.voiceWorkflow.input.operation!=='design')return;
  for(const preview of j.voiceWorkflow.previews??[]){
    if(preview.assetId)continue;const object=await runtime.FILES.get(stageKey(user,projectId,j.id,preview.id));if(!object)throw Error('Полученная проба ещё не доступна в хранилище. Повторите сохранение файла; новая генерация не запускается.');
    const bytes=new Uint8Array(await object.arrayBuffer());if(!bytes.length||bytes.length>8*1024*1024)throw Error('Сохранённая проба голоса имеет недопустимый размер.');
    const assetId=await storeAsset(user,preview.id,'Проба созданного голоса',preview.mime,bytes,projectId);
    await mutate(user,projectId,current=>{
      const job=voiceWorkflowJobs(current).find(j=>j.id===jobId),input=job?.voiceWorkflow.input;if(!job||input?.operation!=='design')return;
      const saved=job.voiceWorkflow.previews?.find(v=>v.id===preview.id);if(saved)saved.assetId=assetId;
      const d=voiceStudio(current as VoiceStudioProject).designs.find(d=>d.id===input.designId);if(d&&!d.previews.some(v=>v.id===preview.id))d.previews.push({...preview,assetId});
      else if(d){const row=d.previews.find(v=>v.id===preview.id)!;row.assetId=assetId;}
    });
  }
  await mutate(user,projectId,current=>{const j=voiceWorkflowJobs(current).find(j=>j.id===jobId);if(j?.voiceWorkflow.previews?.length&&j.voiceWorkflow.previews.every(v=>v.assetId)){j.status='done';j.error=j.voiceWorkflow.late?'Поздний ответ сохранён как варианты для просмотра. Выбор и сохранение голоса выполняются отдельно.':undefined;}});
}
/** Independent executor; the paid call is outside CAS retries and never repeated for unknown/failed jobs. */
export async function runVoiceWorkflowStep(user:string,projectId:string,jobId?:string){
  const snapshot=await loadProject(user,projectId),next=voiceWorkflowJobs(snapshot).find(j=>(!jobId||j.id===jobId)&&['queued','saving'].includes(j.status));
  if(!next)return snapshot;
  if(next.status==='saving'){
    try{await savePreviews(user,projectId,next.id);}catch(error){await mutate(user,projectId,p=>{const j=voiceWorkflowJobs(p).find(j=>j.id===next.id);if(j&&j.status==='saving')j.error=safeVoiceError(error);});}
    return loadProject(user,projectId);
  }
  if(queueSlotIssue(snapshot,next))return snapshot;
  next.status='dispatching';next.started=now();
  try{await saveProject(user,snapshot,snapshot.revision);}catch(error){if(error instanceof HttpError&&error.status===409)return loadProject(user,projectId);throw error;}
  let sent=false,key='';
  try{
    key=await getKey(user,next.voiceWorkflow.provider);sent=true;
    const result=await callVoiceWorkflow(next,key,snapshot.format);
    const previews:VoicePreview[]=(result.previews??[]).map(v=>({id:id(),generatedVoiceId:v.generatedVoiceId,mime:v.mime,duration:v.duration,language:v.language}));
    await mutate(user,projectId,current=>{
      const j=voiceWorkflowJobs(current).find(j=>j.id===next.id);if(!j)return;receipt(j,result);j.voiceWorkflow.late=!!j.waitStoppedAt;
      const input=j.voiceWorkflow.input;
      if(input.operation==='design'){j.voiceWorkflow.previews=previews;j.status='saving';}
      else if(input.operation==='save'){
        j.voiceWorkflow.savedVoiceId=result.voiceId;j.status='done';
        if(j.voiceWorkflow.late)j.error='Голос сохранён у провайдера после остановки ожидания. Добавьте полученный голос в проект отдельной кнопкой.';
        else completeVoiceSave(current as VoiceStudioProject,input.designId,result.voiceId!,j.id,input.previewId);
      }else{
        const s=voiceStudio(current as VoiceStudioProject);if(result.candidate&&!s.candidates.some(c=>c.jobId===j.id))s.candidates.push({id:id(),jobId:j.id,itemId:input.itemId,...result.candidate,created:now()});j.status='done';
        if(j.voiceWorkflow.late)j.error='Поздний ответ сохранён как предложение. Настройки озвучки не изменены.';
      }
    });
    for(const [n,preview] of previews.entries())await runtime.FILES.put(stageKey(user,projectId,next.id,preview.id),result.previews![n].bytes,{httpMetadata:{contentType:preview.mime}});
    if(previews.length)await savePreviews(user,projectId,next.id);
  }catch(error){
    await mutate(user,projectId,current=>{
      const j=voiceWorkflowJobs(current).find(j=>j.id===next.id);if(!j||j.status==='done')return;
      if(error instanceof VoiceWorkflowResponseError)receipt(j,error.receipt);
      if(j.status==='saving'){j.error=safeVoiceError(error,key);return;}
      const notSent=!sent||(error as {notSent?:boolean}).notSent;
      j.status=notSent||(error as {definite?:boolean}).definite?'failed':'unknown';j.error=safeVoiceError(error,key);
      if(notSent){j.actual='0';j.actualSource='Запрос не отправлен';}
    });
  }
  return loadProject(user,projectId);
}
export function stopVoiceWorkflow(p:Project,jobId:string){
  const j=voiceWorkflowJobs(p).find(j=>j.id===jobId);if(!j)throw Error('Попытка текущего проекта не найдена.');
  if(!['queued','dispatching','saving'].includes(j.status))return;j.waitStoppedAt=now();j.waitStopReason='manual';
  if(j.status==='queued'){j.status='cancelled';j.actual='0';j.actualSource='Запрос не отправлен';j.error='Остановлено до отправки провайдеру.';}
  else if(j.status==='dispatching'){j.status='unknown';j.error='Ожидание остановлено. Запрос мог быть принят провайдером; автоматического повтора не будет.';}
}
