import { approve, chosen, dependencies, getItem, isApproved, participates, stageReady, type Project, type Item } from './domain';
import { scriptVideo, videoShot } from './video';
import { shotSchema } from './shots';

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

// Compare content, not JSON formatting or object key order. Keep unknown script
// fields too: a changed global direction must not be silently disregarded.
function stable(value: any): string {
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function scriptData(text:string) {
  const data=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  shotSchema.parse(data);
  return data;
}
function unchangedReason(p:Project,item:Item) {
  const v=chosen(item);
  if(!v||v.id!==item.approvedId)return 'Выбранный вариант ранее не был утверждён. Проверьте его отдельно.';
  const unavailable=storyboardReapprovalReason(p,item.id,v.id);
  if(unavailable)return unavailable;
  const script=scriptVideo(p);
  if(!script.source||!script.variant||item.sourceShot?.scriptId!==script.source.id)
    return 'Не удалось сопоставить карточку с подробным сценарием. Проверьте её отдельно.';
  try {
    // sourceShot is refreshed when cards are reconciled. deps retains the basis
    // of the last approval (also after individual reapproval), unlike shotSource.
    const before=JSON.parse(v.deps),after=JSON.parse(dependencies(p,5));
    const other=(basis:any[])=>[basis[0],...basis.slice(1).filter(e=>e[0]!==script.source!.id).sort((a,b)=>a[0].localeCompare(b[0]))];
    if(stable(other(before))!==stable(other(after)))
      return 'Изменилась общая основа: настройки, сценарий, герои, стиль или образы. Проверьте кадр отдельно.';
    const oldId=before.slice(1).find((e:any)=>e[0]===script.source!.id)?.[1];
    const previous=script.source.variants.find(v=>v.id===oldId)??p.removedVariants?.find(r=>r.itemId===script.source!.id&&r.variant.id===oldId)?.variant;
    if(!previous)throw new Error('Missing previous script');
    const old=scriptData(previous.text),current=scriptData(script.variant.text);
    const global=(data:any)=>Object.fromEntries(Object.entries(data).filter(([key])=>key!=='shots'));
    if(stable(global(old))!==stable(global(current)))return 'Изменились общие указания подробного сценария. Проверьте кадр отдельно.';
    const oldPlans=old.shots.filter((s:any)=>s.title===item.sourceShot!.title);
    const newPlans=current.shots.filter((s:any)=>s.title===item.sourceShot!.title);
    if(oldPlans.length!==1||newPlans.length!==1)throw new Error('Ambiguous plan');
    if(stable(oldPlans[0])!==stable(newPlans[0]))
      return 'План изменился в сценарии: действие, камера, речь, длительность или монтаж. Проверьте кадр отдельно.';
    return '';
  } catch {
    return 'Не удалось надёжно сравнить прежний и текущий план. Проверьте кадр отдельно.';
  }
}

export function unchangedStoryboardBatch(p:Project) {
  return p.items.filter(i=>i.stage===5&&participates(p,i)&&!isApproved(p,i)&&chosen(i)?.deps!==dependencies(p,5))
    .map(i=>({itemId:i.id,variantId:chosen(i)?.id,title:i.title,reason:unchangedReason(p,i)}));
}

export function reapproveUnchangedStoryboard(p:Project,selections:{itemId:string;variantId:string}[]) {
  if(!selections.length||new Set(selections.map(s=>s.itemId)).size!==selections.length)
    throw new Error('Нет карточек для утверждения или карточки повторяются.');
  const rows=unchangedStoryboardBatch(p);
  for(const s of selections) {
    const row=rows.find(r=>r.itemId===s.itemId&&r.variantId===s.variantId);
    if(!row)throw new Error('Выбор изменился. Обновите проект перед утверждением.');
    if(row.reason)throw new Error(`${row.title}: ${row.reason}`);
  }
  const copy=structuredClone(p);
  for(const s of selections)reapproveStoryboard(copy,s.itemId,s.variantId);
  for(const s of selections)Object.assign(getItem(p,s.itemId),getItem(copy,s.itemId));
}
