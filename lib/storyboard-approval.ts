import { approve, chosen, dependencies, getItem, stageReady, type Project } from './domain';
import { videoShot } from './video';

export function storyboardReapprovalReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),variant=chosen(item);
  if(item.removedAt || item.planArchive || item.stage!==5 || variant?.id!==variantId ||
    !(variant.kind==='image'&&variant.assetId || variant.kind==='text'&&variant.text.trim()))
    return 'Выберите изображение или описание в актуальной карточке раскадровки.';
  if(!stageReady(p,5)) return 'Сначала утвердите предыдущие этапы, перечисленные в списке выше.';
  if(item.sourceShot&&!videoShot(p,item)) return 'Этого плана больше нет в утверждённом сценарии. Подготовьте карточки по текущему сценарию.';
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status))) return 'Дождитесь завершения текущих задач.';
  if(variant.deps===dependencies(p,5)) return 'Этот вариант уже относится к текущей основе. Используйте обычное утверждение.';
  return '';
}

export function reapproveStoryboard(p:Project,itemId:string,variantId:string) {
  const reason=storyboardReapprovalReason(p,itemId,variantId);
  if(reason)throw new Error(reason);
  const copy=structuredClone(p),item=getItem(copy,itemId);
  // Explicit director review, without duplicating media or rewriting the
  // original generation record. Derived stages retain their existing basis.
  chosen(item)!.deps=dependencies(copy,5);
  approve(copy,itemId);
  Object.assign(getItem(p,itemId),item);
}
