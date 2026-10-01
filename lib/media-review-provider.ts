import {call,json,ProviderError} from './provider-http';
import type {Job} from './domain';
import type {Result} from './providers';
/** Verified xAI Responses multimodal contract, 1 October 2026. */
export async function generateMediaReview(j:Job,key:string,refs:string[]):Promise<Result>{
  if(j.model!=='grok-4.7'||!refs.length||refs.length>8||refs.some(r=>!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(r)))throw new ProviderError('Для визуальной проверки выберите Grok 4.7 и от 1 до 8 изображений PNG/JPEG/WebP.',true,true);
  const response=await call('https://api.x.ai/v1/responses',{'content-type':'application/json',Authorization:`Bearer ${key}`},{model:j.model,input:[{role:'user',content:[{type:'input_text',text:j.prompt},...refs.map(image_url=>({type:'input_image',image_url,detail:'high'}))]}],store:false,max_output_tokens:6000});
  const d=await json(response),text=(d.output??[]).filter((m:any)=>m.type==='message'&&m.role==='assistant').flatMap((m:any)=>m.content??[]).filter((v:any)=>v.type==='output_text').map((v:any)=>v.text).join('\n').trim();
  const ticks=d.usage?.cost_in_usd_ticks;
  return {requestId:d.id??response.headers.get('x-request-id')??undefined,usage:d.usage,actual:ticks!=null&&/^\d+$/.test(String(ticks))?String(ticks):null,...(d.status&&d.status!=='completed'?{error:'Визуальная проверка не завершилась. Ответ сохранён, повтор вручную.'}:text?{text}:{error:'Модель не вернула текст проверки.'})};
}
