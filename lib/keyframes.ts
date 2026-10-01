import {variantCurrent} from './domain';
import {z} from 'zod';
import type {Item,Job,Project,Variant} from './domain';
import type {ShotDirection} from './shot-direction';
import {materialBasis} from './material-basis';
import {versionShot,versionSignature,versionStable} from './creative-versions';
import {GROK_IMAGE_MODEL,LEGACY_IMAGE_SETTINGS,type ImageSettings} from './image-quality';

export const KEYFRAME_ROLES=['start','middle','end'] as const;
export const KEYFRAME_ROLE_NAMES:Record<KeyframeRole,string>={start:'Первый кадр',middle:'Промежуточный кадр',end:'Последний кадр'};
export type KeyframeRole=typeof KEYFRAME_ROLES[number];
export type KeyframeMode='single'|'pair'|'triple';
export type KeyframeSelection={startId?:string;middleId?:string;endId?:string};
export type KeyframeApproval=KeyframeSelection&{basis:string};
export type KeyframeMetadata={keyframe?:KeyframeRole;pairId?:string;sourceFrameVariantId?:string;keyframeSourceBasis?:string;keyframeReviewBasis?:string};
export type KeyframeVariant=Variant&KeyframeMetadata;
export type KeyframeJob=Job&KeyframeMetadata;
export type KeyframeItem=Item&{keyframeMode?:KeyframeMode;keyframeSelection?:KeyframeSelection;approvedKeyframes?:KeyframeApproval};
const identity=z.string().min(1).max(100);
export const keyframeSelectionSchema=z.object({startId:identity.optional(),middleId:identity.optional(),endId:identity.optional()}).strict();
export const keyframeConfigSchema=z.object({mode:z.enum(['single','pair','triple'])}).strict();
export const keyframeMetadataSchema=z.object({keyframe:z.enum(KEYFRAME_ROLES).optional(),pairId:identity.optional(),sourceFrameVariantId:identity.optional(),keyframeSourceBasis:z.string().max(200).optional(),keyframeReviewBasis:z.string().max(200).optional()}).strict();
export type KeyframeIssue={code:string;message:string;role?:KeyframeRole;variantId?:string};
export type KeyframeReviewOptions={reviewChanged?:boolean;canApprove?:(p:Project,item:KeyframeItem)=>string};
const field=(role:KeyframeRole):keyof KeyframeSelection=>`${role}Id`;
const image=(v:Variant|undefined):v is KeyframeVariant=>!!v&&v.kind==='image'&&!!v.assetId;
function frameItem(p:Project,itemId:string):KeyframeItem{
  const item=p.items.find(i=>i.id===itemId) as KeyframeItem|undefined;
  if(!item||item.stage!==5||item.removedAt||item.planArchive)throw Error('Откройте актуальную карточку раскадровки.');
  return item;
}

