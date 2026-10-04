import {participates,type Project,type Item} from './domain';
import {keyframeOptions,planKeyframeMode,requiredKeyframeRoles,selectedKeyframe,type KeyframeRole} from './keyframes';
import {allowNewSeries,unresolvedJobBlocks} from './job-wait';
import {queueActive} from './queue-policy';

export type AdditionalFrameRole=Extract<KeyframeRole,'end'|'middle'>;
export function additionalFrameItems(p:Project,role:AdditionalFrameRole){
  return p.items.filter(item=>item.stage===5&&participates(p,item)&&requiredKeyframeRoles(planKeyframeMode(p,item)).includes(role));
}
/** Unknown image requests can be selected for explicit permission, but cannot be sent yet. */
export function additionalFrameAdmission(p:Project,item:Item,role:AdditionalFrameRole){
  const images=keyframeOptions(item,role),candidate=selectedKeyframe(item,role);
  const selected=candidate&&images.some(v=>v.id===candidate.id)?candidate:undefined;
  const jobs=p.jobs.filter(j=>j.itemId===item.id&&j.purpose!=='directing');
  const unknown=jobs.filter(unresolvedJobBlocks);
  const active=jobs.some(j=>j.purpose!=='media-review'&&queueActive(j));
  const otherUnknown=unknown.some(j=>j.kind!=='image'||!!j.purpose);
  // An existing unselected file needs a choice, not permission to pay again.
  const retryJobs=!images.length&&!active&&!otherUnknown?unknown:[];
  const blocked=active?'Для плана уже выполняется серия. Дождитесь результата.':unknown.length&&!retryJobs.length?'У этого плана есть запрос с неизвестным исходом. Проверьте его в журнале перед новой серией.':'';
  return {missing:!images.length,images,selected,retryJobs,blocked};
}
/** Only explicit permission: keep receipts, statuses, billing, choices and approvals. */
export function allowMissingAdditionalFrames(p:Project,role:AdditionalFrameRole,itemIds:string[]){
  if(!['end','middle'].includes(role)||!itemIds.length||new Set(itemIds).size!==itemIds.length)throw Error('Выберите роль и неповторяющийся список недостающих кадров.');
  const items=additionalFrameItems(p,role);
  const jobs=itemIds.flatMap(itemId=>{
    const item=items.find(i=>i.id===itemId);
    if(!item)throw Error('План не участвует в раскадровке или не требует этого ключевого кадра.');
    const row=additionalFrameAdmission(p,item,role);
    if(!row.missing)throw Error('Изображение уже появилось. Обновите список и выберите готовый вариант.');
    if(row.blocked)throw Error(row.blocked);
    const start=selectedKeyframe(item,'start');
    if(!start||!keyframeOptions(item,'start').some(v=>v.id===start.id))throw Error('Сначала выберите готовый первый кадр этого плана.');
    return row.retryJobs;
  });
  // Validate every selected plan before changing any permission.
  for(const job of jobs)allowNewSeries(job);
}
