import { isApproved, participates, type Item, type Project } from './domain';
import { generationSeconds } from './zencreator-models';

// Fallback for legacy callers without a model selection.
export const VIDEO_PLAN_SECONDS = 6;
export const secondsLabel = (n:number) => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
export function videoDurationIssue(title:string,seconds:number,modelIds:string[]=[] ) {
  const max=modelIds.length?Math.min(...modelIds.map(generationSeconds)):VIDEO_PLAN_SECONDS;
  return seconds>max
    ? `«${title}»: план ${secondsLabel(seconds)} сек, допустимо ${max} сек для выбранных моделей — превышение ${secondsLabel(seconds-max)} сек. Снимите галочку с этого плана, чтобы запустить остальные, выберите модель с большей длительностью или разделите план в подробном сценарии. Не сокращайте план, пока не проверите длину речи.` : '';
}
export function videoPlanIssues(title:string,seconds:number,refCount:number,prompt:string,limit:number,modelIds:string[]=[] ) {
  return [videoDurationIssue(title,seconds,modelIds),refCount!==1?`«${title}»: выберите один первый кадр.`:'',
    !prompt.trim()?`«${title}»: заполните задачу для модели.`:prompt.length>limit?`«${title}»: полный промпт ${prompt.length} символов при лимите ${limit}. Сократите задачу или исключите лишних героев.`:''].filter(Boolean);
}
export function approvedPlanAudio(p:Project,item:Item) {
  if(p.speechMode!=='plans'||!item.sourceShot)return undefined;
  const voices=p.items.filter(i=>i.stage===6&&participates(p,i)&&i.sourceShot?.scriptId===item.sourceShot!.scriptId&&i.sourceShot.title===item.sourceShot!.title&&isApproved(p,i));
  if(voices.length!==1)return undefined;
  return voices[0].variants.find(v=>v.id===voices[0].approvedId&&v.kind==='audio'&&v.assetId);
}
export function speechTimingMessage(recordingSeconds:number,trim:number,planSeconds:number,videoSeconds:number) {
  if(!Number.isFinite(recordingSeconds)||recordingSeconds<=0)return 'Длительность озвучки не определена. Проверьте запись в разделе «Голоса».';
  const speech=recordingSeconds-trim;
  if(speech<=0)return 'Начало воспроизведения находится за концом аудиофайла. Исправьте обрезку в разделе «Голоса».';
  const details=`Речь: ${secondsLabel(speech)} сек${trim>0?' после обрезки начала':''}. План: ${secondsLabel(planSeconds)} сек. Генерируемый ролик: ${secondsLabel(videoSeconds)} сек.`;
  if(speech>videoSeconds+0.01)return `${details} Речь длиннее ролика на ${secondsLabel(speech-videoSeconds)} сек. Перед финальной сборкой сократите реплику и переозвучьте этот план либо используйте более длинное видео. Это предупреждение не запрещает генерацию; речь автоматически не обрезается.`;
  if(speech>planSeconds+0.01)return `${details} Речь длиннее плана на ${secondsLabel(speech-planSeconds)} сек, но помещается в ролик. При сборке потребуется продлить план до конца реплики; фактическая длина готового видео будет проверена.`;
  return `${details} Речь помещается в план и ролик.`;
}
