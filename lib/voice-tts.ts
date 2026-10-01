import type {Job,Project} from './domain';
import type {Result} from './providers';
import {model} from './models';
import {call,ProviderError} from './provider-http';
import {compileVoiceSpeech,readVoiceStudio,voiceDeliverySchema,type VoiceDelivery} from './voice-direction';

export type VoiceJobOptions={profileId?:string;fallbackProfileId?:string;delivery?:VoiceDelivery};
/** Apply to a queued job before the project's CAS save. The paid request uses only this frozen data. */
export function freezeVoiceJob(p:Project,j:Job,options:VoiceJobOptions={}):Job{
  if(j.kind!=='audio'||j.purpose&&j.purpose!=='voice-test')return j;
  if(j.status!=='queued')throw Error('Постановку можно менять только до отправки запроса озвучки.');
  const provider=model(j.model).provider;
  if(provider!=='elevenlabs'&&provider!=='minimax')throw Error('Постановка голоса поддерживается для ElevenLabs и MiniMax.');
  const s=readVoiceStudio(p),profileId=options.profileId??(j.purpose!=='voice-test'?s.castings?.[j.itemId]:undefined)??options.fallbackProfileId,profile=profileId?s.profiles.find(v=>v.id===profileId&&!v.removedAt):
    s.profiles.find(v=>v.id===s.selectedProfileId&&!v.removedAt&&v.provider===provider&&v.voiceId===j.voiceId);
  if(profileId&&!profile)throw Error('Профиль голоса текущего проекта не найден.');
  if(profile&&profile.provider!==provider)throw Error('Профиль голоса относится к другому провайдеру. Выберите его модель озвучки.');
  const value=options.delivery??(j.purpose!=='voice-test'?s.deliveries[j.itemId]:undefined)??profile?.delivery;
  if(value===undefined)return j; // Existing jobs without the optional feature keep their exact legacy request.
  const delivery=voiceDeliverySchema.parse(value),voiceId=profile?.voiceId??j.voiceId;
  const compiled=compileVoiceSpeech(provider,j.model,voiceId,j.dialogue,delivery);
  j.voiceId=voiceId;j.voiceDelivery=structuredClone(delivery);j.voiceProfileId=profile?.id;
  j.ttsRequestText=compiled.providerText;j.prompt=JSON.stringify(compiled.body,null,2);
  return j;
}
/** Rebuild only from a job's immutable words and delivery; never consult the current project's profile. */
export function frozenVoiceRequest(j:Job,provider:'minimax'|'elevenlabs'){
  if(j.voiceDelivery===undefined)return undefined;
  const compiled=compileVoiceSpeech(provider,j.model,j.voiceId,j.dialogue,j.voiceDelivery);
  if(j.ttsRequestText!==undefined&&j.ttsRequestText!==compiled.providerText)throw Error('Параметры озвучки изменились после подготовки запроса. Создайте новую попытку.');
  return compiled;
}
export class VoiceSpeechResponseError extends ProviderError{
  constructor(message:string,public receipt:Pick<Result,'requestId'|'actual'|'usage'>){super(message,true);}
}
const MAX_AUDIO=32*1024*1024;
async function bounded(response:Response,max:number){
  const reader=response.body?.getReader();if(!reader)throw Error('Провайдер не вернул аудиоданные.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>max){await reader.cancel();throw Error('Ответ озвучки превышает допустимый размер файла. Новая генерация не запускается.');}chunks.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function cost(d:any){const ticks=d?.usage?.cost_in_usd_ticks;return ticks!==undefined&&/^\d+$/.test(String(ticks))?String(ticks):null;}
/** Return undefined for legacy jobs; otherwise exactly one documented TTS call, with no retries. */
export async function generateDirectedSpeech(j:Job,key:string,provider:'minimax'|'elevenlabs'):Promise<Result|undefined>{
  let compiled:ReturnType<typeof frozenVoiceRequest>;
  try{compiled=frozenVoiceRequest(j,provider);}catch(e){throw new ProviderError(e instanceof Error?e.message:'Некорректная постановка озвучки.',true,true);}
  if(!compiled)return undefined;
  const url=provider==='elevenlabs'?`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(j.voiceId)}?output_format=mp3_44100_128`:'https://api.minimax.io/v1/t2a_v2';
  const headers={'content-type':'application/json',...(provider==='elevenlabs'?{'xi-api-key':key}:{Authorization:`Bearer ${key}`})};
  const response=await call(url,headers,compiled.body),requestId=response.headers.get('request-id')??response.headers.get('x-request-id')??undefined;
  let receipt:Pick<Result,'requestId'|'actual'|'usage'>={requestId,actual:null,usage:{characters:j.dialogue.length}};
  try{
    if(provider==='elevenlabs'){
      const bytes=await bounded(response,MAX_AUDIO);if(!bytes.length)throw Error('ElevenLabs не вернул аудио.');
      return {...receipt,bytes,mime:'audio/mpeg'};
    }
    const d=JSON.parse(new TextDecoder().decode(await bounded(response,MAX_AUDIO*2+1024*1024)));
    receipt={requestId:requestId??d.trace_id,actual:cost(d),usage:d.usage??d.extra_info};
    if(d.base_resp?.status_code!==0)throw Error('MiniMax не выполнил озвучку. Проверьте ответ и списание в кабинете провайдера.');
    if(typeof d.data?.audio!=='string'||!d.data.audio.length||d.data.audio.length>MAX_AUDIO*2||!/^(?:[a-f0-9]{2})+$/i.test(d.data.audio))throw Error('MiniMax вернул некорректный аудиофайл.');
    const audio:string=d.data.audio;
    return {...receipt,bytes:Uint8Array.from(audio.match(/.{2}/g)!,v=>parseInt(v,16)),mime:'audio/mpeg'};
  }catch(e){throw new VoiceSpeechResponseError(e instanceof Error?e.message:'Не удалось прочитать озвучку. Повтор запускается вручную.',receipt);}
}
