import {call,ProviderError} from './provider-http';
import {soundGenerationPayload,type SoundJob} from './soundscape';
export type SoundResult={bytes:Uint8Array;mime:string;requestId?:string;actual:null;usage:{characterCost?:number;requestedSeconds:number;provider:'elevenlabs'}};
export class SoundResponseError extends ProviderError{constructor(message:string,public receipt:Omit<SoundResult,'bytes'|'mime'>){super(message,true);}}
/** Exactly one SFX request; the caller must persist the job's CAS claim first. */
export async function generateSoundscape(j:SoundJob,key:string):Promise<SoundResult>{
  let body:ReturnType<typeof soundGenerationPayload>;
  try{body=soundGenerationPayload(j.soundInput.generation);}catch{throw new ProviderError('Проверьте описание звука до 450 символов, длительность 0.5–30 сек и влияние промпта 0–1. Запрос не отправлен.',true,true);}
  const response=await call('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',{'content-type':'application/json','xi-api-key':key},body);
  const billed=response.headers.get('character-cost'),characterCost=billed!==null&&/^\d+$/.test(billed)&&Number.isSafeInteger(Number(billed))?Number(billed):undefined;
  const receipt={requestId:response.headers.get('request-id')??response.headers.get('x-request-id')??undefined,actual:null,usage:{provider:'elevenlabs' as const,requestedSeconds:body.duration_seconds,...(characterCost!==undefined?{characterCost}:{})}};
  try{
    const mime=response.headers.get('content-type')?.split(';')[0].trim();if(mime&&!['audio/mpeg','audio/mp3','application/octet-stream'].includes(mime))throw Error('ElevenLabs вернул ответ, который не является запрошенным MP3 файлом.');
    const reader=response.body?.getReader();if(!reader)throw Error('ElevenLabs не вернул звуковой файл.');const chunks:Uint8Array[]=[];let size=0;
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>16*1024*1024){await reader.cancel();throw Error('Полученный звуковой эффект больше 16 МБ. Проверьте результат в кабинете; новая генерация не запускается.');}chunks.push(next.value);}
    if(!size)throw Error('ElevenLabs вернул пустой звуковой файл.');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return {...receipt,bytes,mime:'audio/mpeg'};
  }catch(e){throw new SoundResponseError(e instanceof Error?e.message:'Не удалось прочитать звуковой эффект.',receipt);}
}
