import type { Job } from './domain';
import type { Result } from './providers';
import { call, json, ProviderError } from './provider-http';
import { GOOGLE_OMNI, isGoogleVideo, prepareGoogleJobs } from './google-models';

const BASE='https://generativelanguage.googleapis.com/v1beta';
const h=(key:string)=>({'x-goog-api-key':key,'Content-Type':'application/json','Api-Revision':'2026-05-20'});
const token=/^[A-Za-z0-9_-]{1,2048}$/;
function taskUrl(j:Job,id:string) {
  if(!isGoogleVideo(j.model))throw new ProviderError('Google: неизвестная модель.',true,true);
  if(j.model===GOOGLE_OMNI&&token.test(id))return `${BASE}/interactions/${id}`;
  if(j.model!==GOOGLE_OMNI&&id.startsWith(`models/${j.model}/operations/`)&&token.test(id.split('/')[3]??'')&&id.split('/').length===4)
    return `${BASE}/${id}`;
  throw new ProviderError('Google: некорректный идентификатор задачи. Новая генерация не запускается.',true,true);
}
function fileUrl(value:unknown) {
  if(typeof value!=='string')throw new ProviderError('Google: отсутствует адрес видео.',true);
  const url=new URL(value.startsWith('files/')?`${BASE}/${value}`:value);
  if(url.origin!=='https://generativelanguage.googleapis.com'||url.username||url.password||url.hash||!/^\/v1beta\/files\/[A-Za-z0-9_-]+(?::download)?$/.test(url.pathname))
    throw new ProviderError('Google: неожиданный адрес файла. Ключ не передан.',true);
  // Never retain a provider-supplied key/query in project state.
  return new URL(`${url.origin}${url.pathname.replace(/:download$/,'')}`);
}
function usage(d:any) {
  // Persist counters only; never steps, thoughts, prompt or inline media in D1.
  const source=d.usage??d.usageMetadata;
  if(!source||typeof source!=='object')return undefined;
  return Object.fromEntries(Object.entries(source).filter(([k,v])=>/token|second/i.test(k)&&typeof v==='number'&&Number.isFinite(v)));
}
export async function generateGoogle(j:Job,key:string,refs:string[],format:string):Promise<Result> {
  const image=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(refs[0]??'');
  if(refs.length!==1||!image||image[2].length%4||!['16:9','9:16'].includes(format))throw new ProviderError('Google: нужен один первый кадр PNG/JPEG/WebP и формат 16:9 или 9:16.',true,true);
  try{prepareGoogleJobs([j],[{mime:image[1],size:image[2].length*3/4}]);}catch(e){throw new ProviderError((e as Error).message,true,true);}
  const omni=j.model===GOOGLE_OMNI;
  const body=omni?{
    model:j.model,background:true,store:true,stream:false,
    input:[{type:'image',data:image[2],mime_type:image[1]},{type:'text',text:j.prompt+'\nCreate a single continuous 10-second shot, no cuts. Use the supplied image as the opening composition. Preserve its animated style.'}],
    response_format:{type:'video',aspect_ratio:format,resolution:'720p',delivery:'uri'},
  }:{instances:[{prompt:j.prompt,image:{bytesBase64Encoded:image[2],mimeType:image[1]}}],
    parameters:{aspectRatio:format,durationSeconds:8,resolution:'720p',sampleCount:1}};
  const d=await json(await call(omni?`${BASE}/interactions`:`${BASE}/models/${j.model}:predictLongRunning`,h(key),body));
  const requestId=omni?d.id:d.name;
  if(typeof requestId!=='string'||!requestId)throw new ProviderError('Google: запрос отправлен, но номер задачи не получен. Проверьте кабинет; автоматического повтора не будет.');
  taskUrl(j,requestId);
  // Persist the receipt before downloading media. Even an immediately completed
  // generation is read again by ID; a storage retry never repeats the paid POST.
  return {pending:true,requestId,actual:null,usage:usage(d)};
}
export async function pollGoogle(j:Job,key:string):Promise<Result> {
  const requestId=j.requestId??'';
  const d=await json(await call(taskUrl(j,requestId),h(key)));
  const omni=j.model===GOOGLE_OMNI;
  if((omni?d.id:d.name)!==requestId)throw new ProviderError('Google: получен ответ другой задачи. Новая генерация не запускается.');
  const receipt={requestId,actual:null,usage:usage(d)};
  if(omni&&['queued','in_progress'].includes(d.status)||!omni&&!d.done&&!d.error)return {...receipt,pending:true};
  if(d.error||omni&&['failed','cancelled','requires_action'].includes(d.status))
    return {...receipt,error:'Google не завершил генерацию: ошибка, ограничение доступа или фильтр содержимого. Проверьте задачу в Google AI Studio. Автоматического повтора не будет.'};
  if(omni&&d.status!=='completed')throw new ProviderError('Google: неизвестный статус задачи; ожидаем подтверждения.');
  const video=omni?(Array.isArray(d.steps)?d.steps:[]).filter((s:any)=>s.type==='model_output')
    .flatMap((s:any)=>Array.isArray(s.content)?s.content:[]).find((c:any)=>c.type==='video')
    :d.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  if(!video)return {...receipt,error:'Google не вернул видео. Возможно, результат отклонён фильтром содержимого. Новая генерация не запускается.'};
  if(omni&&typeof video.data==='string') {
    if(video.data.length>Math.ceil(50*1024*1024/3)*4)throw new ProviderError('Google: видео больше лимита загрузки 50 МБ; задача сохранена.');
    try{return {...receipt,bytes:Uint8Array.from(atob(video.data),c=>c.charCodeAt(0)),mime:'video/mp4'};}
    catch{throw new ProviderError('Google: не удалось прочитать видео; повторяется только получение результата.');}
  }
  const file=fileUrl(video.uri);
  if(omni) {
    const info=await json(await call(file.href,h(key)));
    if(info.state==='PROCESSING')return {...receipt,pending:true};
    if(info.state!=='ACTIVE')return {...receipt,error:'Google: обработка видео не завершена успешно. Проверьте задачу в кабинете.'};
  }
  return {...receipt,url:`${file.href}:download?alt=media`,mime:'video/mp4'};
}
export async function retrieveGoogle(url:string,key:string):Promise<{bytes:Uint8Array;mime:string}> {
  let u=new URL(`${fileUrl(url).href}:download?alt=media`);
  const signal=AbortSignal.timeout(60000);
  let r:Response;
  for(let n=0;;n++) {
    const authenticated=u.origin==='https://generativelanguage.googleapis.com';
    r=await fetch(u.href,{headers:authenticated?{'x-goog-api-key':key}:{},redirect:'manual',signal});
    if(![301,302,303,307,308].includes(r.status))break;
    const location=r.headers.get('location');await r.body?.cancel();
    if(!location||n>=5)throw new Error('Google: не удалось перейти к файлу. Повторяется только сохранение.');
    const next=new URL(location,u);
    if(next.protocol!=='https:'||next.username||next.password||(next.port&&next.port!=='443')||
      !(next.hostname==='generativelanguage.googleapis.com'||next.hostname==='storage.googleapis.com'||next.hostname.endsWith('.googleusercontent.com')))
      throw new Error('Google: неожиданный адрес перенаправления. Ключ не передан.');
    // Authentication is restricted to validated Files API paths, never CDNs.
    if(next.hostname==='generativelanguage.googleapis.com')fileUrl(next.href);
    u=next;
  }
  if(!r.ok)throw new Error(`Google: загрузка видео HTTP ${r.status}. Повторяется только сохранение файла.`);
  const mime=(r.headers.get('content-type')??'').split(';')[0];
  if(!['video/mp4','application/octet-stream'].includes(mime))throw new Error('Google: вместо видео получен другой формат.');
  if(Number(r.headers.get('content-length')??0)>50*1024*1024){await r.body?.cancel();throw new Error('Google: результат больше 50 МБ.');}
  const reader=r.body?.getReader();if(!reader)throw new Error('Google: пустой файл.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>50*1024*1024){await reader.cancel();throw new Error('Google: результат больше 50 МБ.');}chunks.push(value);}
  if(!size)throw new Error('Google: пустой файл.');
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return {bytes,mime:'video/mp4'};
}
