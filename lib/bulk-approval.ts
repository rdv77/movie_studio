import { approve, chosen, dependencies, variantCurrent, isApproved, participates, stageReady, type Project } from './domain';
import { reapproveSpeech, unchangedSpeechReason } from './speech-approval';

export function approvalBatch(p: Project, stage: number) {
  if (![5, 6, 7].includes(stage)) throw new Error('Массовое утверждение доступно для раскадровки, озвучки и видеопланов.');
  const kind = stage === 5 ? 'image' : stage === 6 ? 'audio' : 'video';
  return p.items.filter(i => i.stage === stage && participates(p, i) && !isApproved(p, i)).map(i => {
    const v = chosen(i);
    const reason = !stageReady(p, stage) ? 'Сначала утвердите предыдущие этапы.'
      : !v ? 'Выберите вариант.'
      : !variantCurrent(p,i,v) ? stage===6 ? unchangedSpeechReason(p,i.id,v.id) : 'Основа изменилась. Сохраните актуальную версию через «Правки» и проверьте её.'
      : v.kind !== kind || !v.assetId ? `Выберите готовый ${stage === 5 ? 'кадр' : stage === 6 ? 'аудиофайл' : 'видеоролик'}.`
      : p.jobs.some(j => j.itemId === i.id && ['queued', 'dispatching', 'pending', 'saving'].includes(j.status)) ? 'Дождитесь завершения генерации.'
      : '';
    return { itemId: i.id, variantId: v?.id, title: i.title, reason };
  });
}

export function approveBatch(p: Project, stage: number, selections: {itemId: string; variantId: string}[]) {
  if (!selections.length || new Set(selections.map(s => s.itemId)).size !== selections.length)
    throw new Error('Нет карточек для утверждения или карточки повторяются.');
  const candidates = approvalBatch(p, stage);
  // Validate the complete selection before mutating any approvals.
  for (const s of selections) {
    const row = candidates.find(r => r.itemId === s.itemId);
    if (!row || row.variantId !== s.variantId) throw new Error('Выбор изменился. Обновите проект перед утверждением.');
    if (row.reason) throw new Error(`${row.title}: ${row.reason}`);
  }
  const copy=structuredClone(p);
  for (const s of selections) {
    const item=copy.items.find(i=>i.id===s.itemId)!;
    if(stage===6&&!variantCurrent(copy,item,chosen(item)!))reapproveSpeech(copy,s.itemId,s.variantId);
    else approve(copy,s.itemId);
  }
  for(const s of selections)Object.assign(p.items.find(i=>i.id===s.itemId)!,copy.items.find(i=>i.id===s.itemId)!);
}
export function changedSpeechSelections(p: Project) {
  return p.items.filter(i => i.stage === 6 && participates(p,i) && i.selectedId !== i.approvedId && chosen(i)?.kind === 'audio');
}
export function approveSelectedSpeech(p: Project, selections: {itemId: string; variantId: string}[]) {
  if (!selections.length || new Set(selections.map(s => s.itemId)).size !== selections.length) throw new Error('Выберите новые голоса.');
  const candidates = changedSpeechSelections(p);
  const copy = structuredClone(p);
  for (const row of selections) {
    const item = candidates.find(i => i.id === row.itemId && i.selectedId === row.variantId);
    if (!item || !chosen(item)?.assetId) throw new Error('Выбор голосов изменился. Обновите проект.');
    if(!variantCurrent(p,item,chosen(item)!))throw new Error(`«${item.title}»: Основа изменилась. Прослушайте запись в карточке и нажмите «Утвердить эту запись для текущей версии».`);
    if (p.jobs.some(j => j.itemId === item.id && ['queued','dispatching','pending','saving'].includes(j.status))) throw new Error('Дождитесь завершения озвучки.');
    approve(copy,item.id);
  }
  for (const row of selections) p.items.find(i => i.id === row.itemId)!.approvedId = row.variantId;
}
