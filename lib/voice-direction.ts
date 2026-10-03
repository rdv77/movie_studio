import {z} from 'zod';
import type {Project} from './domain';

export const VOICE_EMOTIONS=['neutral','happy','sad','angry','fearful','disgusted','surprised'] as const;
export const VOICE_EMOTION_NAMES:Record<typeof VOICE_EMOTIONS[number],string>={neutral:'Нейтрально',happy:'Радость',sad:'Печаль',angry:'Гнев',fearful:'Тревога',disgusted:'Отвращение',surprised:'Удивление'};
export const voiceDeliverySchema=z.object({
  emotion:z.enum(VOICE_EMOTIONS).optional(),intention:z.string().trim().max(1500).optional(),
  speed:z.number().finite().min(.5).max(2).optional(),targetSeconds:z.number().finite().min(.2).max(600).optional(),
  pauses:z.array(z.object({after:z.string().min(1).max(300),seconds:z.number().finite().min(.01).max(3)}).strict()).max(12).optional(),
  stability:z.number().min(0).max(1).optional(),similarity:z.number().min(0).max(1).optional(),style:z.number().min(0).max(1).optional(),
}).strict();
export type VoiceDelivery=z.infer<typeof voiceDeliverySchema>;
export const voiceProfileSchema=z.object({name:z.string().trim().min(1).max(100),description:z.string().trim().max(1000),
  provider:z.enum(['elevenlabs','minimax']),voiceId:z.string().trim().min(1).max(150),characterId:z.string().uuid().optional(),delivery:voiceDeliverySchema}).strict();
