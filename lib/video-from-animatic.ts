import {animaticBasis,animaticIssue} from './animatic';
import {validateAnimaticManifest} from './animatic-manifest';
import {supportsEndFrame} from './video-end-frame';
import type {Item,Project,Variant} from './domain';
import {animaticManifestSchema,type AnimaticManifest} from './animatic-manifest';
import {syncVideoPlans} from './video';
import {versionSignature} from './creative-versions';
import type {KeyframeRole} from './keyframes';
import {frameCropTransformSchema,type FrameCropTransform} from './frame-crop';
import {captureVideoPreparationBasis,legacyPreparationSignature,preparationMediaBasis,preparationShotBasis,preparationOriginalFramesIssue,videoBasisUsesEnd} from './video-preparation-basis';

export type PreparedFrame={variantId:string;assetId:string;transform?:FrameCropTransform};
export type PreparedFrameHistory={role:KeyframeRole;frame:PreparedFrame;created:string};
export type VideoPreparation={animaticVariantId:string;manifestBasis:string;shotId?:string;startFrame:PreparedFrame;endFrame?:PreparedFrame;middleFrame?:PreparedFrame;duration:number;overriddenRoles?:KeyframeRole[];frameHistory?:PreparedFrameHistory[];shotBasis?:string;sourceFrames?:{startFrame:PreparedFrame;endFrame?:PreparedFrame};sourceDuration?:number;legacyBases?:string[]};
export type PreparedVideoItem=Item&{videoPreparation?:VideoPreparation};
/** Preparation replaces only plan metadata. Share immutable history, jobs and
 * media variants instead of duplicating the entire film in a 128 MB Worker.
 * Reconciliation may also update linked voice-card metadata (stage 6). */
