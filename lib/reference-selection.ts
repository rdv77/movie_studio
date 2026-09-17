import type { Project } from './domain';
export function hiddenReferences(p:Project) {
  const live=new Set(p.items.filter(i=>!i.removedAt&&!i.planArchive).flatMap(i=>[
    ...(i.character?.refs??[]),...i.variants.flatMap(v=>v.assetId?[v.assetId]:[]),
  ]));
  const removed=[...(p.removedVariants??[]).flatMap(r=>r.variant.assetId?[r.variant.assetId]:[]),
    ...p.items.filter(i=>i.removedAt||i.planArchive).flatMap(i=>[...(i.character?.refs??[]),...i.variants.flatMap(v=>v.assetId?[v.assetId]:[])])];
  return new Set([...(p.hiddenReferenceIds??[]),...removed.filter(id=>!live.has(id))]);
}
export function selectedReferences(p:Project,refs:string[]) {
  const hidden=hiddenReferences(p);
  return [...new Set(refs)].filter(id=>!hidden.has(id));
}
export function assertSelectedReferences(p:Project,refs:string[]) {
  const selected=selectedReferences(p,refs);
  if(selected.length!==refs.length)throw new Error('Список референсов изменился: есть скрытые, удалённые или повторяющиеся изображения. Проверьте галочки заново.');
  return selected;
}
