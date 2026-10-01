import type {Project} from './domain';
import {wasmUrl} from './wasm';
import {AUDIO_QC_MAX_BYTES,audioQcSettingsSchema,audioQcProbeInfo,audioQcProbeArgs,audioQcAnalysisArgs,parseAudioQcMeasurement,audioQcEvidence,makeAudioQcSource,audioQcReportSchema,type AudioQcSettings,type AudioQcReport,type AudioQcProbe} from './audio-qc';
type AudioQcOptions={signal?:AbortSignal;progress?:(text:string)=>void;settings?:Partial<AudioQcSettings>;loadAsset?:(assetId:string,signal?:AbortSignal)=>Promise<Blob>};
async function loadOwnedAsset(assetId:string,signal?:AbortSignal){
  const r=await fetch('/api/assets/'+encodeURIComponent(assetId),{signal});if(!r.ok)throw Error('Готовый файл текущего проекта недоступен.');
  const length=Number(r.headers.get('content-length'));if(length>AUDIO_QC_MAX_BYTES)throw Error('Для проверки в браузере поддерживаются файлы до 256 МиБ.');
  const reader=r.body?.getReader();if(!reader)throw Error('Файл не получен.');const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>AUDIO_QC_MAX_BYTES){await reader.cancel();throw Error('Для проверки в браузере поддерживаются файлы до 256 МиБ.');}chunks.push(next.value);}
  const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return new Blob([result],{type:r.headers.get('content-type')??'video/mp4'});
}
/** Explicit local operation. No provider key, model request or automatic creative change. */
export async function measureFilmAudio(p:Project,itemId:string,variantId:string,options:AudioQcOptions={}):Promise<AudioQcReport>{
  const source=makeAudioQcSource(p,itemId,variantId),settings=audioQcSettingsSchema.parse(options.settings??{}),progress=options.progress??(()=>{});
  if(options.signal?.aborted)throw new DOMException('Проверка остановлена.','AbortError');
  const {FFmpeg}=await import('@ffmpeg/ffmpeg'),ff=new FFmpeg();let engineUrl='',overflow=false;const logs:string[]=[];
  const logger=({message}:{message:string})=>{if(/Peak level dB|RMS level dB|Number of samples|silence_start|silence_end|silence_duration/.test(message)){if(logs.length>=2200){overflow=true;return;}logs.push(message.slice(0,1000));}};
  const stop=()=>ff.terminate();options.signal?.addEventListener('abort',stop,{once:true});
  try{
    progress('Загрузка движка проверки…');engineUrl=await wasmUrl(options.signal);await ff.load({classWorkerURL:location.origin+'/ffmpeg/client/worker.js',coreURL:location.origin+'/ffmpeg/ffmpeg-core.js',wasmURL:engineUrl});
    progress('Загрузка выбранного готового фильма…');const blob=await (options.loadAsset??loadOwnedAsset)(source.assetId,options.signal);if(!blob.size||blob.size>AUDIO_QC_MAX_BYTES)throw Error('Для проверки нужен непустой файл до 256 МиБ.');await ff.writeFile('audio-qc-source',new Uint8Array(await blob.arrayBuffer()));
    progress('Проверка аудиодорожки и хронометража…');if(await ff.ffprobe(audioQcProbeArgs('audio-qc-source'))>0)throw Error('Не удалось прочитать дорожки готового файла.');const raw=await ff.readFile('audio-qc-probe.json');if(raw.length>100000)throw Error('Слишком большой ответ проверки дорожек.');const probe=JSON.parse(typeof raw==='string'?raw:new TextDecoder().decode(raw)) as AudioQcProbe,info=audioQcProbeInfo(probe,settings);
    if(info.hasAudio){progress('Измерение уровней и интервалов тишины…');ff.on('log',logger);if(await ff.exec(audioQcAnalysisArgs('audio-qc-source',settings))!==0)throw Error('Не удалось измерить звуковую дорожку. Отчёт не сохранён.');if(overflow)throw Error('Слишком много событий аудио для ограниченного отчёта.');}
    if(options.signal?.aborted)throw new DOMException('Проверка остановлена.','AbortError');
    return audioQcReportSchema.parse({schemaVersion:1,id:crypto.randomUUID(),created:new Date().toISOString(),source,settings,measurement:parseAudioQcMeasurement(probe,logs,settings),evidence:audioQcEvidence(logs)});
  }finally{options.signal?.removeEventListener('abort',stop);ff.off('log',logger);ff.terminate();if(engineUrl)URL.revokeObjectURL(engineUrl);}
}
