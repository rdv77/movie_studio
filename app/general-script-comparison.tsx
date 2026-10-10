'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isApproved, type Project } from '@/lib/domain';
import { MODELS } from '@/lib/models';
import { scriptVariantLabel } from '@/lib/script-labels';
import { isScriptWorkflowRun, scriptTaskChain, scriptWorkflowResultSchema } from '@/lib/script-workflow';
import { VersionComparison, type ComparisonVersion } from './version-comparison';
import {generalScriptSource} from '@/lib/general-script-source';
import {stageEditing} from '@/lib/stage-review-state';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';

export type GeneralScriptTarget =
  | { kind: 'variant'; itemId: string; variantId: string }
  | { kind: 'cinema'; runId: string }
  | { kind: 'specialist'; runId: string; taskId: string };
export type GeneralScriptAction = 'choose' | 'approve' | 'edit' | 'rename' | 'delete' | 'restore';
export type GeneralScriptActionData = { title?: string; text?: string };
export type GeneralScriptComparisonProps = {
  p: Project;
  busy: boolean;
  onChoose?: (itemId: string, variantId: string) => Promise<void>;
  onAction?: (action: GeneralScriptAction, target: GeneralScriptTarget, data?: GeneralScriptActionData) => Promise<void>;
  onContinue?: () => void;
  focusVariantId?: string;
  onRework?:()=>Promise<void>;
};
export type GeneralScriptEntry = {
  target: GeneralScriptTarget; version: ComparisonVersion; title: string;
  selected: boolean; approved: boolean; staleApproval: boolean;
  changes: string[]; prompt?: string; provenance: unknown;
  findings: {severity: 'note' | 'conflict'; evidence: string; proposal: string}[];
  reviewWarnings: string[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const changesIn = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const timestamp = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('ru-RU');
const modelName = (value: string) => MODELS.find(model => model.id === value)?.name || value || 'Без модели';

/** Include legacy results without importing or writing merely by opening this page. */
export function generalScriptEntries(p: Project): GeneralScriptEntry[] {
  const items = p.items.filter(item => item.stage === 0 && !item.removedAt && !item.planArchive);
  const sources = new Map(p.items.flatMap(item => item.variants).map(variant => [variant.id, variant]));
  const entries: GeneralScriptEntry[] = items.flatMap(item => {
    const current = isApproved(p, item)&&!stageEditing(p,0);
    return item.variants.filter(variant => variant.kind === 'text').map(variant => {
      const selected = item.selectedId === variant.id, approved = item.approvedId === variant.id && current;
      const staleApproval = item.approvedId === variant.id && !current;
      const created = timestamp(variant.created), description = scriptVariantLabel(p, variant);
      const parent = sources.get(variant.versionInfo?.parentVariantId ?? '');
      const status = [selected && '✓ Выбран', approved && '✓ Утверждён', staleApproval && 'Утверждение требует пересмотра'].filter(Boolean).join(' · ');
      const settings = record(variant.versionInfo?.settings);
      const review = settings.manualEdit ? undefined : scriptWorkflowResultSchema.safeParse(settings.review);
      const findings = review?.success ? review.data.findings : [];
      const reviewWarnings = settings.manualEdit || findings.length ? [] : p.generalScenario?.runs.find(run => run.id === settings.generalScenarioRunId)?.reviewWarnings ?? [];
      return {
        target: { kind: 'variant' as const, itemId: item.id, variantId: variant.id },
        title: variant.title, selected, approved, staleApproval, changes: changesIn(settings.changes), findings, reviewWarnings,
        prompt: p.jobs.find(job => job.id === variant.jobId)?.prompt, provenance: variant.versionInfo,
        version: {
          id: JSON.stringify([item.id, variant.id]),
          label: [items.length > 1 && item.title, description, !description.includes(created) && created, status].filter(Boolean).join(' · '), text: variant.text,
          metadata: { created: variant.created,
            origin: variant.versionInfo?.reason || (variant.versionInfo?.parentVariantId ? `На основе: ${parent?.title ?? 'предыдущая версия'}` : variant.jobId ? 'Создано с ИИ' : 'Исходный или добавленный вручную сценарий'),
            model: modelName(variant.model) },
        },
      };
    });
  });
  // Imported, and subsequently deleted, candidates must not return as virtual drafts.
  const imported = (field: 'runId' | 'cinemaReferenceRunId', runId: string, taskId?: string) =>
    [...p.items.flatMap(item => item.variants), ...(p.removedVariants ?? []).map(entry => entry.variant)].some(variant => {
      const settings = record(variant.versionInfo?.settings);
      return settings[field] === runId && (!taskId || settings.taskId === taskId);
    });
  for (const run of p.cinemaReferences?.runs ?? []) {
    const draft = run.result?.draft;
    if (run.scope.kind !== 'script' || !draft?.text.trim() || run.importedVariantId || imported('cinemaReferenceRunId', run.id) || !items.some(item => item.id === run.input.sourceItemId)) continue;
    entries.push({
      target: { kind: 'cinema', runId: run.id }, title: draft.title, selected: false, approved: false, staleApproval: false,
      changes: draft.changes, findings: [], reviewWarnings: [], prompt: p.jobs.find(job => job.id === run.jobId)?.prompt,
      provenance: { source: run.input.sourceTitle, sourceVariantId: run.input.sourceVariantId, runId: run.id, candidateIds: draft.candidateIds },
      version: { id: JSON.stringify(['cinema', run.id]), label: `Кинореференсы · ${draft.title} · ${timestamp(run.created)}`, text: draft.text,
        metadata: { created: run.created, origin: `Кинореференсы · на основе: ${run.input.sourceTitle}`, model: modelName(run.model) } },
    });
  }
  for (const run of p.directing?.runs ?? []) {
    if (!isScriptWorkflowRun(run) || !items.some(item => item.id === run.scriptInput.itemId)) continue;
    for (const task of run.tasks) {
      if (!task.applied || task.error || task.importedVariantId || imported('runId', run.id, task.id) || task.role === 'script-critic' || task.role === 'script-control') continue;
      const parsed = scriptWorkflowResultSchema.safeParse(task.result);
      if (!parsed.success) continue;
      const result = parsed.data, chain = scriptTaskChain(p, run, task.id), job = p.jobs.find(job => job.id === task.jobId);
      entries.push({
        target: { kind: 'specialist', runId: run.id, taskId: task.id }, title: result.title, selected: false, approved: false, staleApproval: false,
        changes: result.changes, findings: result.findings, reviewWarnings: [], prompt: job?.prompt,
        provenance: { source: run.scriptInput.sourceTitle, sourceVariantId: run.scriptInput.sourceVariantId, chain, runId: run.id, taskId: task.id, findings: result.findings },
        version: { id: JSON.stringify(['specialist', run.id, task.id]), label: `${chain} · ${result.title} · ${timestamp(job?.created ?? run.created)}`, text: result.text,
          metadata: { created: job?.created ?? run.created, origin: `${chain} · на основе: ${run.scriptInput.sourceTitle}`, model: modelName(run.model) } },
      });
    }
  }
  return entries.sort((a, b) => (Date.parse(a.version.metadata?.created ?? '') || 0) - (Date.parse(b.version.metadata?.created ?? '') || 0));
}

/** Viewing a pair stays local; choosing and approving are separate explicit actions. */
export function GeneralScriptComparison({ p, busy, onChoose, onAction, onContinue, focusVariantId,onRework }: GeneralScriptComparisonProps) {
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  const [modal, setModal] = useState<{ action: 'edit' | 'rename' | 'details'; entry: GeneralScriptEntry }>();
  const [title, setTitle] = useState(''), [text, setText] = useState('');
  const pending = useRef(false), entries = generalScriptEntries(p);
  const source=generalScriptSource(p),editing=stageEditing(p,0);
  const left = entries.find(entry=>entry.target.kind==='variant'&&entry.target.itemId===source?.item.id&&entry.target.variantId===source.variant.id)??entries[0];
  const focused = entries.find(entry => entry.version.id === focusVariantId || (entry.target.kind === 'variant' && entry.target.variantId === focusVariantId));
  const right = focused&&focused!==left?focused:[...entries].reverse().find(entry => entry.version.id !== left?.version.id) ?? left;
  const approved = entries.filter(entry => entry.approved);
  const deleted = (p.removedVariants ?? []).filter(entry => p.items.some(item => item.id === entry.itemId && item.stage === 0 && !item.removedAt && !item.planArchive) && entry.variant.kind === 'text');
  const locked = busy || working;
  const perform = async (action: GeneralScriptAction, target: GeneralScriptTarget, data?: GeneralScriptActionData) => {
    if (busy || pending.current) return;
    pending.current = true; setWorking(true); setError('');
    try {
      if (onAction) await onAction(action, target, data);
      else if (action === 'choose' && target.kind === 'variant' && onChoose) await onChoose(target.itemId, target.variantId);
      else throw Error('Действие пока недоступно. Обновите страницу и попробуйте ещё раз.');
      setModal(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменение. Попробуйте ещё раз.'); }
    finally { pending.current = false; setWorking(false); }
  };
  const open = async(action: 'edit' | 'rename' | 'details', entry: GeneralScriptEntry) => {
    if(action==='edit'&&!editing&&onRework){setWorking(true);try{await onRework();}catch(e){setError((e as Error).message);return;}finally{setWorking(false);}}
    setModal({ action, entry }); setTitle((entry.title + (action === 'edit' ? ' · правки' : '')).slice(0, 200)); setText(entry.version.text); setError('');
  };
  return <div id="general-script-comparison" className="editor-surface space-y-3 p-4" data-testid="general-script-comparison">
    {entries.length === 1 && <p className="text-sm text-muted-foreground">Пока сохранён один вариант. После доработки новый текст появится справа.</p>}
    <VersionComparison key={p.id + ':' + left?.version.id + ':' + entries.length + ':' + (focusVariantId ?? '')} title="Сравнение общего сценария"
      fixedLeftId={left?.version.id} leftLabel={editing&&source?.item.approvedId?'Предыдущий утверждённый вариант':left?.approved?'Утверждённый вариант':'Исходный текст · ещё не утверждён'} rightLabel={editing?'Альтернативный вариант · на доработке':'Альтернативный вариант'}
      description="Новые генерации используют текст слева. Справа можно выбрать любой сохранённый вариант. После утверждения он станет основным."
      versions={entries.map(entry => entry.version)} initialLeftId={left?.version.id} initialRightId={right?.version.id}
      initialMode="full" allowFullText disabled={locked}
      renderActions={(version,side) => {
        const entry = entries.find(candidate => candidate.version.id === version.id);
        if (!entry) return null;
        const canAct = !!onAction || (!!onChoose && entry.target.kind === 'variant');
        const conflicts = entry.findings.filter(finding => finding.severity === 'conflict').length;
        return <div className="space-y-2">
          {!!entry.changes.length && <p className="text-xs text-muted-foreground line-clamp-3">Что изменено: {entry.changes.join('; ')}</p>}
          {(!!entry.findings.length || !!entry.reviewWarnings.length) && <div className={`rounded border p-3 text-sm ${conflicts ? 'border-destructive/50' : 'border-border'}`} aria-label={`Замечания контроля: ${entry.title}`}>
            <p role="status" className={conflicts ? 'font-medium text-destructive' : 'font-medium'}>{conflicts ? `Контроль сценария: конфликтов — ${conflicts}` : `Контроль сценария: замечаний — ${entry.findings.length + entry.reviewWarnings.length}`}</p>
            <details className="mt-2"><summary className="cursor-pointer">Посмотреть замечания и предлагаемые решения</summary><div className="mt-2 space-y-3">
              {entry.findings.map((finding,index) => <div key={index}><p><strong>{finding.severity === 'conflict' ? 'Конфликт: ' : 'Замечание: '}</strong>{finding.evidence}</p><p><strong>Решение: </strong>{finding.proposal}</p></div>)}
              {entry.reviewWarnings.map((warning,index) => <p key={index}>{warning}</p>)}
            </div></details>
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            {!!onAction&&!entry.approved&&side==='right'&&<Button type="button" size="sm" disabled={locked||!entry.version.text.trim()} onClick={()=>void perform('approve',entry.target)}>Утвердить</Button>}
            {side==='left'&&onRework&&!editing&&<Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>{setWorking(true);void onRework().catch(e=>setError(e.message)).finally(()=>setWorking(false));}}>Доработать</Button>}
            <DropdownMenu><DropdownMenuTrigger aria-label={`Действия с вариантом: ${entry.title}`} disabled={locked} className="rounded border px-3 py-1 text-sm">⋯</DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
                {!!onAction&&<DropdownMenuItem onClick={()=>void open('edit',entry)}>Правки текста</DropdownMenuItem>}
                {!!onAction&&<DropdownMenuItem onClick={()=>void open('rename',entry)}>Переименовать</DropdownMenuItem>}
                <DropdownMenuItem onClick={()=>void open('details',entry)}>Происхождение и промпт</DropdownMenuItem>
                {!!onAction&&entry!==left&&<DropdownMenuItem variant="destructive" onClick={()=>void perform('delete',entry.target)}>Удалить вариант</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {entry.staleApproval && <p className="text-xs text-muted-foreground">{editing?'Утверждение этапа снято. Можно доработать текст или утвердить прежнюю версию без изменений.':'Утверждение требует пересмотра. Проверьте текст и утвердите этот же вариант для текущего фильма.'}</p>}
        </div>;
      }}/>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3" aria-label="Сценарий для дальнейшей работы">
      <p className="text-sm">{approved.length ? <>Утверждён для дальнейшей работы: <strong>{approved.map(entry => entry.title).join('; ')}</strong></> : editing?'На доработке. Утвердите подходящий вариант перед переходом дальше.':'Сценарий ещё не утверждён. Проверьте текст и нажмите «Утвердить».'}</p>
      {!!onContinue && <Button type="button" variant="outline" disabled={locked || !approved.length} onClick={onContinue}>Перейти дальше →</Button>}
    </div>
    {!!deleted.length && !!onAction && <details className="text-sm"><summary className="cursor-pointer">Удалённые сценарии · {deleted.length}</summary><div className="mt-2 space-y-2">{deleted.map(entry => <div className="flex flex-wrap items-center justify-between gap-2" key={entry.itemId + ':' + entry.variant.id}><span>{entry.variant.title} · {timestamp(entry.variant.created)}</span><Button size="sm" type="button" variant="outline" disabled={locked} onClick={() => void perform('restore', { kind: 'variant', itemId: entry.itemId, variantId: entry.variant.id })}>Восстановить</Button></div>)}</div></details>}
    {!!error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={!!modal} onOpenChange={value => !value && !working && setModal(undefined)}><DialogContent className="sm:max-w-3xl modal-scroll"><DialogHeader>
      <DialogTitle>{modal?.action === 'edit' ? 'Правки → новая версия сценария' : modal?.action === 'rename' ? 'Название варианта' : 'Происхождение и фактически отправленный промпт'}</DialogTitle>
      <DialogDescription>{modal?.action === 'edit' ? 'Прежний текст сохранён. Правки создадут альтернативу справа; её нужно будет утвердить.' : modal?.action === 'rename' ? 'Название изменится, текст и утверждение сохранятся.' : modal?.entry.title}</DialogDescription>
    </DialogHeader>
    {modal?.action === 'details' ? <div className="space-y-4">
      <p className="text-sm">{modal.entry.version.metadata?.origin} · {timestamp(modal.entry.version.metadata?.created ?? '')}</p>
      {!!modal.entry.changes.length && <ul className="list-disc space-y-1 pl-5 text-sm">{modal.entry.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
      <details><summary>Сохранённые настройки и происхождение</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{modal.entry.provenance ? JSON.stringify(modal.entry.provenance, null, 2) : 'Подробные сведения об этой версии не сохранены.'}</pre></details>
      <div><h4 className="mb-2 font-medium">Фактически отправленный промпт</h4><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{modal.entry.prompt || 'У этой версии нет сохранённого запроса к модели. Для ручного текста он не создаётся.'}</pre></div>
    </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (modal && modal.action !== 'details' && title.trim() && (modal.action !== 'edit' || text.trim())) void perform(modal.action, modal.entry.target, { title: title.trim(), ...(modal.action === 'edit' ? { text } : {}) }); }}>
      <label className="block space-y-2"><span>Название варианта</span><Input aria-label="Название варианта сценария" value={title} maxLength={200} disabled={locked} onChange={event => setTitle(event.target.value)}/></label>
      {modal?.action === 'edit' && <label className="block space-y-2"><span>Полный текст сценария</span><Textarea aria-label="Полный текст новой версии сценария" rows={16} maxLength={50000} disabled={locked} value={text} onChange={event => setText(event.target.value)}/></label>}
      <Button type="submit" disabled={locked || !title.trim() || (modal?.action === 'edit' && !text.trim())}>{working ? 'Сохраняем…' : modal?.action === 'edit' ? 'Сохранить новую версию' : 'Применить название'}</Button>
      {!!error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>}
    </DialogContent></Dialog>
  </div>;
}
