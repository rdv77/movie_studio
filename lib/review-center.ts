import { chosen,dependencies,variantCurrent,isApproved,approve,participates,type Project,type Item } from './domain';
import { materialBasis } from './material-basis';
import { stagePosition } from './stage-order';
import { unchangedSpeechReason } from './speech-approval';
import { resolveFinalClip } from './render';
import {hasKeyframeConfig,planKeyframeMode,requiredKeyframeRoles,selectedKeyframe,KEYFRAME_ROLE_NAMES,type KeyframeRole,type KeyframeSelection} from './keyframes';
import {storyboardSelection,storyboardSetIssues,storyboardSetReview,assertStoryboardSelection,approveStoryboardSelection,type StoryboardSelection} from './storyboard-approval';
export type ReviewRow={itemId:string;variantId?:string;stage:number;title:string;status:'ready'|'review'|'conflict'|'missing'|'approved';reason:string;keyframes?:KeyframeSelection;};
export type ReviewScope='all'|'animatic';
export function selectableReviewRows(rows:ReviewRow[]):ReviewRow[]{
  return rows.filter(row=>!!row.variantId&&(row.status==='ready'||row.status==='review'));
}
export type ReviewKeyframePreview={role:KeyframeRole;label:string;variantId?:string;assetId?:string;status:'current'|'review'|'conflict'|'missing';reason:string};
/** Preview the actual selected role set, never the first image or generation history alone. */
export function reviewKeyframePreviews(p:Project,itemId:string):ReviewKeyframePreview[]{
  const item=p.items.find(i=>i.id===itemId&&i.stage===5&&participates(p,i));if(!item)return [];
  if(!hasKeyframeConfig(p,item)){
    const v=chosen(item);if(v?.kind!=='image'||!v.assetId)return [];
    const current=variantCurrent(p,item,v);
    return [{role:'start',label:KEYFRAME_ROLE_NAMES.start,variantId:v.id,assetId:v.assetId,status:current?'current':'review',reason:current?'Актуальный выбранный кадр.':'Основа изменилась. Просмотрите этот кадр перед подтверждением.'}];
  }
  const issues=storyboardSetIssues(p,item);
  return requiredKeyframeRoles(planKeyframeMode(p,item)).map(role=>{
    const v=selectedKeyframe(item,role),local=issues.filter(issue=>!issue.role||issue.role===role);
    const structural=local.find(issue=>!['foundation_changed','missing_basis'].includes(issue.code));
    const status=!v?'missing':structural?'conflict':local.length?'review':'current';
    return {role,label:KEYFRAME_ROLE_NAMES[role],variantId:v?.id,assetId:v?.assetId,status,
      reason:!v?'Выбранное изображение отсутствует.':structural?.message??local[0]?.message??'Актуальный выбранный кадр.'};
  });
}
/** Pin all role IDs shown in the centre so a changed endpoint cannot be approved by an old selection. */
export function reviewApprovalSelection(row:ReviewRow):StoryboardSelection&{reviewed:boolean}{
  if(!row.variantId||!['ready','review'].includes(row.status))throw Error('Выберите готовый материал для утверждения.');
  return {itemId:row.itemId,variantId:row.variantId,...(row.keyframes?{keyframes:{...row.keyframes}}:{}),reviewed:row.status==='review'};
}
export function pairedItem(p:Project,item:Item,stage:number){
  const shot=item.sourceShot;if(!shot)return undefined;
  const matches=p.items.filter(i=>i.stage===stage&&participates(p,i)&&i.sourceShot&&(shot.shotId?i.sourceShot.shotId===shot.shotId:
    !i.sourceShot.shotId&&!!shot.scriptId&&i.sourceShot.scriptId===shot.scriptId&&i.sourceShot.title===shot.title));
  // Ambiguous legacy names cannot identify a target. Never open an arbitrary first match.
  return matches.length===1?matches[0]:undefined;
}
export function reviewVoiceItem(p:Project,itemId:string):Item|undefined{
  const item=p.items.find(i=>i.id===itemId&&i.stage===7&&participates(p,i));
  return item?.sourceShot?pairedItem(p,item,6):undefined;
}
export function timingConflict(p:Project,item:Item){
  if(![6,7].includes(item.stage)||!item.sourceShot)return '';
  const video=item.stage===7?item:pairedItem(p,item,7),audio=item.stage===6?item:pairedItem(p,item,6);
  const v=video&&chosen(video),a=audio&&chosen(audio);
  if(!v?.assetId||!a?.assetId)return '';
  const vs=p.mediaDurations?.[v.assetId],as=p.mediaDurations?.[a.assetId];
  if(!vs||!as)return 'Проверьте длительности файлов перед быстрым утверждением.';
  const cut=p.assemblyCuts?.find(c=>c.itemId===video!.id&&c.variantId===v.id),available=vs-(cut?.trim??v.trim),seconds=cut?.duration??available,speech=as-a.trim;
  if(available<=0||speech<=0||seconds>available+.05)return 'Монтажный участок выходит за границы файла. Исправьте начало или длительность.';
  try{resolveFinalClip({...v,title:item.title,trim:cut?.trim??v.trim,duration:cut?.duration??v.duration,assemblyMode:cut?.duration!=null?'custom':'full'},vs,speech);return '';}
  catch(e){return `Видео ${seconds.toFixed(2)} сек, речь ${speech.toFixed(2)} сек${speech>seconds?`: превышение ${(speech-seconds).toFixed(2)} сек`:''}. ${(e as Error).message}`;}
}
export function reviewRows(p:Project,scope:ReviewScope='all'):ReviewRow[]{
  return p.items.filter(i=>participates(p,i)&&i.stage!==8&&(scope!=='animatic'||i.stage===5||i.stage===6&&p.animaticSettings?.sound!=='silent')).sort((a,b)=>stagePosition(a.stage)-stagePosition(b.stage)).map(item=>{
    const v=chosen(item),base={itemId:item.id,variantId:v?.id,stage:item.stage,title:item.title,keyframes:storyboardSelection(p,item)};
    if(!v)return {...base,status:'missing',reason:'Выберите готовый вариант.'};
    if(item.character&&(v.kind!=='image'||!v.assetId||!v.character))return {...base,status:'missing',reason:'Выберите готовый образ героя с сохранённым описанием.'};
    if([5,6,7].includes(item.stage)&&(!v.assetId||v.kind!==({5:'image',6:'audio',7:'video'} as any)[item.stage]))return {...base,status:'missing',reason:'Нужен готовый файл.'};
    // Still images can hold for the full speech; future video duration is not an animatic constraint.
    const conflict=scope==='animatic'?'':timingConflict(p,item);
    if(conflict)return {...base,status:'conflict',reason:conflict};
    if(v.lipsync&&p.items.find(i=>i.id===v.lipsync!.audioItemId)?.approvedId!==v.lipsync.audioVariantId)return {...base,status:'conflict',reason:'После синхронизации выбран другой голос. Повторите синхронизацию губ.'};
    if(p.jobs.some(j=>j.itemId===item.id&&j.purpose!=='media-review'&&['queued','dispatching','pending','saving'].includes(j.status)))return {...base,status:'conflict',reason:'Материал ещё создаётся.'};
    if(isApproved(p,item)&&v.id===item.approvedId)return {...base,status:'approved',reason:'Утверждён.'};
    if(item.stage===5&&hasKeyframeConfig(p,item))return {...base,...storyboardSetReview(p,item)};
    if(variantCurrent(p,item,v))return {...base,status:'ready',reason:'Выбран актуальный вариант.'};
    if(item.stage===6&&!unchangedSpeechReason(p,item.id,v.id))return {...base,status:'ready',reason:'Реплика не изменилась.'};
    return {...base,status:'review',reason:'Основа изменилась. Посмотрите материал и отметьте, если он подходит текущему фильму.'};
  });
}
export function approveReview(p:Project,selections:(StoryboardSelection&{reviewed?:boolean})[],scope:ReviewScope='all'){
  if(!selections.length||new Set(selections.map(s=>s.itemId)).size!==selections.length)throw Error('Выберите материалы без повторов.');
  const copy=structuredClone(p);
  const rows=reviewRows(copy,scope);
  for(const row of rows.filter(r=>selections.some(s=>s.itemId===r.itemId))){
    const currentRow=reviewRows(copy,scope).find(r=>r.itemId===row.itemId)!;
    if(currentRow.status==='review'&&!selections.find(s=>s.itemId===row.itemId)?.reviewed)throw Error(`${row.title}: после предыдущих утверждений изменилась основа. Посмотрите материал и отметьте его повторно.`);
    if(row.variantId!==selections.find(s=>s.itemId===row.itemId)?.variantId)throw Error('Выбор изменился. Обновите данные.');
    if(['conflict','missing'].includes(currentRow.status))throw Error(`${row.title}: ${currentRow.reason}`);
    const item=copy.items.find(i=>i.id===row.itemId)!,v=chosen(item)!;
    const selection=selections.find(s=>s.itemId===row.itemId)!;
    if(item.stage===5&&hasKeyframeConfig(copy,item)){
      assertStoryboardSelection(copy,item,selection);
      approveStoryboardSelection(copy,selection,!!selection.reviewed);continue;
    }
    // Explicit multi-card director approval: preserve file, ID, source and cost.
    v.deps=dependencies(copy,item.stage);
    if([5,6,7].includes(item.stage))v.reviewBasis=materialBasis(copy,item,v)||undefined;
    approve(copy,item.id);
  }
  if(selections.some(s=>!rows.some(r=>r.itemId===s.itemId)))throw Error('Материал больше не участвует в фильме.');
  p.items=copy.items;
}
