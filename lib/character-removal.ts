import { getItem, now, type Project } from './domain';

export function characterRemovalReason(p:Project,itemId:string) {
  const item=getItem(p,itemId);
  if(item.stage!==1) return 'Удаление карточки доступно на этапе «Герои».';
  if(item.removedAt) return 'Карточка уже удалена.';
  const files=new Set(item.variants.flatMap(v=>v.assetId?[v.assetId]:[]));
  for(const ref of item.character?.refs??[])files.add(ref);
  if(p.jobs.some(j=>j.purpose!=='voice-test'&&['queued','dispatching','pending','saving'].includes(j.status)&&
    (j.itemId===itemId||getItem(p,j.itemId).stage>1||[...j.refs??[],...j.characterRefs??[]].some(ref=>files.has(ref)))))
    return 'Дождитесь текущих генераций, использующих героя, или отмените ещё не отправленные задачи.';
  return '';
}
export function removeCharacter(p:Project,itemId:string) {
  const reason=characterRemovalReason(p,itemId);if(reason)throw new Error(reason);
  const item=getItem(p,itemId);item.removedAt=now();item.approvedId=undefined;
}
export function restoreCharacter(p:Project,itemId:string) {
  const item=getItem(p,itemId);
  if(item.stage!==1||!item.removedAt)throw new Error('Удалённая карточка героя не найдена.');
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw new Error('Дождитесь завершения текущих задач перед восстановлением героя.');
  item.removedAt=undefined;item.approvedId=undefined;
}
