import {z} from 'zod';
import type {Project,Item,Variant} from './domain';

export const AUDIO_QC_MAX_BYTES=256*1024*1024;
export const AUDIO_QC_MAX_SECONDS=600;
export const audioQcSettingsSchema=z.object({silenceDb:z.number().finite().min(-80).max(-20).default(-40),minSilence:z.number().finite().min(.2).max(10).default(.4),maxSeconds:z.number().finite().min(1).max(AUDIO_QC_MAX_SECONDS).default(AUDIO_QC_MAX_SECONDS)}).strict();
export type AudioQcSettings=z.infer<typeof audioQcSettingsSchema>;
const identity=z.string().min(1).max(100),time=z.number().finite().min(0).max(AUDIO_QC_MAX_SECONDS+.2);
export const audioQcSourceSchema=z.object({projectId:identity,itemId:identity,variantId:identity,assetId:identity,signature:z.string().max(800)}).strict();
export type AudioQcSource=z.infer<typeof audioQcSourceSchema>;
export const audioQcMeasurementSchema=z.object({hasAudio:z.boolean(),seconds:time.positive(),audioSeconds:time.optional(),channels:z.number().int().min(1).max(64).optional(),sampleRate:z.number().int().min(1000).max(768000).optional(),peakDb:z.number().finite().min(-200).max(30).nullable(),rmsDb:z.number().finite().min(-200).max(30).nullable(),silence:z.array(z.object({start:time,end:time,duration:time}).strict().refine(s=>s.end>=s.start&&Math.abs(s.end-s.start-s.duration)<.002,{message:'Некорректный интервал тишины.'})).max(1000),issues:z.array(z.object({severity:z.enum(['note','warning']),criterion:z.string().max(200),evidence:z.string().max(1000)}).strict()).max(20),limitations:z.array(z.string().max(1000)).max(15)}).strict();
export type AudioQcMeasurement=z.infer<typeof audioQcMeasurementSchema>;
export const audioQcReportSchema=z.object({schemaVersion:z.literal(1),id:z.string().uuid(),created:z.string().datetime(),source:audioQcSourceSchema,settings:audioQcSettingsSchema,measurement:audioQcMeasurementSchema,evidence:z.array(z.string().max(700)).max(200)}).strict();
export type AudioQcReport=z.infer<typeof audioQcReportSchema>;
type AudioQcProject=Project&{audioQc?:AudioQcReport[]};
export function makeAudioQcSource(p:Project,itemId:string,variantId:string):AudioQcSource{
  const item=p.items.find(i=>i.id===itemId&&i.stage===8&&!i.planArchive&&!i.removedAt&&!i.excludedAt),v=item?.variants.find(v=>v.id===variantId);
  if(!item||!v?.assetId||v.kind!=='video'||item.selectedId!==v.id)throw Error('Выберите готовый фильм на этапе финальной сборки перед проверкой звука.');
  return {projectId:p.id,itemId:item.id,variantId:v.id,assetId:v.assetId,signature:JSON.stringify([1,p.id,item.id,v.id,v.assetId])};
}
export function assertAudioQcReportSource(p:Project,input:unknown):AudioQcReport{
  const report=audioQcReportSchema.parse(input),current=makeAudioQcSource(p,report.source.itemId,report.source.variantId);
  if(JSON.stringify(current)!==JSON.stringify(report.source))throw Error('Файл или выбор итогового фильма изменился во время проверки звука. Запустите проверку выбранного файла.');
  if(report.measurement.seconds>report.settings.maxSeconds+.2)throw Error('Длительность отчёта превышает выбранный предел проверки.');
  if(report.measurement.silence.some(s=>s.end>(report.measurement.audioSeconds??report.measurement.seconds)+.1))throw Error('Интервал тишины выходит за пределы измеренного аудио.');
  return report;
}
export function currentAudioQc(p:AudioQcProject,itemId:string,variantId:string){
  for(const input of [...p.audioQc??[]].reverse())try{const r=assertAudioQcReportSource(p,input);if(r.source.itemId===itemId&&r.source.variantId===variantId)return r;}catch{/* Historical reports never attach to a changed file/selection. */}
  return undefined;
}
/** Measurements are evidence from a local decoder, not a claim of having heard the performance. */
export function audioQcPromptContext(p:AudioQcProject,item:Item,v:Variant){
  const r=currentAudioQc(p,item.id,v.id);if(!r)return undefined;
  return {kind:'technical-audio-qc',source:r.source,created:r.created,settings:r.settings,measurement:r.measurement,evidence:r.evidence,
    interpretation:'Измерения FFmpeg получены в браузере для этого файла. Можно предложить проверку уровней, длительности и обнаруженных пауз. Не утверждай, что слышал речь, оценил дикцию, разборчивость, эмоции, музыку, фон или синхронизацию губ. Тишина может быть намеренной; рекомендации не изменяют проект.'};
}
export type AudioQcProbe={format?:{duration?:string|number};streams?:{codec_type?:string;duration?:string|number;sample_rate?:string|number;channels?:number}[]};
export const audioQcProbeArgs=(file:string,out='audio-qc-probe.json')=>['-v','error','-show_entries','format=duration:stream=codec_type,duration,sample_rate,channels','-of','json','-o',out,file];
export function audioQcAnalysisArgs(file:string,input:Partial<AudioQcSettings>={}){
  const s=audioQcSettingsSchema.parse(input);
  return ['-v','info','-i',file,'-map','0:a:0','-vn','-t',String(s.maxSeconds),'-af',`astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=Peak_level+RMS_level+Number_of_samples,silencedetect=noise=${s.silenceDb}dB:d=${s.minSilence}`,'-f','null','-'];
}
const positive=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:undefined;};
export function audioQcProbeInfo(probe:AudioQcProbe,input:Partial<AudioQcSettings>={}){
  const settings=audioQcSettingsSchema.parse(input),audio=probe.streams?.find(s=>s.codec_type==='audio'),seconds=positive(probe.format?.duration)??positive(probe.streams?.find(s=>s.codec_type==='video')?.duration)??positive(audio?.duration);
  if(!seconds)throw Error('Не удалось измерить длительность готового файла.');
  if(seconds>settings.maxSeconds+.02)throw Error(`Файл длится ${seconds.toFixed(2)} сек. Техническая проверка рассчитана на файл до ${settings.maxSeconds} сек; результат не выдаётся за проверку всего более длинного фильма.`);
  const sampleRate=positive(audio?.sample_rate),channels=positive(audio?.channels);
  return {hasAudio:!!audio,seconds,audioSeconds:positive(audio?.duration),sampleRate:sampleRate&&Number.isInteger(sampleRate)?sampleRate:undefined,channels:channels&&Number.isInteger(channels)?channels:undefined};
}
export function parseAudioQcMeasurement(probe:AudioQcProbe,logs:string[],input:Partial<AudioQcSettings>={}):AudioQcMeasurement{
  const settings=audioQcSettingsSchema.parse(input),info=audioQcProbeInfo(probe,settings),issues:AudioQcMeasurement['issues']=[],limitations=['Технические измерения не оценивают разборчивость реплик, художественный баланс музыки, актёрское исполнение или синхронизацию губ.','Peak — максимум цифровых отсчётов декодированного файла; это не true-peak, LUFS или подтверждение отсутствия клиппинга.','Анализируется первая аудиодорожка; тишина определяется порогом, а не смыслом сцены.'];
  if(!info.hasAudio)return audioQcMeasurementSchema.parse({...info,peakDb:null,rmsDb:null,silence:[],issues:[{severity:'warning',criterion:'Аудиодорожка',evidence:'FFprobe не обнаружил аудиодорожку в готовом файле.'}],limitations});
  const stat=(label:string)=>{const expression=new RegExp(label+':\\s*(-?inf|-?[\\d.]+)','i'),values=logs.map(line=>line.match(expression)?.[1]).filter((v):v is string=>v!==undefined);if(!values.length)throw Error('FFmpeg не вернул полную статистику аудио. Отчёт не сохранён.');const value=values.at(-1)!;return value.toLowerCase().includes('inf')?null:Number(value);};
  const peakDb=stat('Peak level dB'),rmsDb=stat('RMS level dB'),samples=positive(logs.map(line=>line.match(/Number of samples:\s*([\d.]+)/)?.[1]).filter(Boolean).at(-1));
  const audioSeconds=samples&&info.sampleRate?samples/info.sampleRate:info.audioSeconds??info.seconds;
  if(!samples||!info.sampleRate)limitations.push('Продолжительность аудио взята из контейнера; число декодированных отсчётов или частота недоступны.');
  const silence:AudioQcMeasurement['silence']=[];let start:number|undefined;
  const close=(end:number)=>{if(start===undefined)return;const a=Math.max(0,Math.min(start,audioSeconds)),b=Math.max(a,Math.min(end,audioSeconds));if(b-a>=settings.minSilence-.01)silence.push({start:a,end:b,duration:b-a});start=undefined;};
  for(const line of logs){const a=line.match(/silence_start:\s*(-?[\d.]+)/),b=line.match(/silence_end:\s*(-?[\d.]+)/);if(a)start=Number(a[1]);if(b)close(Number(b[1]));}if(start!==undefined)close(audioSeconds);
  if(peakDb!==null&&peakDb>=-1)issues.push({severity:'warning',criterion:'Запас по пику',evidence:`Пик ${peakDb.toFixed(2)} dBFS близок к цифровому максимуму. Прослушайте громкие моменты; измерение не доказывает клиппинг.`});
  if(rmsDb!==null&&rmsDb<-35)issues.push({severity:'note',criterion:'Средний уровень',evidence:`RMS ${rmsDb.toFixed(2)} dBFS. Сигнал тихий по техническому ориентиру; это не оценка слышимости речи и не стандарт громкости.`});
  if(Math.abs(audioSeconds-info.seconds)>.15)issues.push({severity:'warning',criterion:'Длительность дорожки',evidence:`Файл: ${info.seconds.toFixed(2)} сек; декодированное аудио: ${audioSeconds.toFixed(2)} сек. Проверьте начало/конец и намеренные паузы.`});
  if(silence.length)issues.push({severity:'note',criterion:'Участки ниже порога',evidence:`Найдено ${silence.length} участков ниже ${settings.silenceDb} dB продолжительностью от ${settings.minSilence} сек. Они могут быть намеренными.`});
  if(peakDb===null&&rmsDb===null)issues.push({severity:'warning',criterion:'Отсутствие сигнала',evidence:'Декодированная дорожка имеет peak/RMS −∞. В проверенной дорожке нет ненулевого сигнала.'});
  return audioQcMeasurementSchema.parse({...info,audioSeconds,peakDb,rmsDb,silence,issues,limitations});
}
export const audioQcEvidence=(logs:string[])=>logs.filter(l=>/Peak level dB|RMS level dB|Number of samples|silence_start|silence_end|silence_duration/.test(l)).slice(-200).map(l=>l.slice(0,700));
