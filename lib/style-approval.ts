import { approve, chosen, dependencies, getItem, stageReady, type Project } from './domain';

export function styleReapprovalReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),variant=chosen(item);
  if(item.stage!==2||variant?.id!==variantId) return 'Выберите вариант визуального стиля.';
  if(!stageReady(p,2)) return 'Сначала утвердите общий сценарий.';
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status))) return 'Дождитесь завершения текущих задач.';
  if(variant.deps===dependencies(p,2)) return 'Этот вариант уже относится к текущей основе. Используйте обычное утверждение.';
  return '';
}
export function reapproveStyle(p:Project,itemId:string,variantId:string) {
  const reason=styleReapprovalReason(p,itemId,variantId);if(reason)throw new Error(reason);
  const copy=structuredClone(p),item=getItem(copy,itemId);
  approve(copy,itemId);
  Object.assign(getItem(p,itemId),item);
}
