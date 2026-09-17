import { STAGES, chosen, dependencies, approvalCurrent, variantCurrent, participates, silentFilm, type Project } from './domain';

export type ApprovalBlocker = { itemId?: string; stage: number; title: string; reason: string };

export function approvalBlockers(p: Project, stage: number): ApprovalBlocker[] {
  const result: ApprovalBlocker[] = [];
  if (stage > 6 && p.speechMode === 'plans' && !p.items.some(i => i.stage === 6 && i.sourceShot && participates(p,i)) && !silentFilm(p)) {
    result.push({ stage: 6, title: 'Озвучка по планам', reason: 'Карточки реплик ещё не подготовлены. Откройте «Голоса» и нажмите «Подготовить озвучку по планам».' });
  }
  for (const item of p.items.filter(i => i.stage < stage && participates(p, i))) {
    const approved = item.variants.find(v => v.id === item.approvedId);
    const selected = chosen(item);
    const current = dependencies(p, item.stage);
    if (approvalCurrent(p,item)) continue;
    let reason: string;
    if (!approved) {
      reason = !item.variants.length ? 'В карточке нет вариантов. Подготовьте материал и утвердите его.'
        : !selected ? 'Варианты есть, но ни один не выбран. Выберите нужный и нажмите «Утвердить вариант».'
        : !variantCurrent(p,item,selected) ? item.stage===4 ? 'Проверьте выбранный сценарий и нажмите «Утвердить сценарий для текущей версии».' : item.stage===6 ? 'Выбранная запись относится к прежней основе. Прослушайте её и нажмите «Утвердить эту запись для текущей версии», если она подходит.' : item.stage===2 ? 'Выбранный стиль относится к прежней основе. Проверьте его и нажмите «Утвердить стиль для текущей версии».' : 'Выбранный вариант относится к прежней основе. Проверьте материал; если он подходит, через «Правки» сохраните актуальную версию и утвердите её.'
        : item.stage === 6 && selected.kind === 'video' ? 'Выбран аниматик. Для сборки фильма выберите и утвердите аудиозапись в этой карточке.'
        : 'Вариант выбран, но не утверждён. Нажмите «Утвердить вариант» в этой карточке.';
    } else {
      const changes: string[] = [];
      try {
        const before = JSON.parse(approved.deps), after = JSON.parse(current);
        if (!Array.isArray(before) || !Array.isArray(after)) throw new Error();
        if (before[0] !== after[0]) changes.push('настройки фильма');
        const old = new Map(before.slice(1)), next = new Map(after.slice(1));
        for (const id of new Set([...old.keys(), ...next.keys()])) {
          if (old.has(id) === next.has(id) && old.get(id) === next.get(id)) continue;
          const source = p.items.find(i => i.id === id);
          changes.push(source ? `${STAGES[source.stage]}: ${source.title}` : 'состав материалов предыдущих этапов');
        }
      } catch { /* Older snapshots may not have a readable dependency list. */ }
      reason = 'Прежнее утверждение требует пересмотра.' + (changes.length ? ' Изменились: ' + [...new Set(changes)].join('; ') + '.' : ' Основа этого варианта изменилась.');
      if (selected && selected.id !== approved.id && selected.deps === current) {
        reason += ' Новый актуальный вариант уже выбран — откройте карточку и утвердите его.';
      } else if (approved.lipsync && p.items.find(i => i.id === approved.lipsync!.audioItemId)?.approvedId !== approved.lipsync.audioVariantId) {
        reason += ' Для новой реплики повторите синхронизацию губ: старый ролик связан с прежним голосом.';
      } else {
        reason += item.stage === 4 ? ' Проверьте выбранный сценарий и нажмите «Утвердить сценарий для текущей версии».' : item.stage === 7 ? ' Откройте карточку, выберите подходящий ролик и нажмите «Утвердить этот ролик для текущей версии».' : item.stage===6 ? ' Откройте карточку, прослушайте запись и нажмите «Утвердить эту запись для текущей версии», если она подходит.' : item.stage===2 ? ' Откройте стиль, проверьте его и нажмите «Утвердить стиль для текущей версии».' : ' Откройте карточку и проверьте вариант. Если файл подходит, через «Правки» сохраните актуальную версию и утвердите её.';
      }
    }
    result.push({ itemId: item.id, stage: item.stage, title: item.title, reason });
  }
  return result.sort((a, b) => a.stage - b.stage);
}
