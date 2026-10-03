import {z} from 'zod';
import {id,now,assertBudget,type Project,type Job} from './domain';
import {musicEnvelope} from './music';

export const SOUND_KINDS=['ambience','foley','event','vocal'] as const;
export const SOUND_KIND_NAMES={ambience:'Атмосфера',foley:'Шумы действий',event:'Звуковой акцент',vocal:'Звуки героя без слов (смех, вздох, кваканье)'} as const;
export const soundScopeSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('film')}).strict(),
  z.object({type:z.literal('plan'),itemId:z.string().uuid()}).strict(),
  z.object({type:z.literal('scene'),sceneId:z.string().min(1).max(100)}).strict(),
]);
export type SoundScope=z.infer<typeof soundScopeSchema>;
export const soundSettingsSchema=z.object({
  enabled:z.boolean().default(true),offset:z.number().finite().min(0).max(3600).default(0),
  trim:z.number().finite().min(0).max(3600).default(0),duration:z.number().finite().min(.05).max(3600).nullable().default(null),
  loop:z.boolean().default(false),volume:z.number().finite().min(0).max(2).default(.3),
  duckSpeech:z.boolean().default(true),speechVolume:z.number().finite().min(0).max(2).default(.08),
  fadeIn:z.number().finite().min(0).max(10).default(.1),fadeOut:z.number().finite().min(0).max(10).default(.2),
}).strict().refine(s=>!s.duckSpeech||s.speechVolume<=s.volume,{message:'Громкость во время речи не должна превышать обычную громкость слоя.'});
export type SoundSettings=z.infer<typeof soundSettingsSchema>;
export const soundLayerSchema=z.object({name:z.string().trim().min(1).max(120),kind:z.enum(SOUND_KINDS),scope:soundScopeSchema,settings:soundSettingsSchema,promptNotes:z.string().max(2000).optional()}).strict();
export type SoundVariant={id:string;assetId:string;mime:string;model:string;created:string;prompt:string;jobId?:string;seconds?:number;removedAt?:string};
export type SoundLayer=z.infer<typeof soundLayerSchema>&{id:string;created:string;variants:SoundVariant[];selectedId?:string;approvedId?:string;approvedBasis?:string;removedAt?:string};
export type SoundscapeState={enabled:boolean;layers:SoundLayer[]};
export type SoundscapeProject=Project&{soundscape?:SoundscapeState};
export const soundscape=(p:SoundscapeProject):SoundscapeState=>p.soundscape??={enabled:false,layers:[]};
export const readSoundscape=(p:SoundscapeProject):SoundscapeState=>p.soundscape??{enabled:false,layers:[]};
export const soundGenerationSchema=z.object({prompt:z.string().trim().min(1).max(450),duration:z.number().finite().min(.5).max(30),loop:z.boolean().default(false),influence:z.number().finite().min(0).max(1).default(.3),count:z.number().int().min(1).max(4).default(1)}).strict();
export type SoundGeneration=z.infer<typeof soundGenerationSchema>;
export type SoundJob=Omit<Job,'purpose'>&{purpose:'soundscape';soundInput:{layerId:string;generation:SoundGeneration;late?:boolean}};
export const isSoundJob=(value:unknown):value is SoundJob=>!!value&&typeof value==='object'&&(value as SoundJob).purpose==='soundscape'&&!!(value as SoundJob).soundInput;
export const soundJobs=(p:Project)=>p.jobs.filter(isSoundJob) as unknown as SoundJob[];

