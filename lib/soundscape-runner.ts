import {loadProject,saveProject,mutate,getKey,storeAsset,runtime,HttpError} from '@/lib/server';
import {now,type Project} from './domain';
import {soundJobs,getSoundLayer,soundVariantFromJob,type SoundJob,type SoundscapeProject} from './soundscape';
import {generateSoundscape,SoundResponseError} from './soundscape-provider';
import {safeVoiceError} from './voice-design-provider';
import {queueSlotIssue} from './queue-policy';
const fileKey=(user:string,project:string,job:string)=>`soundscape/${encodeURIComponent(user)}/${project}/${job}`;
async function saveSound(user:string,projectId:string,jobId:string){
  const p=await loadProject(user,projectId),j=soundJobs(p).find(j=>j.id===jobId);if(!j||j.status!=='saving')return;
  const staged=await runtime.FILES.get(fileKey(user,projectId,jobId));if(!staged)throw Error('Полученный звук ещё недоступен в хранилище. Проверьте файл в кабинете; повторная генерация не запускается.');
  const bytes=new Uint8Array(await staged.arrayBuffer());if(!bytes.length||bytes.length>16*1024*1024)throw Error('Полученный звуковой файл имеет недопустимый размер.');
  await storeAsset(user,j.id,j.brief,'audio/mpeg',bytes,projectId);
  await mutate(user,projectId,current=>{const job=soundJobs(current).find(j=>j.id===jobId);if(!job||job.status==='done')return;const layer=getSoundLayer(current as SoundscapeProject,job.soundInput.layerId,true);if(!layer.variants.some(v=>v.jobId===job.id))layer.variants.push(soundVariantFromJob(job));job.status='done';job.error=job.soundInput.late?'Поздний звуковой эффект сохранён для просмотра; выбор и утверждение выполняются отдельно.':undefined;});
}
export async function runSoundscapeStep(user:string,projectId:string,jobId?:string){
  const p=await loadProject(user,projectId),j=soundJobs(p).find(j=>(!jobId||j.id===jobId)&&['queued','saving'].includes(j.status));if(!j)return p;
  if(j.status==='saving'){try{await saveSound(user,projectId,j.id);}catch(e){await mutate(user,projectId,p=>{const current=soundJobs(p).find(v=>v.id===j.id);if(current?.status==='saving')current.error=safeVoiceError(e);});}return loadProject(user,projectId);}
  if(queueSlotIssue(p,j as unknown as import('./domain').Job))return p;
  j.status='dispatching';j.started=now();try{await saveProject(user,p,p.revision);}catch(e){if(e instanceof HttpError&&e.status===409)return loadProject(user,projectId);throw e;}
  let sent=false,key='';
  try{
    key=await getKey(user,'elevenlabs');sent=true;const result=await generateSoundscape(j,key);
    await mutate(user,projectId,p=>{const job=soundJobs(p).find(v=>v.id===j.id)!;job.requestId=result.requestId;job.actual=result.actual;job.usage=result.usage;job.soundInput.late=!!job.waitStoppedAt;job.status='saving';});
    await runtime.FILES.put(fileKey(user,projectId,j.id),result.bytes,{httpMetadata:{contentType:result.mime}});await saveSound(user,projectId,j.id);
  }catch(e){await mutate(user,projectId,p=>{const job=soundJobs(p).find(v=>v.id===j.id);if(!job||job.status==='done')return;if(e instanceof SoundResponseError){job.requestId=e.receipt.requestId;job.actual=e.receipt.actual;job.usage=e.receipt.usage;}job.error=safeVoiceError(e,key);if(job.status==='saving')return;const notSent=!sent||(e as {notSent?:boolean}).notSent;job.status=notSent||(e as {definite?:boolean}).definite?'failed':'unknown';if(notSent){job.actual='0';job.actualSource='Запрос не отправлен';}});}
  return loadProject(user,projectId);
}
export function stopSoundscape(p:Project,jobId:string){const j=soundJobs(p).find(j=>j.id===jobId);if(!j)throw Error('Попытка звука текущего проекта не найдена.');if(!['queued','dispatching','saving'].includes(j.status))return;j.waitStoppedAt=now();j.waitStopReason='manual';if(j.status==='queued'){j.status='cancelled';j.actual='0';j.actualSource='Запрос не отправлен';}else if(j.status==='dispatching'){j.status='unknown';j.error='Ожидание остановлено. Запрос мог быть принят; автоматического повтора не будет.';}}
