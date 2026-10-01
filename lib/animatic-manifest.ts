import {z} from 'zod';
import type {Project,Item,Variant} from './domain';
import {participates} from './domain';
import {selectedKeyframe,planKeyframeMode,requiredKeyframeRoles,type KeyframeRole} from './keyframes';
import {versionShot,versionSignature} from './creative-versions';
import {shotDirectionSchema,type ShotDirection} from './shot-direction';
import {buildSoundscapeMix} from './soundscape';
import {musicSettings,musicIssue} from './music';

const identity=z.string().min(1).max(100),seconds=z.number().finite().positive().max(3600);
export const animaticFrameSchema=z.object({role:z.enum(['start','middle','end']),variantId:identity,assetId:identity,at:z.number().min(0).max(3600),duration:seconds,model:z.string().max(150),sourceBasis:z.string().max(200).optional()});
export const animaticManifestSchema=z.object({schemaVersion:z.literal(1),projectId:identity,scriptVariantId:identity.optional(),format:z.enum(['16:9','9:16']),basis:z.string().max(500000),seconds,clips:z.array(z.object({itemId:identity,shotId:identity.optional(),sceneId:identity.optional(),title:z.string().max(120),offset:z.number().min(0).max(10000),duration:seconds,frames:z.array(animaticFrameSchema).min(1).max(3),direction:shotDirectionSchema.optional()})).min(1).max(120),audio:z.array(z.object({variantId:identity,assetId:identity,offset:z.number().min(0).max(10000),duration:seconds,trim:z.number().min(0).max(3600),volume:z.number().min(0).max(2),speechType:z.string().optional(),speaker:z.string().optional()})).max(240),soundscape:z.array(z.object({layerId:identity,variantId:identity,assetId:identity,start:z.number().min(0),duration:seconds,trim:z.number().min(0),volume:z.number().min(0).max(2)}).passthrough()).max(300).optional(),music:z.object({variantId:identity,assetId:identity,settings:z.unknown()}).optional()});
export type AnimaticManifest=z.infer<typeof animaticManifestSchema>;
export type AnimaticFrame=z.infer<typeof animaticFrameSchema>;
export function frameSchedule(p:Project,item:Item,duration:number):AnimaticFrame[]{
  if(!Number.isFinite(duration)||duration<=0)throw Error('Укажите положительную длительность плана.');
  const roles=requiredKeyframeRoles(planKeyframeMode(p,item)),direction=versionShot(p,item)?.direction as ShotDirection|undefined;
  const frames=roles.map(role=>{const v=selectedKeyframe(item,role);if(!v?.assetId)throw Error(`«${item.title}»: отсутствует ${role==='start'?'первый':role==='end'?'конечный':'промежуточный'} кадр.`);return {role,v};});
  const count=Math.round(duration*24);if(count<roles.length)throw Error('План слишком короткий для всех ключевых кадров: оставьте хотя бы один кадр 1/24 сек на каждый момент.');
  const endHold=Math.max(1,Math.min(count-roles.length+1,Math.round((direction?.timing?.endingHold??duration*.4)*24)));
  const middleStart=roles.length===3?Math.max(1,Math.floor((count-endHold)*.5)):0;
  const boundaries=roles.length===1?[0,count]:roles.length===2?[0,count-endHold,count]:[0,middleStart,count-endHold,count];
  return frames.map(({role,v},n)=>({role,variantId:v.id,assetId:v.assetId!,model:v.model,sourceBasis:v.keyframeReviewBasis,at:boundaries[n]/count*duration,duration:(boundaries[n+1]-boundaries[n])/count*duration}));
}
export function buildAnimaticManifest(p:Project,plan:{clips:Variant[];audio:Variant[];seconds:number;music?:Variant;musicSettings?:unknown;soundscape?:unknown},basis:string):AnimaticManifest{
  const items=p.items.filter(i=>i.stage===5&&participates(p,i));if(items.length!==plan.clips.length)throw Error('Состав раскадровки изменился.');
  let offset=0;
  return animaticManifestSchema.parse({schemaVersion:1,projectId:p.id,scriptVariantId:p.items.find(i=>i.stage===4&&!i.planArchive&&!i.removedAt)?.approvedId,format:p.format,basis,seconds:plan.seconds,
    clips:items.map((item,n)=>{const duration=plan.clips[n].duration,shot=versionShot(p,item),clip={itemId:item.id,shotId:item.sourceShot?.shotId,sceneId:item.sourceShot?.sceneId,title:item.title,offset,duration,frames:frameSchedule(p,item,duration),direction:shot?.direction};offset+=duration;return clip;}),
    soundscape:plan.soundscape,audio:plan.audio.map(v=>({variantId:v.id,assetId:v.assetId!,offset:v.offset,duration:v.duration,trim:v.trim,volume:v.volume,speechType:v.speechType,speaker:v.speaker})),music:plan.music?.assetId?{variantId:plan.music.id,assetId:plan.music.assetId,settings:plan.musicSettings}:undefined});
}
export function validateAnimaticManifest(p:Project,input:unknown,basis:string):AnimaticManifest{
  const m=animaticManifestSchema.parse(input);if(m.projectId!==p.id||m.format!==p.format||m.basis!==basis)throw Error('Состав аниматика относится к другой версии проекта.');
  const items=p.items.filter(i=>i.stage===5&&participates(p,i));if(items.length!==m.clips.length)throw Error('Состав планов изменился во время сборки.');
  let elapsed=0;
  m.clips.forEach((clip,n)=>{const item=items[n];if(clip.itemId!==item.id||clip.shotId!==item.sourceShot?.shotId||clip.sceneId!==item.sourceShot?.sceneId||Math.abs(clip.offset-elapsed)>.001)throw Error('Порядок планов аниматика изменился.');
    const expected=frameSchedule(p,item,clip.duration);if(versionSignature(expected)!==versionSignature(clip.frames)||versionSignature(versionShot(p,item)?.direction)!==versionSignature(clip.direction))throw Error('Ключевые кадры или постановка изменились во время сборки.');elapsed+=clip.duration;});
  if(Math.abs(m.seconds-elapsed)>.001)throw Error('Хронометраж манифеста не совпадает с планами.');
  for(const audio of m.audio){const item=p.items.find(i=>i.stage===6&&participates(p,i)&&i.selectedId===audio.variantId),v=item?.variants.find(v=>v.id===audio.variantId);if(!v||v.assetId!==audio.assetId||v.trim!==audio.trim||v.volume!==audio.volume)throw Error('Выбранная озвучка изменилась во время сборки.');}
  if(m.music){const v=p.music?.variants.find(v=>v.id===m.music?.variantId);if(!v||v.assetId!==m.music.assetId||p.music?.approvedId!==v.id||musicIssue(p)||versionSignature(m.music.settings)!==versionSignature(musicSettings(p)))throw Error('Музыка изменилась во время сборки.');}
  const expectedSounds=p.animaticSettings?.music?buildSoundscapeMix(p,{seconds:m.seconds,clips:m.clips.map(c=>({itemId:c.itemId,shotId:c.shotId,sceneId:c.sceneId,offset:c.offset,duration:c.duration}))}):[];
  if(versionSignature(expectedSounds)!==versionSignature(m.soundscape??[]))throw Error('Звуковые слои изменились во время сборки.');
  return m;
}
export function manifestAssets(m:AnimaticManifest){return [...new Set([...m.clips.flatMap(c=>c.frames.map(f=>f.assetId)),...m.audio.map(a=>a.assetId),...(m.soundscape??[]).map(s=>s.assetId),...(m.music?[m.music.assetId]:[])])];}
/** A modest camera sketch, not an interpolation of characters or a promise of video movement. */
export function animaticMotionFilter(direction:ShotDirection|undefined,width:number,height:number,duration:number):string{
  const type=direction?.cameraMovement?.type,frames=Math.max(1,Math.round(duration*24));
  if(!type||type==='static'||!['push-in','pull-out','pan','tilt','zoom'].includes(type))return '';
  const z=type==='pull-out'?`1.08-0.08*on/${frames}`:type==='pan'||type==='tilt'?'1.05':`1+0.08*on/${frames}`;
  const x=type==='pan'?`(iw-iw/zoom)*on/${frames}`:'(iw-iw/zoom)/2',y=type==='tilt'?`(ih-ih/zoom)*on/${frames}`:'(ih-ih/zoom)/2';
  return `,zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=24`;
}