export function assertSoundScope(p:Project,scope:SoundScope){
  if(scope.type==='plan'&&!p.items.some(i=>i.id===scope.itemId&&[5,7].includes(i.stage)&&!i.removedAt&&!i.excludedAt&&!i.planArchive))throw Error('План для звукового слоя текущего проекта не найден.');
  if(scope.type==='scene'&&!p.directing?.scenes.some(s=>s.id===scope.sceneId))throw Error('Сцена для звукового слоя текущего проекта не найдена.');
}
export function getSoundLayer(p:SoundscapeProject,layerId:string,removed=false){const layer=readSoundscape(p).layers.find(s=>s.id===layerId&&(removed||!s.removedAt));if(!layer)throw Error('Звуковой слой текущего проекта не найден.');return layer;}
export function saveSoundLayer(p:SoundscapeProject,value:unknown,layerId?:string){
  const input=soundLayerSchema.parse(value);assertSoundScope(p,input.scope);const s=soundscape(p);
  if(layerId){const layer=getSoundLayer(p,layerId);Object.assign(layer,input);return layer;}
  if(s.layers.filter(s=>!s.removedAt).length>=100)throw Error('В рабочем списке максимум 100 звуковых слоёв.');
  const layer:SoundLayer={...input,id:id(),created:now(),variants:[]};s.layers.push(layer);return layer;
}
export const selectedSound=(layer:SoundLayer)=>layer.variants.find(v=>v.id===layer.selectedId&&!v.removedAt);
export function soundLayerBasis(layer:SoundLayer){const v=selectedSound(layer);return JSON.stringify({scope:layer.scope,settings:layer.settings,variantId:v?.id,assetId:v?.assetId,seconds:v?.seconds});}
export function soundLayerIssue(layer:SoundLayer){
  const v=selectedSound(layer);if(!v?.assetId)return 'Выберите готовый аудиофайл звукового слоя.';
  if(!Number.isFinite(v.seconds)||v.seconds!<=0)return 'Прослушайте файл и проверьте его фактическую длительность.';
  if(layer.settings.trim>=v.seconds!)return 'Начало в исходном файле находится после конца звука.';
  if(!layer.settings.loop&&layer.settings.duration!==null&&layer.settings.duration>v.seconds!-layer.settings.trim+.01)return `После выбранного начала в файле доступно ${(v.seconds!-layer.settings.trim).toFixed(2)} сек. Сократите длительность или включите повтор.`;
  return '';
}
export function chooseSoundVariant(p:SoundscapeProject,layerId:string,variantId:string){const layer=getSoundLayer(p,layerId);if(!layer.variants.some(v=>v.id===variantId&&!v.removedAt&&v.assetId))throw Error('Готовый вариант звука не найден.');layer.selectedId=variantId;}
export function approveSoundLayer(p:SoundscapeProject,layerId:string){const layer=getSoundLayer(p,layerId);assertSoundScope(p,layer.scope);const issue=soundLayerIssue(layer);if(issue)throw Error(issue);layer.approvedId=layer.selectedId;layer.approvedBasis=soundLayerBasis(layer);}
export const soundLayerApproved=(layer:SoundLayer)=>!!layer.approvedId&&layer.approvedId===layer.selectedId&&layer.approvedBasis===soundLayerBasis(layer)&&!soundLayerIssue(layer);
export function removeSoundVariant(p:SoundscapeProject,layerId:string,variantId:string,restore=false){
  const layer=getSoundLayer(p,layerId,true),v=layer.variants.find(v=>v.id===variantId);if(!v)throw Error('Вариант звука не найден.');
  v.removedAt=restore?undefined:now();if(!restore){if(layer.selectedId===v.id)layer.selectedId=undefined;if(layer.approvedId===v.id){layer.approvedId=undefined;layer.approvedBasis=undefined;}}
}
export function soundGenerationPayload(value:SoundGeneration){const g=soundGenerationSchema.parse(value);return {text:g.prompt,model_id:'eleven_text_to_sound_v2',duration_seconds:g.duration,loop:g.loop,prompt_influence:g.influence};}
export function queueSoundGeneration(p:SoundscapeProject,batchId:string,layerId:string,value:unknown){
  z.string().uuid().parse(batchId);if(soundJobs(p).some(j=>j.batchId===batchId))return;
  const layer=getSoundLayer(p,layerId);assertSoundScope(p,layer.scope);const generation=soundGenerationSchema.parse(value);
  if(soundJobs(p).some(j=>j.itemId===layerId&&(['queued','dispatching','saving'].includes(j.status)||j.status==='unknown'&&!j.newSeriesAllowedAt)))throw Error('Для этого слоя есть текущая попытка или неизвестный исход. Проверьте журнал; новую серию после неизвестного исхода разрешите отдельной кнопкой.');
  const jobs:SoundJob[]=Array.from({length:generation.count},()=>({id:id(),itemId:layerId,batchId,purpose:'soundscape',soundInput:{layerId,generation:structuredClone(generation)},model:'eleven_text_to_sound_v2',kind:'audio',prompt:JSON.stringify(soundGenerationPayload(generation)),brief:`Звуковой слой · ${layer.name}`,dialogue:'',voiceId:'',refs:[],duration:generation.duration,camera:'',continuity:'',offset:0,volume:1,deps:'soundscape-v1',created:now(),status:'queued',transportVersion:2,estimate:null,actual:null}));
  assertBudget(p,jobs as unknown as Job[]);p.jobs.push(...jobs as unknown as Job[]);
}
export function soundVariantFromJob(j:SoundJob):SoundVariant{return {id:j.id,assetId:j.id,mime:'audio/mpeg',model:j.model,created:j.created,prompt:j.soundInput.generation.prompt,jobId:j.id};}
export function soundscapeSuggestions(p:Project){
  const result:{name:string;kind:SoundLayer['kind'];scope:SoundScope;description:string;offset:number;loop:boolean}[]=[];
  for(const scene of p.directing?.scenes??[])for(const shot of scene.shots){
    const item=p.items.find(i=>[5,7].includes(i.stage)&&!i.removedAt&&!i.excludedAt&&!i.planArchive&&i.sourceShot?.shotId===shot.id);if(!item)continue;
    const sound=shot.direction?.sound;if(sound?.silence)continue;
    if(sound?.ambience?.trim())result.push({name:shot.title+' · атмосфера',kind:'ambience',scope:{type:'plan',itemId:item.id},description:sound.ambience,offset:0,loop:true});
    for(const [n,effect] of (sound?.effects??[]).entries())result.push({name:shot.title+' · звук '+(n+1),kind:'event',scope:{type:'plan',itemId:item.id},description:effect.description,offset:effect.at,loop:false});
  }
  return result.slice(0,100);
}

