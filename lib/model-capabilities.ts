// Endpoint limits checked 2026-10-05. Unpublished limits are not API guarantees.
export type PromptCapacity = {limit:number;unit:'characters'|'tokens';source:string;short:boolean;verified:boolean};
export const GROK_VIDEO_1080 = 'grok-imagine-video-1.5-1080p';
export const KLING_VIDEO = 'fal-kling-3.0-pro';
export const isGrokVideo = (id:string)=>id==='grok-imagine-video-1.5'||id===GROK_VIDEO_1080;
export function promptCapacity(modelId:string,kind:'image'|'video'):PromptCapacity {
  const api=(limit:number,source:string,unit:'characters'|'tokens'='characters',short=false):PromptCapacity=>({limit,unit,source,short,verified:true});
  if(modelId==='image-01')return api(1500,'API MiniMax image-01','characters',true);
  if(modelId==='MiniMax-Hailuo-2.3')return api(2000,'API MiniMax Hailuo 2.3','characters',true);
  if(modelId==='MiniMax-H3')return api(7000,'API MiniMax H3');
  if(modelId==='fal-minimax-h3-max')return api(50000,'Схема API fal.ai / minimax/h3-max/image-to-video');
  if(modelId===KLING_VIDEO)return api(2500,'Схема API fal.ai / kling-video/v3/pro/image-to-video');
  // Both studio modes use the same xAI generation endpoint. The 4096 limit
  // was reported by its HTTP 400 validation response on 2026-10-05.
  if(isGrokVideo(modelId))return api(4096,'Grok Video: предел 4096 по ответу API от 05.10.2026');
  if(modelId.startsWith('veo-'))return api(1024,'API Google Veo; подсчёт токенов проверяется перед отправкой','tokens');
  if(kind==='image'&&modelId.startsWith('gpt-image-'))return api(32000,'API GPT Image');
  if(modelId.startsWith('zencreator:'))return api(5000,'ZenCreator: подтверждённый лимит; перед отправкой проверяется каталог API');
  return {limit:60000,unit:'characters',source:'Технический предел студии 60 000 символов; API не публикует точный предел промпта',short:false,verified:false};
}
/** Conservative bound only, never advertised as the provider tokenizer. */
export const tokenUpperBound=(text:string)=>new TextEncoder().encode(text).length;
export function promptSize(text:string,cap:Pick<PromptCapacity,'unit'>){return cap.unit==='tokens'?tokenUpperBound(text):Array.from(text).length;}
export function fitsPrompt(text:string,cap:PromptCapacity){return promptSize(text,cap)<=cap.limit;}
export const promptUnit=(unit?:string)=>unit==='tokens'?'токенов':'символов';
export const videoPromptLimit=(modelId:string)=>promptCapacity(modelId,'video').limit;
export const selectedVideoPromptLimit=(ids:string[])=>ids.length?Math.min(...ids.map(videoPromptLimit)):60000;
export const availableForDirecting=(id:string)=>!['image-01','MiniMax-Hailuo-2.3'].includes(id);
