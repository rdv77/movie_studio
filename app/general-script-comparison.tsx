'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isApproved, type Project } from '@/lib/domain';
import { MODELS } from '@/lib/models';
import { scriptVariantLabel } from '@/lib/script-labels';
import { VersionComparison, type ComparisonVersion } from './version-comparison';

export type GeneralScriptComparisonProps = {
  p: Project;
  busy: boolean;
  onChoose: (itemId: string, variantId: string) => Promise<void>;
};

/** Viewing any pair is local; only the explicit choice button updates a script item. */
export function GeneralScriptComparison({ p, busy, onChoose }: GeneralScriptComparisonProps) {
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const items = p.items.filter(item => item.stage === 0 && !item.removedAt && !item.planArchive);
  const sources = new Map(p.items.flatMap(item => item.variants).map(variant => [variant.id, variant]));
  const entries = items.flatMap(item => {
    const approvalCurrent = isApproved(p, item);
    return item.variants.filter(variant => variant.kind === 'text').map(variant => {
      const selected = item.selectedId === variant.id;
      const approved = item.approvedId === variant.id && approvalCurrent;
      const staleApproval = item.approvedId === variant.id && !approvalCurrent;
      const date = new Date(variant.created);
      const created = Number.isNaN(date.getTime()) ? variant.created : date.toLocaleString('ru-RU');
      const description = scriptVariantLabel(p, variant);
      const parent = sources.get(variant.versionInfo?.parentVariantId ?? '');
      const status = [selected && '✓ Выбран', approved && '✓ Утверждён', staleApproval && 'Утверждение требует пересмотра'].filter(Boolean).join(' · ');
      const version: ComparisonVersion = {
        // Include the owner so independent script cards cannot share a comparison identity.
        id: JSON.stringify([item.id, variant.id]),
        label: [items.length > 1 && item.title, description, !description.includes(created) && created, status].filter(Boolean).join(' · '),
        text: variant.text,
        metadata: {
          created: variant.created,
          origin: variant.versionInfo?.reason || (variant.versionInfo?.parentVariantId
            ? `На основе: ${parent?.title ?? 'предыдущая версия'}`
            : variant.jobId ? 'Создано с ИИ' : 'Исходный или добавленный вручную сценарий'),
          model: MODELS.find(model => model.id === variant.model)?.name || variant.model || 'Без модели',
        },
      };
      return { item, variant, version, selected, approved, staleApproval };
    });
  });
  const left = entries.find(entry => entry.selected) ?? entries.find(entry => entry.approved) ?? entries[0];
  const right = [...entries].reverse().find(entry => entry.version.id !== left?.version.id) ?? left;
  const choose = async (entry: typeof entries[number]) => {
    if (busy || pending.current || entry.selected) return;
    pending.current = true;
    setChoosing(true);
    setError('');
    try { await onChoose(entry.item.id, entry.variant.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выбрать вариант. Попробуйте ещё раз.'); }
    finally { pending.current = false; setChoosing(false); }
  };

  return <div className="editor-surface space-y-3 p-4" data-testid="general-script-comparison">
    {entries.length === 1 && <p className="text-sm text-muted-foreground">Пока сохранён один вариант: он показан с обеих сторон. После добавления новой версии её можно выбрать в любом списке.</p>}
    <VersionComparison key={p.id} title="Сравнение общего сценария"
      versions={entries.map(entry => entry.version)} initialLeftId={left?.version.id} initialRightId={right?.version.id}
      initialMode="full" allowFullText disabled={busy || choosing}
      renderActions={version => {
        const entry = entries.find(candidate => candidate.version.id === version.id);
        if (!entry) return null;
        return <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={entry.selected ? 'secondary' : 'outline'}
            disabled={busy || choosing || entry.selected} onClick={() => void choose(entry)}>
            {entry.selected ? '✓ Выбран для проекта' : 'Выбрать для проекта'}
          </Button>
          {entry.approved && <span className="status-pill approved">✓ Утверждён</span>}
          {entry.staleApproval && <span className="text-xs text-muted-foreground">Утверждение требует пересмотра</span>}
        </div>;
      }}/>
    {!!error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
