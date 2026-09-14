import { approve, chosen, dependencies, getItem, stageReady, type Project } from './domain';

export function videoReapprovalReason(p: Project, itemId: string, variantId: string) {
  const item = getItem(p, itemId), video = chosen(item);
  if (item.planArchive || item.stage !== 7 || video?.id !== variantId || video.kind !== 'video' || !video.assetId)
    return 'Выберите готовый ролик этой карточки.';
  if (!stageReady(p, 7)) return 'Сначала устраните причины блокировки предыдущих этапов, перечисленные выше.';
  if (p.jobs.some(j => ['queued', 'dispatching', 'pending', 'saving'].includes(j.status)))
    return 'Дождитесь завершения текущих задач.';
  if (video.lipsync) {
    if (video.trim !== 0) return 'У синхронизированного ролика начало должно быть 0. Проверьте его через «Правки».';
    if (p.items.find(i => i.id === video.lipsync!.audioItemId)?.approvedId !== video.lipsync.audioVariantId)
      return 'Реплика этого ролика изменилась. Для нового голоса повторите синхронизацию губ.';
  }
  if (video.deps === dependencies(p, 7)) return 'Вариант уже относится к текущей основе. Используйте обычное утверждение.';
  return '';
}

export function reapproveVideo(p: Project, itemId: string, variantId: string) {
  const reason = videoReapprovalReason(p, itemId, variantId);
  if (reason) throw new Error(reason);
  const copy = structuredClone(p), item = getItem(copy, itemId), source = chosen(item)!;
  // Explicit review updates the existing card; generation records retain their original basis.
  source.deps = dependencies(copy, 7);
  approve(copy, itemId);
  Object.assign(getItem(p, itemId), item);
}