/** A legacy one-image plan stays single. Only explicit directing data can recommend a pair. */
export function recommendedKeyframeMode(direction?:ShotDirection):KeyframeMode{
  if(!direction)return 'single';
  return direction.cameraMovement&&direction.cameraMovement.type!=='static'||
    direction.framingStart&&direction.framingEnd&&direction.framingStart!==direction.framingEnd||
    !!direction.endFrame?.trim()&&direction.endFrame.trim()!==direction.startFrame?.trim()||
    direction.positions?.some(position=>position.start.trim()!==position.end.trim())?'pair':'single';
}
export function keyframeMode(item:KeyframeItem,direction?:ShotDirection):KeyframeMode{return item.keyframeMode??recommendedKeyframeMode(direction);}
export function planKeyframeMode(p:Project,item:KeyframeItem):KeyframeMode{return keyframeMode(item,versionShot(p,item)?.direction);}
export function hasKeyframeConfig(p:Project,item:KeyframeItem):boolean{return !!(item.keyframeMode||item.keyframeSelection||item.approvedKeyframes)||planKeyframeMode(p,item)!=='single';}
export function requiredKeyframeRoles(mode:KeyframeMode):KeyframeRole[]{return mode==='single'?['start']:mode==='pair'?['start','end']:['start','middle','end'];}
export function keyframeOptions(item:Item,role:KeyframeRole):KeyframeVariant[]{
  return item.variants.filter((v):v is KeyframeVariant=>image(v)&&((v as KeyframeVariant).keyframe??'start')===role);
}
export function keyframeSelection(item:KeyframeItem):KeyframeSelection{
  const explicit=item.keyframeSelection?.startId;
  const chosen=item.variants.find(v=>v.id===item.selectedId);
  const start=explicit??(image(chosen)&&(chosen.keyframe??'start')==='start'?chosen.id:undefined)
    ??keyframeOptions(item,'start').find(v=>v.id===item.approvedId)?.id??keyframeOptions(item,'start').at(-1)?.id;
  return {...item.keyframeSelection,startId:start};
}
export function selectedKeyframe(item:KeyframeItem,role:KeyframeRole):KeyframeVariant|undefined{
  const id=keyframeSelection(item)[field(role)],found=item.variants.filter(v=>v.id===id);
  return found.length===1&&image(found[0])?found[0]:undefined;
}
/** A pinned file/version signature; labels, other plans and approvals never enter this hash. */
export function keyframeSourceBasis(v:KeyframeVariant):string{
  return versionSignature({id:v.id,assetId:v.assetId,model:v.model,created:v.created,imageSettings:v.imageSettings,
    jobId:v.jobId,versionInfo:v.versionInfo});
}
export function sourceImageSettings(v:KeyframeVariant):ImageSettings|undefined{
  return v.imageSettings??(v.model===GROK_IMAGE_MODEL?LEGACY_IMAGE_SETTINGS:undefined);
}
/** Role-aware semantic foundation: the endpoint adds the end state that a start still does not show. */
export function keyframeFoundationBasis(p:Project,item:KeyframeItem,role:KeyframeRole,v?:Partial<Variant>):string{
  const shot=versionShot(p,item),direction=shot?.direction as ShotDirection|undefined;
  const visual=role==='start'?{frame:direction?.startFrame,framing:direction?.framingStart,state:shot?.stateIn}:
    role==='end'?{frame:direction?.endFrame,framing:direction?.framingEnd,state:shot?.stateOut,changes:shot?.continuityChanges}:
      {actions:direction?.actionBeats,positions:direction?.positions,stateIn:shot?.stateIn,stateOut:shot?.stateOut};
  return versionSignature({role,foundation:materialBasis(p,item,{...v,basisVersion:2}),visual});
}
export function setKeyframeMode(p:Project,itemId:string,mode:KeyframeMode){
  const item=frameItem(p,itemId);item.keyframeMode=keyframeConfigSchema.parse({mode}).mode;
  // Keep previous choices and approvals for inspection; changing a mode never approves it.
}
export function chooseKeyframe(p:Project,itemId:string,role:KeyframeRole,variantId:string){
  const item=frameItem(p,itemId);
  if(!KEYFRAME_ROLES.includes(role)||!requiredKeyframeRoles(planKeyframeMode(p,item)).includes(role))throw Error('Этот кадр не используется в выбранном режиме.');
  const matches=item.variants.filter(v=>v.id===variantId);
  if(matches.length!==1||!keyframeOptions(item,role).some(v=>v.id===variantId))throw Error(`Выберите готовое изображение: ${KEYFRAME_ROLE_NAMES[role]}.`);
  item.keyframeSelection={...keyframeSelection(item),[field(role)]:variantId};
  if(role==='start')item.selectedId=variantId;
}
/** The director may explicitly review a still for a changed foundation before creating its endpoint. */
export function reviewKeyframeForCurrentBasis(p:Project,itemId:string,role:KeyframeRole,variantId:string){
  const item=frameItem(p,itemId),v=selectedKeyframe(item,role);
  if(!v||v.id!==variantId||(v.keyframe??'start')!==role)throw Error('Выбранное изображение изменилось. Обновите карточку.');
  v.keyframeReviewBasis=keyframeFoundationBasis(p,item,role,v);
  if(v.reviewBasis)v.reviewBasis=materialBasis(p,item,v);
  // Reviewing is not approval and does not rewrite the original paid request.
}
function selectedIssues(p:Project,item:KeyframeItem,includeFoundation:boolean):KeyframeIssue[]{
  const issues:KeyframeIssue[]=[],roles=requiredKeyframeRoles(planKeyframeMode(p,item)),selection=keyframeSelection(item),start=selectedKeyframe(item,'start');
  const add=(code:string,message:string,role:KeyframeRole,v?:KeyframeVariant)=>issues.push({code,message,role,variantId:v?.id});
  const seenIds=new Set<string>(),seenFiles=new Set<string>();
  for(const role of roles){
    const id=selection[field(role)],matches=item.variants.filter(v=>v.id===id),v=selectedKeyframe(item,role);
    if(matches.length>1){add('duplicate_variant','ID варианта повторяется; восстановите корректную карточку.',role);continue;}
    if(!v){add(`missing_${role}`,`Выберите готовое изображение: ${KEYFRAME_ROLE_NAMES[role]}. Текстовое описание не заменяет картинку.`,role);continue;}
    if((v.keyframe??'start')!==role){add('invalid_role',`Вариант помечен как другой ключевой кадр: ${KEYFRAME_ROLE_NAMES[role]}.`,role,v);continue;}
    if(v.keyframe&&!v.keyframeReviewBasis)add('missing_basis','У этого ключевого кадра нет сохранённой основы. Проверьте изображение для текущей версии.',role,v);
    if(seenIds.has(v.id)||seenFiles.has(v.assetId!))add('duplicate_file','Для разных моментов выбрано одно изображение. Используйте один кадр либо выберите отдельное изображение окончания.',role,v);
    seenIds.add(v.id);seenFiles.add(v.assetId!);
    if(includeFoundation&&((!v.keyframeReviewBasis&&!v.reviewBasis&&!variantCurrent(p,item,v))||v.keyframeReviewBasis&&v.keyframeReviewBasis!==keyframeFoundationBasis(p,item,role,v)||v.reviewBasis&&v.reviewBasis!==materialBasis(p,item,v)))
      add('foundation_changed','Основа этого кадра изменилась. Просмотрите изображение и явно подтвердите его для текущей версии.',role,v);
    if(role==='start')continue;
    if(!start){add('missing_source','Сначала выберите готовый первый кадр.',role,v);continue;}
    if(v.sourceFrameVariantId!==start.id||v.keyframeSourceBasis!==keyframeSourceBasis(start))add('start_changed','Этот кадр создан из другого первого кадра или прежней версии его файла. Повторите генерацию от выбранного первого кадра.',role,v);
    if(!v.refs.includes(start.assetId!))add('source_reference','В источниках конечного кадра отсутствует выбранный первый файл.',role,v);
    if(start.pairId&&v.pairId!==start.pairId)add('pair_changed','Первый и конечный кадры относятся к разным парам.',role,v);
    if(start.jobId&&v.jobId&&start.model!==v.model)add('model_changed','Конечный кадр создан другой моделью. Создайте его моделью первого кадра.',role,v);
    if(start.jobId&&v.jobId&&versionStable(sourceImageSettings(start))!==versionStable(sourceImageSettings(v)))add('quality_changed','Качество конечного кадра отличается от первого. Используйте те же настройки.',role,v);
  }
  return issues;
}
export function keyframeIssues(p:Project,item:KeyframeItem):KeyframeIssue[]{return selectedIssues(p,item,!keyframesApproved(p,item));}
export function keyframeApprovalBasis(p:Project,item:KeyframeItem):string{
  return versionSignature({mode:planKeyframeMode(p,item),frames:requiredKeyframeRoles(planKeyframeMode(p,item)).map(role=>{
    const v=selectedKeyframe(item,role);return {role,id:keyframeSelection(item)[field(role)],file:v&&keyframeSourceBasis(v),foundation:keyframeFoundationBasis(p,item,role,v)};
  })});
}
export function keyframesApproved(p:Project,item:KeyframeItem):boolean{
  if(item.stage!==5||item.removedAt||item.planArchive)return false;
  if(!hasKeyframeConfig(p,item))return false; // Existing domain approval handles legacy single images.
  const approval=item.approvedKeyframes,selection=keyframeSelection(item);
  return !!approval&&!selectedIssues(p,item,false).length&&approval.basis===keyframeApprovalBasis(p,item)&&
    requiredKeyframeRoles(planKeyframeMode(p,item)).every(role=>approval[field(role)]===selection[field(role)]);
}
/** Preflight the whole set before any mutation. No duplicate media or hidden approval on selection. */
export function approveKeyframes(p:Project,itemId:string,expected?:KeyframeSelection,options:KeyframeReviewOptions={}):KeyframeApproval{
  const item=frameItem(p,itemId),selection=keyframeSelection(item),roles=requiredKeyframeRoles(planKeyframeMode(p,item));
  const guard=options.canApprove?.(p,item);if(guard)throw Error(guard);
  if(expected&&roles.some(role=>expected[field(role)]!==selection[field(role)]))throw Error('Выбор ключевых кадров изменился. Обновите карточку.');
  const issues=selectedIssues(p,item,!options.reviewChanged);if(issues.length)throw Error(issues[0].message);
  const approval:KeyframeApproval={basis:keyframeApprovalBasis(p,item),...Object.fromEntries(roles.map(role=>[field(role),selection[field(role)]]))};
  item.keyframeSelection=selection;item.approvedKeyframes=approval;item.selectedId=selection.startId;item.approvedId=selection.startId;
  return approval;
}
export type KeyframeGenerationRequest={model:string;refs?:string[];imageSettings?:ImageSettings;pairId?:string;characterIds?:string[];versionInfo?:Variant['versionInfo']};
export type KeyframeGeneration=Required<Pick<KeyframeMetadata,'keyframe'|'pairId'|'keyframeReviewBasis'>>&KeyframeMetadata&{model:string;refs:string[];imageSettings?:ImageSettings;roleInstruction:string};
export function keyframeRoleInstruction(p:Project,item:KeyframeItem,role:KeyframeRole):string{
  const shot=versionShot(p,item),d=shot?.direction as ShotDirection|undefined;
  const frame=role==='start'?d?.startFrame:role==='end'?d?.endFrame:undefined;
  const state=role==='start'?shot?.stateIn:role==='end'?shot?.stateOut:undefined;
  const framing=role==='start'?d?.framingStart:role==='end'?d?.framingEnd:undefined;
  return [`Создай одно цельное изображение: ${KEYFRAME_ROLE_NAMES[role].toLocaleLowerCase('ru')} этого же плана. Без коллажа, надписей, стрелок и панелей.`,
    role!=='start'?'Обязательный визуальный источник — выбранный первый кадр. Сохрани героев, одежду, предметы, свет и стиль этого файла; измени только указанные действие, положение и ракурс.':'Покажи начало действия, а не его результат.',
    frame&&`Изображение момента: ${frame}`,state&&`Состояние: ${state}`,framing&&`Крупность: ${framing}`,
    role==='end'&&shot?.continuityChanges&&`Изменения к окончанию: ${shot.continuityChanges}`,
    role==='middle'&&d?.actionBeats&&`Промежуточные действия: ${JSON.stringify(d.actionBeats)}`].filter(Boolean).join('\n');
}
/** New endpoint requests are pinned to the actual selected start; enqueue/dispatch must recheck it. */
export function prepareKeyframeGeneration(p:Project,itemId:string,role:KeyframeRole,request:KeyframeGenerationRequest):KeyframeGeneration{
  const item=frameItem(p,itemId);
  if(!KEYFRAME_ROLES.includes(role)||!requiredKeyframeRoles(planKeyframeMode(p,item)).includes(role))throw Error('Этот ключевой кадр не используется в выбранном режиме.');
  if(!request.model.trim())throw Error('Выберите модель для создания кадра.');
  const result:KeyframeGeneration={keyframe:role,pairId:request.pairId??crypto.randomUUID(),keyframeReviewBasis:keyframeFoundationBasis(p,item,role,request),model:request.model,refs:[...new Set(request.refs??[])],imageSettings:request.imageSettings&&{...request.imageSettings},roleInstruction:keyframeRoleInstruction(p,item,role)};
  if(role==='start')return result;
  const start=selectedKeyframe(item,'start');if(!start||(start.keyframe??'start')!=='start')throw Error('Сначала выберите готовый первый кадр, затем создавайте конечный или промежуточный.');
  if(!start.keyframeReviewBasis&&!start.reviewBasis&&!variantCurrent(p,item,start)||start.keyframeReviewBasis&&start.keyframeReviewBasis!==keyframeFoundationBasis(p,item,'start',start)||start.reviewBasis&&start.reviewBasis!==materialBasis(p,item,start))throw Error('Основа первого кадра изменилась. Проверьте и утвердите его для текущей версии перед продолжением.');
  if(start.jobId&&request.model!==start.model)throw Error('Для конечного кадра используйте модель выбранного первого кадра.');
  if(start.jobId&&request.imageSettings&&versionStable(request.imageSettings)!==versionStable(sourceImageSettings(start)))throw Error('Для конечного кадра используйте качество выбранного первого кадра.');
  return {...result,pairId:start.pairId??start.id,sourceFrameVariantId:start.id,keyframeSourceBasis:keyframeSourceBasis(start),
    imageSettings:sourceImageSettings(start)&&{...sourceImageSettings(start)!},refs:[start.assetId!,...result.refs.filter(ref=>ref!==start.assetId)]};
}
/** Safe queue hook, used both before enqueue and immediately before a paid provider call. */
export function keyframeQueueIssue(p:Project,job:KeyframeJob):string{
  if(!job.keyframe)return '';
  let item:KeyframeItem;try{item=frameItem(p,job.itemId);}catch(e){return (e as Error).message;}
  if(job.kind!=='image'||!requiredKeyframeRoles(planKeyframeMode(p,item)).includes(job.keyframe))return 'Режим ключевых кадров изменился. Проверьте очередь.';
  if(job.keyframeReviewBasis!==keyframeFoundationBasis(p,item,job.keyframe,job))return 'Основа ключевого кадра изменилась. Запрос не отправлен.';
  if(job.keyframe==='start')return '';
  const start=selectedKeyframe(item,'start');
  if(!start||job.sourceFrameVariantId!==start.id||job.keyframeSourceBasis!==keyframeSourceBasis(start))return 'Выбранный первый кадр изменился или отсутствует. Запрос конечного кадра не отправлен.';
  if(!job.refs.includes(start.assetId!))return 'В запросе нет выбранного первого кадра. Запрос не отправлен.';
  if(start.jobId&&(job.model!==start.model||versionStable(job.imageSettings)!==versionStable(sourceImageSettings(start))))return 'Модель или качество первого кадра изменились. Запрос не отправлен.';
  return '';
}
