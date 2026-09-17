import type { Job } from './domain';
import type { Result } from './providers';
import { call, json, ProviderError } from './provider-http';
import { FAL_ENDPOINTS, FAL_H3, isFalImage, isFalVideo, prepareFalJobs } from './fal-models';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const headers = (key:string) => ({Authorization:`Key ${key}`, 'Content-Type':'application/json'});
function requestUrl(model:string, id:string, suffix='') {
  if (!uuid.test(id)) throw new ProviderError('fal.ai: некорректный номер запроса; проверьте журнал провайдера.', true, true);
  // Queue reads use owner/alias, without the inference subpath (fal SDK contract).
  const root = FAL_ENDPOINTS[model].split('/').slice(0,2).join('/');
  return `https://queue.fal.run/${root}/requests/${id}${suffix}`;
}
// Accept only this endpoint's result paths. Never forward credentials to a
// response/status URL supplied by an arbitrary upstream host or redirect.
function resultUrl(model:string, id:string, supplied:unknown) {
  const base = requestUrl(model,id);
  if (supplied === undefined) return base;
  if (supplied !== base && supplied !== `${base}/response`)
    throw new ProviderError('fal.ai: неожиданный адрес результата. Повторная генерация не запускается.', true);
  return supplied;
}
export async function generateFal(j:Job,key:string,refs:string[],format:string):Promise<Result> {
  if (!isFalImage(j.model) && !isFalVideo(j.model))
    throw new ProviderError('fal.ai: модель не поддерживается. Запрос не отправлен.', true, true);
  const info = refs.map(ref => {
    const m=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(ref);
    if (!m || m[2].length%4) throw new ProviderError('fal.ai: неверный формат референса. Запрос не отправлен.',true,true);
    return {mime:m[1],size:m[2].length*3/4-(m[2].endsWith('==')?2:m[2].endsWith('=')?1:0)};
  });
  try { prepareFalJobs([j],info); } catch(e) { throw new ProviderError((e as Error).message,true,true); }
  const sizes:Record<string,{width:number;height:number}> = {'16:9':{width:1024,height:576},'9:16':{width:576,height:1024},'1:1':{width:1024,height:1024}};
  if (!sizes[format]) throw new ProviderError('fal.ai: неподдерживаемый формат кадра.',true,true);
  const body = isFalImage(j.model) ? {
    prompt:j.prompt,image_urls:refs,image_size:sizes[format],num_images:1,
    num_inference_steps:28,guidance_scale:4.5,output_format:'png',acceleration:'regular',
    enable_safety_checker:true,sync_mode:false,
  } : j.model === FAL_H3 ? {
    prompt:j.prompt,image_url:refs[0],duration:6,resolution:'768P',
    prompt_expansion_mode:'disabled',enable_safety_checker:true,sync_mode:false,
  } : {
    prompt:j.prompt,image_url:refs[0],num_frames:97,frames_per_second:16,
    resolution:'720p',aspect_ratio:format,num_inference_steps:27,acceleration:'regular',
    enable_prompt_expansion:false,enable_safety_checker:true,enable_output_safety_checker:true,
    interpolator_model:'film',num_interpolated_frames:1,adjust_fps_for_interpolation:true,
  };
  const d=await json(await call(`https://queue.fal.run/${FAL_ENDPOINTS[j.model]}`,headers(key),body));
  if (!uuid.test(d.request_id ?? '')) throw new ProviderError('fal.ai: запрос отправлен, но номер не получен. Проверьте кабинет; автоматического повтора не будет.');
  return {pending:true,requestId:d.request_id,actual:null};
}
export async function pollFal(j:Job,key:string):Promise<Result> {
  if (!isFalImage(j.model) && !isFalVideo(j.model)) throw new ProviderError('fal.ai: модель не поддерживается.',true,true);
  const id=j.requestId??'',h=headers(key);
  const status=await json(await call(requestUrl(j.model,id,'/status'),h));
  if (['IN_QUEUE','IN_PROGRESS'].includes(status.status)) return {pending:true,requestId:id};
  if (status.status !== 'COMPLETED') throw new ProviderError('fal.ai: неизвестный статус запроса. Проверьте кабинет; новая генерация не запускается.');
  // The result endpoint also reports validation/moderation failures as HTTP
  // errors. Do not store raw logs, prompts, or response bodies in the project.
  const d=await json(await call(resultUrl(j.model,id,status.response_url),h));
  if (d.has_nsfw_concepts?.[0]) return {error:'fal.ai: изображение отклонено проверкой содержимого.',actual:null};
  const video=isFalVideo(j.model),img=video?d.video:d.images?.[0];
  let url:URL;
  try {url=new URL(img?.url);} catch {throw new ProviderError('fal.ai: результат не содержит '+(video?'видео.':'изображения.'),true);}
  if (url.protocol!=='https:' || url.username || url.password)
    throw new ProviderError('fal.ai: небезопасный адрес файла.',true);
  return {url:url.href,mime:video?'video/mp4':'image/png',requestId:id,actual:null,
    usage:{provider:'fal',endpoint:FAL_ENDPOINTS[j.model],width:img.width,height:img.height,seed:d.seed}};
}
