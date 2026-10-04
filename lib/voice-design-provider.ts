import {call,ProviderError} from './provider-http';
import {decodeMediaBase64} from './media-base64';
import {generate} from './providers';
import type {Job} from './domain';
import {voiceDesignPayload,voiceSavePayload,voiceDirectionResultSchema,type VoiceWorkflowJob} from './voice-design';
import {insertVoicePauses,type VoicePreview} from './voice-direction';

export type VoiceProviderResult={previews?:{generatedVoiceId:string;bytes:Uint8Array;mime:string;duration?:number;language?:string}[];voiceId?:string;candidate?:ReturnType<typeof voiceDirectionResultSchema.parse>;requestId?:string;actual:string|null;usage?:unknown;text?:string};
export class VoiceWorkflowResponseError extends ProviderError{
  constructor(message:string,public receipt:Pick<VoiceProviderResult,'requestId'|'actual'|'usage'|'text'>){super(message,true);}
}
const MAX_BYTES=8*1024*1024,MAX_RESPONSE=36*1024*1024;
export function safeVoiceError(error:unknown,key=''){
  let message=error instanceof Error?error.message:'Не удалось выполнить запрос к голосовой модели.';
  if(key)message=message.split(key).join('[скрыто]');return message.replace(/(?:Bearer|xi-api-key)\s*[:=]?\s+\S+/gi,'[ключ скрыт]').replace(/data:[^\s]+/gi,'[данные]').replace(/[\r\n\t]+/g,' ').slice(0,700);
}
async function data(response:Response){
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  if(!reader)throw new ProviderError('Провайдер не вернул ответ. Проверьте запрос в кабинете; автоматического повтора не будет.',true);
  while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>MAX_RESPONSE){await reader.cancel();throw new ProviderError('Ответ с пробами голоса слишком большой. Новая генерация не запускается.',true);}chunks.push(part.value);}
  try{return JSON.parse(await new Blob(chunks as BlobPart[]).text());}catch{throw new ProviderError('Получен некорректный ответ провайдера. Проверьте списание; автоматического повтора не будет.',true);}
}
function actual(value:any){const ticks=value?.usage?.cost_in_usd_ticks;return ticks!==undefined&&/^\d+$/.test(String(ticks))?String(ticks):null;}
function decoded(value:unknown,encoding:'base64'|'hex'){
  if(typeof value!=='string'||!value.length||value.length>MAX_BYTES*(encoding==='hex'?2:1.34))throw new ProviderError('Провайдер не вернул допустимый аудиофайл пробы. Новая генерация не запускается.',true);
  if(encoding==='hex'){
    if(!/^(?:[a-f0-9]{2})+$/i.test(value))throw new ProviderError('MiniMax вернул некорректное trial_audio.',true);
    return Uint8Array.from(value.match(/.{2}/g)!,v=>parseInt(v,16));
  }
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new ProviderError('ElevenLabs вернул некорректный audio_base_64.',true);
  try{return decodeMediaBase64(value);}catch{throw new ProviderError('Не удалось прочитать пробу ElevenLabs.',true);}
}
function voiceId(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>150)throw new ProviderError('Провайдер не вернул идентификатор голоса.',true);return value;}
/** Exactly one remote operation. Caller must persist a claimed job before invoking. */
export async function callVoiceWorkflow(j:VoiceWorkflowJob,key:string,format='16:9'):Promise<VoiceProviderResult>{
  const input=j.voiceWorkflow.input;
  if(input.operation==='direction'){
    const result=await generate(j as unknown as Job,key,[],format);
    if(result.error)throw new VoiceWorkflowResponseError(result.error,{requestId:result.requestId,actual:result.actual??null,usage:result.usage,text:result.text});
    let candidate:VoiceProviderResult['candidate'];
    try{candidate=voiceDirectionResultSchema.parse(JSON.parse((result.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));insertVoicePauses(input.sourceDialogue,candidate.delivery,()=> ' ');}catch{throw new VoiceWorkflowResponseError('Агент вернул некорректное исполнение. Ответ сохранён в журнале; повтор запускается вручную.',{requestId:result.requestId,actual:result.actual??null,usage:result.usage,text:(result.text??'').slice(0,32000)});}
    return {candidate,requestId:result.requestId,actual:result.actual??null,usage:result.usage,text:result.text};
  }
  const provider=j.voiceWorkflow.provider;if(!['elevenlabs','minimax'].includes(provider))throw new ProviderError('Неизвестный провайдер создания голосов. Запрос не отправлен.',true,true);
  if(input.operation==='save'&&provider!=='elevenlabs')throw new ProviderError('MiniMax сохраняется в проект без дополнительного запроса создания.',true,true);
  const endpoint=input.operation==='save'?'https://api.elevenlabs.io/v1/text-to-voice':provider==='elevenlabs'?'https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128':'https://api.minimax.io/v1/voice_design';
  const body=input.operation==='save'?voiceSavePayload(input):voiceDesignPayload(input.input);
  const headers={'content-type':'application/json',...(provider==='elevenlabs'?{'xi-api-key':key}:{Authorization:`Bearer ${key}`})};
  const response=await call(endpoint,headers,body),requestId=response.headers.get('request-id')??response.headers.get('x-request-id')??undefined;
  let d:any;try{d=await data(response);}catch(error){throw new VoiceWorkflowResponseError(safeVoiceError(error,key),{requestId,actual:null});}
  const receipt={requestId:requestId??d.trace_id??undefined,actual:actual(d),usage:d.usage??d.extra_info};
  try{
  if(provider==='minimax'&&d.base_resp?.status_code!==0)throw new ProviderError(`MiniMax: ${safeVoiceError(Error(String(d.base_resp?.status_msg??'Некорректный ответ')),key)}`,true);
  if(input.operation==='save')return {...receipt,voiceId:voiceId(d.voice_id)};
  if(provider==='minimax')return {...receipt,previews:[{generatedVoiceId:voiceId(d.voice_id),bytes:decoded(d.trial_audio,'hex'),mime:'audio/mpeg'}]};
  if(!Array.isArray(d.previews)||!d.previews.length||d.previews.length>6)throw new ProviderError('ElevenLabs не вернул ожидаемые варианты голоса. Новая генерация не запускается.',true);
  const previews=d.previews.map((p:any)=>{
    const mime=p.media_type==='audio/mp3'?'audio/mpeg':p.media_type;if(!['audio/mpeg','audio/wav'].includes(mime))throw new ProviderError('Недопустимый формат пробы ElevenLabs.',true);
    const duration=typeof p.duration_secs==='number'&&p.duration_secs>0&&p.duration_secs<=600?p.duration_secs:undefined;
    return {generatedVoiceId:voiceId(p.generated_voice_id),bytes:decoded(p.audio_base_64,'base64'),mime,duration,language:typeof p.language==='string'?p.language.slice(0,30):undefined};
  });
  if(new Set(previews.map((p:VoicePreview)=>p.generatedVoiceId)).size!==previews.length||previews.reduce((n:number,p:{bytes:Uint8Array})=>n+p.bytes.length,0)>24*1024*1024)throw new ProviderError('Некорректная или слишком большая серия проб голоса.',true);
  return {...receipt,previews};
  }catch(error){throw new VoiceWorkflowResponseError(safeVoiceError(error,key),receipt);}
}