export type SoundTimelineClip={itemId:string;offset:number;duration:number;shotId?:string;sceneId?:string};
export type SoundTimeline={seconds:number;clips:SoundTimelineClip[]};
export type SoundSpeechSpan={offset:number;duration:number};
export type SoundMixLayer={id:string;layerId:string;name:string;kind:SoundLayer['kind'];assetId:string;variantId:string;sourceSeconds:number;start:number;duration:number;trim:number;loop:boolean;volume:number;speechVolume:number;duckSpeech:boolean;fadeIn:number;fadeOut:number};
function scopeRanges(p:Project,scope:SoundScope,timeline:SoundTimeline){
  if(scope.type==='film')return [{offset:0,duration:timeline.seconds}];assertSoundScope(p,scope);
  let clips:SoundTimelineClip[];
  if(scope.type==='scene')clips=timeline.clips.filter(c=>c.sceneId===scope.sceneId);
  else{
    const source=p.items.find(i=>i.id===scope.itemId)!;
    clips=timeline.clips.filter(c=>{if(c.itemId===source.id||source.sourceShot?.shotId&&c.shotId===source.sourceShot.shotId)return true;const actual=p.items.find(i=>i.id===c.itemId);return source.sourceShot&&actual?.sourceShot&&source.sourceShot.scriptId===actual.sourceShot.scriptId&&source.sourceShot.title===actual.sourceShot.title;});
  }
  if(!clips.length)throw Error('Звуковой слой ссылается на сцену или план, которого нет в текущем монтаже. Измените его область или отключите слой.');
  const ranges:{offset:number;duration:number}[]=[];
  for(const c of clips.slice().sort((a,b)=>a.offset-b.offset)){const previous=ranges.at(-1);if(previous&&Math.abs(previous.offset+previous.duration-c.offset)<.002)previous.duration+=c.duration;else ranges.push({offset:c.offset,duration:c.duration});}
  return ranges;
}
/** Build after measuring source files and resolving final clip lengths; never use the film's initial target. */
export function buildSoundscapeMix(p:SoundscapeProject,timeline:SoundTimeline,sourceSeconds:Record<string,number>={}):SoundMixLayer[]{
  const s=readSoundscape(p);if(!s.enabled)return [];
  if(!Number.isFinite(timeline.seconds)||timeline.seconds<=0||timeline.clips.some(c=>!Number.isFinite(c.offset)||c.offset<0||!Number.isFinite(c.duration)||c.duration<=0||c.offset+c.duration>timeline.seconds+.01))throw Error('Проверьте фактическую последовательность планов перед сведением звука.');
  const result:SoundMixLayer[]=[];
  for(const layer of s.layers.filter(l=>!l.removedAt&&l.settings.enabled)){
    if(!soundLayerApproved(layer))throw Error(`${layer.name}: выберите, прослушайте и утвердите звуковой слой.`);
    const v=selectedSound(layer)!,seconds=sourceSeconds[v.assetId]??v.seconds!;
    if(!Number.isFinite(seconds)||seconds<=layer.settings.trim)throw Error(`${layer.name}: в исходном аудио нет доступного участка после выбранного начала.`);
    if(Math.abs(seconds-v.seconds!)>.1)throw Error(`${layer.name}: фактическая длительность файла изменилась. Обновите проверку файла и пересмотрите утверждение.`);
    for(const [index,range] of scopeRanges(p,layer.scope,timeline).entries()){
      const start=range.offset+layer.settings.offset,available=Math.min(range.duration-layer.settings.offset,timeline.seconds-start);
      if(available<=0)throw Error(`${layer.name}: начало звука находится после конца выбранного плана или сцены.`);
      const duration=layer.settings.duration??(layer.settings.loop?available:Math.min(available,seconds-layer.settings.trim));
      if(duration>available+.01)throw Error(`${layer.name}: звук занимает ${duration.toFixed(2)} сек, а в выбранной области осталось ${available.toFixed(2)} сек. Сократите длительность или измените область слоя.`);
      if(!layer.settings.loop&&duration>seconds-layer.settings.trim+.01)throw Error(`${layer.name}: исходный звук короче указанной длительности. Включите повтор или сократите длительность.`);
      result.push({id:layer.id+'-'+index,layerId:layer.id,name:layer.name,kind:layer.kind,assetId:v.assetId,variantId:v.id,sourceSeconds:seconds,start,duration:Math.min(duration,available),trim:layer.settings.trim,loop:layer.settings.loop,volume:layer.settings.volume,speechVolume:layer.settings.speechVolume,duckSpeech:layer.settings.duckSpeech,fadeIn:Math.min(layer.settings.fadeIn,duration/2),fadeOut:Math.min(layer.settings.fadeOut,duration/2)});
    }
  }
  return result;
}
export function soundVolumeExpression(layer:SoundMixLayer,speech:SoundSpeechSpan[]){
  if(!layer.duckSpeech)return String(layer.volume);
  return musicEnvelope(speech,{volume:layer.volume,speechVolume:layer.speechVolume} as Parameters<typeof musicEnvelope>[1]).replace(/\bt\b/g,`(t+${layer.start})`);
}
/** Independent inputs/labels can be mixed with existing speech/music labels by render.audioArgs. */
export function soundscapeFilter(layers:SoundMixLayer[],speech:SoundSpeechSpan[],firstInput=0){
  if(!Number.isInteger(firstInput)||firstInput<0)throw Error('Некорректный индекс входной звуковой дорожки.');
  const filters:string[]=[],labels:string[]=[];
  for(const [n,l] of layers.entries()){
    if(![l.sourceSeconds,l.start,l.duration,l.trim,l.volume,l.speechVolume,l.fadeIn,l.fadeOut].every(Number.isFinite)||l.duration<=0||l.start<0||l.trim<0||l.trim>=l.sourceSeconds)throw Error('Некорректные параметры звукового слоя.');
    const label=`sound${n}`,parts=[`[${firstInput+n}:a]aresample=44100,atrim=start=${l.trim}:duration=${l.sourceSeconds-l.trim}`,'asetpts=PTS-STARTPTS'];
    if(l.loop)parts.push(`aloop=loop=-1:size=${Math.max(1,Math.floor((l.sourceSeconds-l.trim)*44100))}`,'asetpts=N/SR/TB');
    parts.push(`atrim=duration=${l.duration}`,`volume='${soundVolumeExpression(l,speech)}':eval=frame`);
    if(l.fadeIn>0)parts.push(`afade=t=in:st=0:d=${l.fadeIn}`);
    if(l.fadeOut>0)parts.push(`afade=t=out:st=${Math.max(0,l.duration-l.fadeOut)}:d=${l.fadeOut}`);
    parts.push(`adelay=${Math.round(l.start*1000)}:all=1[${label}]`);filters.push(parts.join(','));labels.push(`[${label}]`);
  }
  return {filter:filters.join(';'),labels,inputs:layers.map(l=>l.assetId)};
}