export type VoiceProfile=z.infer<typeof voiceProfileSchema>&{id:string;created:string;sourceJobId?:string;previewAssetId?:string;removedAt?:string};
export type VoicePreview={id:string;generatedVoiceId:string;assetId?:string;duration?:number;mime:string;language?:string};
export type VoiceDesign={id:string;provider:VoiceProfile['provider'];name:string;description:string;previewText:string;model:string;created:string;jobIds:string[];previews:VoicePreview[];selectedPreviewId?:string;savedVoiceId?:string;profileId?:string;saveJobId?:string;removedAt?:string};
export type VoiceDirectionCandidate={id:string;jobId:string;itemId:string;delivery:VoiceDelivery;notes:string[];created:string;applied?:boolean};
export const CHARACTER_AUDIO_MODES=['skip','catalog','design','nonverbal'] as const;
export const characterAudioModeSchema=z.enum(CHARACTER_AUDIO_MODES);
export type CharacterAudioMode=z.infer<typeof characterAudioModeSchema>;
export type VoiceStudioState={characterAudioMode?:CharacterAudioMode;profiles:VoiceProfile[];designs:VoiceDesign[];deliveries:Record<string,VoiceDelivery>;candidates:VoiceDirectionCandidate[];selectedProfileId?:string;castings?:Record<string,string>};
export type VoiceStudioProject=Project&{voiceStudio?:VoiceStudioState};
export const voiceStudio=(p:VoiceStudioProject):VoiceStudioState=>p.voiceStudio??={profiles:[],designs:[],deliveries:{},candidates:[]};
export function readVoiceStudio(p:VoiceStudioProject):VoiceStudioState{return p.voiceStudio??{profiles:[],designs:[],deliveries:{},candidates:[]};}
export function voiceDeliveryFor(p:VoiceStudioProject,itemId?:string,profileId?:string):VoiceDelivery|undefined{
  const s=readVoiceStudio(p),profile=s.profiles.find(v=>v.id===(profileId??(itemId?s.castings?.[itemId]:undefined)??s.selectedProfileId)&&!v.removedAt);
  const value=itemId&&s.deliveries[itemId]||profile?.delivery;return value?structuredClone(value):undefined;
}
export function saveVoiceDelivery(p:VoiceStudioProject,itemId:string,value:unknown){
  if(!p.items.some(i=>i.id===itemId&&i.stage===6&&!i.removedAt&&!i.planArchive))throw Error('План озвучки текущего проекта не найден.');
  const delivery=voiceDeliverySchema.parse(value);voiceStudio(p).deliveries[itemId]=delivery;
}
export function readableVoiceDelivery(value?:VoiceDelivery){
  if(!value)return '';return [value.emotion?`Эмоция: ${VOICE_EMOTION_NAMES[value.emotion]}`:'',value.intention?`Актёрская задача: ${value.intention}`:'',
    value.speed!==undefined?`Темп: ${value.speed}×`:'',value.targetSeconds!==undefined?`Ориентир: ${value.targetSeconds} сек (проверяется по готовому файлу)`:'',
    ...(value.pauses??[]).map(v=>`После «${v.after}» — пауза ${v.seconds} сек`)].filter(Boolean).join('\n');
}
export function insertVoicePauses(text:string,delivery:VoiceDelivery,marker:(seconds:number)=>string){
  const boundaries=new Map<number,number>();
  for(const pause of delivery.pauses??[]){const first=text.indexOf(pause.after);
    if(first<0||text.indexOf(pause.after,first+1)>=0)throw Error(`Уточните место паузы: «${pause.after}» должно встречаться в реплике ровно один раз.`);
    const at=first+pause.after.length;
    if(!text.slice(0,at).trim()||!text.slice(at).trim()||/[\p{L}\p{N}]/u.test(text[at-1]??'')&&/[\p{L}\p{N}]/u.test(text[at]??''))throw Error('Пауза должна находиться между произносимыми фрагментами, а не внутри слова или в конце реплики.');
    if(boundaries.has(at))throw Error('В одном месте можно задать только одну паузу.');boundaries.set(at,pause.seconds);
  }
  let result=text;for(const [at,seconds] of [...boundaries].sort((a,b)=>b[0]-a[0]))result=result.slice(0,at)+marker(seconds)+result.slice(at);return result;
}
export type CompiledVoiceSpeech={spokenText:string;providerText:string;body:Record<string,unknown>;warnings:string[];direction?:VoiceDelivery};
/** Only documented provider controls enter TTS; descriptive instructions are never spoken words. */
export function compileVoiceSpeech(provider:'minimax'|'elevenlabs',model:string,voiceId:string,text:string,value?:unknown):CompiledVoiceSpeech{
  if(!voiceId.trim()||voiceId.length>150||!text.trim()||text.length>9500)throw Error('Укажите голос и произносимую реплику до 9500 символов.');
  const delivery=value===undefined?undefined:voiceDeliverySchema.parse(value),d=delivery??{},warnings:string[]=[];
  if(d.targetSeconds!==undefined)warnings.push('Длительность — ориентир: API не гарантирует точное количество секунд. Проверьте готовую запись перед монтажом.');
  if(d.intention?.trim())warnings.push('Актёрская задача хранится отдельно от слов. В TTS передаются только поддерживаемые настройки исполнения.');
  let providerText=text,body:Record<string,unknown>;
  if(provider==='minimax'){
    if(!/^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/.test(model))throw Error('Эта модель MiniMax не поддерживается компилятором озвучки.');
    providerText=insertVoicePauses(text,d,seconds=>`<#${seconds.toFixed(2)}#>`);
    body={model,text:providerText,stream:false,output_format:'hex',language_boost:'Russian',voice_setting:{voice_id:voiceId,speed:d.speed??1,vol:1,pitch:0,...(d.emotion?{emotion:d.emotion}:{})},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}};
    if(d.stability!==undefined||d.similarity!==undefined||d.style!==undefined)warnings.push('Stability, similarity и style применяются только к ElevenLabs; MiniMax эти настройки не получает.');
  }else{
    if(!['eleven_v3','eleven_multilingual_v2','eleven_flash_v2','eleven_flash_v2_5','eleven_turbo_v2','eleven_turbo_v2_5'].includes(model))throw Error('Эта модель ElevenLabs не поддерживается компилятором озвучки.');
    if(d.speed!==undefined&&(d.speed<.7||d.speed>1.2))throw Error('Для ElevenLabs в студии выберите темп от 0,7 до 1,2.');
    if(model==='eleven_v3'){
      const tags:Record<string,string>={happy:'[excited]',sad:'[sad]',angry:'[angry]',fearful:'[worried]',disgusted:'[disgusted]',surprised:'[surprised]'};
      providerText=insertVoicePauses(text,d,seconds=>seconds>=1.5?' [long pause] ':' [pause] ');
      if(d.emotion&&tags[d.emotion])providerText=tags[d.emotion]+' '+providerText;
      if(d.pauses?.length)warnings.push('Eleven v3 получает теги пауз, без точной длительности паузы в секундах.');
      if(d.emotion&&d.emotion!=='neutral')warnings.push('Эмоциональные теги — указания модели; прослушайте результат, чтобы проверить исполнение.');
    }else{
      providerText=insertVoicePauses(text,d,seconds=>` <break time="${seconds.toFixed(2)}s" /> `);
      if(d.emotion&&d.emotion!=='neutral')warnings.push('Эта модель ElevenLabs не получает теги эмоций. Для управления эмоцией выберите Eleven v3.');
    }
    const settings={...(d.speed!==undefined?{speed:d.speed}:{}),...(d.stability!==undefined?{stability:d.stability}:{}),...(d.similarity!==undefined?{similarity_boost:d.similarity}:{}),...(d.style!==undefined?{style:d.style}:{})};
    body={model_id:model,text:providerText,...(model!=='eleven_multilingual_v2'?{language_code:'ru'}:{}),...(Object.keys(settings).length?{voice_settings:settings}:{})};
  }
  return {spokenText:text,providerText,body,warnings,direction:delivery};
}
export function voiceTimingConflict(actualSeconds:number,availableSeconds:number){
  if(!Number.isFinite(actualSeconds)||actualSeconds<=0||!Number.isFinite(availableSeconds)||availableSeconds<=0)throw Error('Проверьте фактическую длительность аудио и видеоплана.');
  return actualSeconds>availableSeconds+.05?`Озвучка длится ${actualSeconds.toFixed(2)} сек, видеоплан — ${availableSeconds.toFixed(2)} сек. Сократите реплику или измените темп и повторите озвучку; либо явно увеличьте монтажную длительность. Речь не обрезана и не ускорена автоматически.`:'';
}