export function videoPreparationDraft(p:Project):Project{
  return {...p,items:p.items.map(item=>item.stage===7||item.stage===6?{...item}:item)};
}
export function selectedAnimaticManifest(p:Project,variantId=p.animatic?.selectedId):{variant:Variant;manifest:AnimaticManifest}{
  const variant=p.animatic?.variants.find(v=>v.id===variantId),manifest=(variant as Variant&{animaticManifest?:AnimaticManifest}|undefined)?.animaticManifest;
  if(!variant?.assetId||!manifest)throw Error('Для автоматического выбора кадров соберите аниматик с сохранённым составом. Старый файл остаётся доступным.');
  const issue=animaticIssue(p,variant);if(issue)throw Error(issue);const value=validateAnimaticManifest(p,manifest,animaticBasis(p));if(value.projectId!==p.id)throw Error('Аниматик относится к другому проекту.');return {variant,manifest:value};
}
function assertOriginalFrame(p:Project,itemId:string,frame:PreparedFrame){
  const item=p.items.find(i=>i.id===itemId),v=item?.variants.find(v=>v.id===frame.variantId)??p.removedVariants?.find(r=>r.itemId===itemId&&r.variant.id===frame.variantId)?.variant;
  const originalAssetId=frame.transform?frameCropTransformSchema.parse(frame.transform).sourceAssetId:frame.assetId;
  if(!item||!v||v.kind!=='image'||v.assetId!==originalAssetId)throw Error('Исходный ключевой кадр изменился или недоступен. Откройте раскадровку и проверьте выбранную версию.');
}
/** Only preparation changes; original animatic records and storyboard variants are never rewritten. */
function retainPreparedFrames(previous:VideoPreparation|undefined,next:VideoPreparation):VideoPreparation{
  const history=[...(previous?.frameHistory??[])];
  for(const role of ['start','middle','end'] as const){const key=`${role}Frame` as 'startFrame'|'middleFrame'|'endFrame',frame=previous?.[key];
    if(frame&&versionSignature(frame)!==versionSignature(next[key])&&!history.some(row=>row.role===role&&versionSignature(row.frame)===versionSignature(frame)))history.push({role,frame:structuredClone(frame),created:new Date().toISOString()});
  }
  // A real source/timing change must never inherit old full-object aliases.
  const {legacyBases:_,...safe}=next;
  const unchanged=previous&&preparationMediaBasis(previous)===preparationMediaBasis(next)&&previous.shotBasis===next.shotBasis;
  return {...safe,...(unchanged&&previous.legacyBases?.length?{legacyBases:previous.legacyBases}:{}),...(history.length?{frameHistory:history}:{})};
}
function compatiblePreparation(p:Project,item:PreparedVideoItem,next:VideoPreparation):VideoPreparation{
  const previous=item.videoPreparation;if(!previous)return next;
  const manifest=p.animatic?.variants.find(v=>v.id===previous.animaticVariantId)?.animaticManifest;
  const oldShotBasis=previous.shotBasis??preparationShotBasis(p,item,{scriptVariantId:manifest?.scriptVariantId,shotOrder:manifest?.clips.map(c=>c.shotId??c.title)});
  if(preparationMediaBasis(previous)!==preparationMediaBasis(next)||oldShotBasis!==next.shotBasis)return next;
  const candidates=new Set([legacyPreparationSignature(previous),...(previous.legacyBases??[])]);
  const used=[...item.variants,...p.jobs.filter(j=>j.itemId===item.id)].flatMap(v=>v.videoPreparationBasis&&!v.videoPreparationBasis.startsWith('vp2:')&&candidates.has(v.videoPreparationBasis)?[v.videoPreparationBasis]:[]);
  return {...next,...(used.length?{legacyBases:[...new Set(used)]}:{})};
}
/** Uses original files recorded in this animatic, never a screenshot or a newer implicit approval. */
export function prepareVideosFromAnimatic(p:Project,variantId:string){
  const {manifest}=selectedAnimaticManifest(p,variantId);syncVideoPlans(p);const changed:string[]=[],manifestBasis=versionSignature(manifest);
  for(const clip of manifest.clips){
    const source=p.items.find(i=>i.id===clip.itemId);if(!source||source.stage!==5||source.excludedAt||source.removedAt||source.planArchive)throw Error(`«${clip.title}» больше не входит в фильм. Соберите текущий аниматик.`);
    const item=p.items.find(i=>i.stage===7&&!i.planArchive&&!i.removedAt&&(clip.shotId?i.sourceShot?.shotId===clip.shotId:i.sourceShot?.title===source.sourceShot?.title)) as PreparedVideoItem|undefined;
    if(!item)throw Error(`Не найден видеоплан: ${clip.title}. Подготовьте текущий сценарий.`);
    const frame=(role:KeyframeRole)=>{const f=clip.frames.find(f=>f.role===role);if(!f)return undefined;const value={variantId:f.variantId,assetId:f.assetId};assertOriginalFrame(p,clip.itemId,value);return value;};
    const startFrame=frame('start');if(!startFrame)throw Error(`«${clip.title}»: нет первого кадра.`);
    const endFrame=frame('end');
    const data:VideoPreparation=compatiblePreparation(p,item,retainPreparedFrames(item.videoPreparation,{animaticVariantId:variantId,manifestBasis,shotId:clip.shotId,startFrame,endFrame,middleFrame:frame('middle'),duration:clip.duration,shotBasis:preparationShotBasis(p,item),sourceFrames:{startFrame:structuredClone(startFrame),endFrame:endFrame&&structuredClone(endFrame)},sourceDuration:clip.duration}));
    if(versionSignature(item.videoPreparation)!==versionSignature(data)){item.videoPreparation=data;changed.push(item.id);}
  }
  return changed;
}
export function overridePreparedVideoFrame(p:Project,itemId:string,role:'start'|'end',variantId:string){
  const item=p.items.find(i=>i.id===itemId&&i.stage===7&&!i.planArchive&&!i.removedAt) as PreparedVideoItem|undefined;if(!item?.videoPreparation)throw Error('Сначала подготовьте видеоплан из аниматика.');
  const source=p.items.find(i=>i.stage===5&&!i.planArchive&&!i.removedAt&&(item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:i.sourceShot?.title===item.sourceShot?.title));
  const v=source?.variants.find(v=>v.id===variantId);if(!v?.assetId||v.kind!=='image'||((v as Variant&{keyframe?:KeyframeRole}).keyframe??'start')!==role)throw Error('Выберите соответствующий ключевой кадр этого плана.');
  item.videoPreparation=compatiblePreparation(p,item,retainPreparedFrames(item.videoPreparation,{...item.videoPreparation,[role+'Frame']:{variantId:v.id,assetId:v.assetId},overriddenRoles:[...new Set([...(item.videoPreparation.overriddenRoles??[]),role])]}));
}
export function cropPreparedVideoFrame(p:Project,itemId:string,role:'start'|'end',data:{sourceVariantId:string;expectedAssetId:string;assetId:string;transform:FrameCropTransform}){
  const item=p.items.find(i=>i.id===itemId&&i.stage===7&&!i.planArchive&&!i.removedAt) as PreparedVideoItem|undefined;
  if(!item?.videoPreparation)throw Error('Сначала подготовьте видеоплан из аниматика.');const issue=videoPreparationIssue(p,item);if(issue)throw Error(issue);
  const current=role==='start'?item.videoPreparation.startFrame:item.videoPreparation.endFrame;
  if(!current||current.assetId!==data.expectedAssetId||current.variantId!==data.sourceVariantId)throw Error('Выбранный кадр изменился. Откройте его подготовку заново.');
  const transform=frameCropTransformSchema.parse(data.transform);
  if(transform.sourceAssetId!==(current.transform?.sourceAssetId??current.assetId)||data.assetId===transform.sourceAssetId||data.assetId===current.assetId)throw Error('Сохраните область отдельным PNG из текущего исходного кадра.');
  item.videoPreparation=retainPreparedFrames(item.videoPreparation,{...item.videoPreparation,[role+'Frame']:{variantId:data.sourceVariantId,assetId:data.assetId,transform},overriddenRoles:[...new Set([...(item.videoPreparation.overriddenRoles??[]),role])]});
}
export function videoPreparationIssue(p:Project,item:PreparedVideoItem,request?:{videoPreparationBasis?:string;endFrameAssetId?:string;model?:string}){
  const value=item.videoPreparation;if(!value)return '';
  try{
    // Existing preparations depend on their OWN original clip. Whole-film
    // validation is reserved for a new prepare, not every unaffected video.
    const saved=p.animatic?.variants.find(v=>v.id===value.animaticVariantId),manifest=!value.sourceFrames&&saved?.animaticManifest?animaticManifestSchema.parse(saved.animaticManifest):undefined;
    if(!value.sourceFrames&&(!saved?.assetId||!manifest||manifest.projectId!==p.id||versionSignature(manifest)!==value.manifestBasis))return 'Состав выбранного аниматика недоступен. Подготовьте видеопланы снова.';
    const source=p.items.find(i=>i.stage===5&&!i.planArchive&&!i.removedAt&&(value.shotId?i.sourceShot?.shotId===value.shotId:i.sourceShot?.title===item.sourceShot?.title));
    if(!source||source.excludedAt)return 'Этот план исключён из текущего фильма.';
    const clip=manifest?.clips.find(c=>c.itemId===source.id),duration=value.sourceDuration??clip?.duration;
    if(duration===undefined||Math.abs(duration-value.duration)>.001)return 'Длительность подготовленного плана изменилась. Подготовьте видеоплан из текущего аниматика.';
    const oldBasis=value.shotBasis??preparationShotBasis(p,item,{scriptVariantId:manifest?.scriptVariantId,shotOrder:manifest?.clips.map(c=>c.shotId??c.title)});
    if(oldBasis!==preparationShotBasis(p,item))return 'Постановка или стыковка этого плана изменилась. Проверьте его кадры и подготовьте текущий аниматик.';
    const useEnd=request?request.videoPreparationBasis?videoBasisUsesEnd(request):!!request.model&&supportsEndFrame(request.model):true;
    const frameIssue=preparationOriginalFramesIssue(p,item,request,useEnd);if(frameIssue)return frameIssue;
    assertOriginalFrame(p,source.id,value.startFrame);if(useEnd&&value.endFrame)assertOriginalFrame(p,source.id,value.endFrame);
    return '';
  }catch(e){return (e as Error).message;}
}

export function preparedVideoInputs(p:Project,item:Item,modelId:string,startOverride?:string,endOverride?:string){
 const data=(item as PreparedVideoItem).videoPreparation;if(!data)return {startFrameId:startOverride,endFrameId:endOverride,duration:undefined,basis:undefined};
 const issue=videoPreparationIssue(p,item,{model:modelId});if(issue)throw Error(issue);
 const startFrameId=startOverride??data.startFrame.assetId;
 const endFrameId=supportsEndFrame(modelId)?endOverride??data.endFrame?.assetId:undefined;
 return {startFrameId,endFrameId,duration:data.duration,basis:captureVideoPreparationBasis(p,item,{model:modelId,refs:[startFrameId],endFrameAssetId:endFrameId})};
}
