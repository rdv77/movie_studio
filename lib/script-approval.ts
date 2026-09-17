import { approve, chosen, dependencies, getItem, stageReady, type Project } from './domain';

export function scriptReapprovalReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),variant=chosen(item);
  if(item.removedAt || item.planArchive || item.stage!==4 || variant?.id!==variantId || variant.kind!=='text' || !variant.text.trim())
    return 'Выберите подробный сценарий с текстом в этой карточке.';
  if(!stageReady(p,4)) return 'Сначала утвердите предыдущие этапы, перечисленные в списке выше.';
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status))) return 'Дождитесь завершения текущих задач.';
  if(variant.deps===dependencies(p,4)) return 'Этот сценарий уже относится к текущей основе. Используйте обычное утверждение.';
  return '';
}

export function reapproveScript(p:Project,itemId:string,variantId:string) {
  const reason=scriptReapprovalReason(p,itemId,variantId);
  if(reason)throw new Error(reason);
  const copy=structuredClone(p),item=getItem(copy,itemId);
  // The director explicitly reviews this existing script. Keep its identity,
  // contents and generation history; do not reapprove downstream materials.
  chosen(item)!.deps=dependencies(copy,4);
  approve(copy,itemId);
  Object.assign(getItem(p,itemId),item);
}
