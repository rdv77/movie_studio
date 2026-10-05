'use client';

import { useMemo } from 'react';
import type { Item, Project } from '@/lib/domain';
import {promptUnit} from '@/lib/model-capabilities';
import { model } from '@/lib/models';
import { compilePrompt, type PromptInput } from '@/lib/prompt-compiler';

export type PromptPreviewProps = {
  project: Project;
  item: Item;
  modelIds: readonly string[];
  input: PromptInput;
};
const roles = { 'first-frame': 'Первый кадр', 'last-frame': 'Конечный кадр', character: 'Герой', location: 'Локация', style: 'Стиль', reference: 'Прообраз' };
const reasons = { budget: 'Не помещается', irrelevant: 'Не относится к плану', hidden: 'Удалён или скрыт', unsupported: 'Не поддерживается моделью', duplicate: 'Повтор' };

/** Viewing is pure: the exact same compiler is used by API admission, without provider calls. */
export function PromptPreview({ project, item, modelIds, input }: PromptPreviewProps) {
  const rows = useMemo(() => [...new Set(modelIds)].map(id => {
    try { return { id, name: model(id).name, result: compilePrompt(project, item, id, { ...input, allowLegacyModel: input.allowLegacyModel ?? !project.directing }) }; }
    catch (error) { return { id, name: (() => { try { return model(id).name; } catch { return id; } })(), error: error instanceof Error ? error.message : 'Не удалось подготовить промпт.' }; }
  }), [project, item, modelIds, input]);
  if (!rows.length) return null;
  return <section className="space-y-3" aria-label="Промпты выбранных моделей">
    {rows.map(row => <details key={row.id} className="rounded-lg border border-border bg-muted/20 p-3" open={!!row.error}>
      <summary className="cursor-pointer text-sm font-medium">
        {row.name}{row.result ? ` · ${row.result.budget.unit==='tokens'?'≤ '+row.result.budget.used:row.result.budget.used??row.result.budget.compiledCharacters} / ${row.result.budget.limit} ${promptUnit(row.result.budget.unit)}${row.result.budget.unit==='tokens'?' (верхняя оценка)':''} · ${row.result.references.length} изображений` : ' · требуется исправление'}
      </summary>
      {row.error ? <p role="alert" className="mt-3 text-sm text-destructive">{row.error}</p> : row.result && <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">Обязательные детали: {row.result.budget.criticalCharacters} символов. Лимит: {row.result.budget.source}.</p>
        {row.result.warnings.map(warning => <p key={warning} className="text-amber-600 dark:text-amber-400">{warning}</p>)}
        {!!row.result.references.length && <ul className="space-y-1">{row.result.references.map(ref => <li key={ref.assetId}>{roles[ref.role]}: {ref.label ?? ref.assetId}</li>)}</ul>}
        {!!row.result.compression.omitted.length && <details>
          <summary className="cursor-pointer">Что исключено · {row.result.compression.omitted.length}</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">{row.result.compression.omitted.map((entry, n) => <li key={`${entry.key}.${n}`}>{entry.label}: {reasons[entry.reason]}{entry.characters ? ` · ${entry.characters} символов` : ''}</li>)}</ul>
        </details>}
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-xs">{row.result.prompt}</pre>
      </div>}
    </details>)}
  </section>;
}
