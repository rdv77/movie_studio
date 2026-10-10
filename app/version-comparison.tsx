'use client';

import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  compareParagraphs, comparisonPair, comparisonKey, comparisonMetadata, choicesForSide,
  mergeParagraphs, toggleMergeSide, type ComparisonVersion, type ComparisonMerge,
} from '@/lib/version-comparison';

export type { ComparisonVersion, ComparisonMerge } from '@/lib/version-comparison';
export type VersionComparisonProps = {
  versions: readonly ComparisonVersion[];
  title?: string;
  selectedId?: string;
  approvedId?: string;
  disabled?: boolean;
  initialLeftId?: string;
  initialRightId?: string;
  onChoose?: (version: ComparisonVersion) => void | Promise<void>;
  onMerge?: (result: ComparisonMerge) => void | Promise<void>;
  initialMode?: 'full' | 'diff';
  allowFullText?: boolean;
  fixedLeftId?: string;
  leftLabel?:string;
  rightLabel?:string;
  description?:string;
  renderActions?: (version: ComparisonVersion,side:'left'|'right') => React.ReactNode;
};

/** Changing the viewed pair has no persistence side effects. */
export function VersionComparison(props: VersionComparisonProps) {
  const uid = useId();
  const [leftId, setLeftId] = useState(props.initialLeftId ?? props.versions[0]?.id);
  const [rightId, setRightId] = useState(props.initialRightId ?? props.versions[1]?.id ?? props.versions[0]?.id);
  const { left, right } = comparisonPair(props.versions, props.fixedLeftId??leftId, rightId);
  return <section className="space-y-4" aria-label={props.title ?? 'Сравнение вариантов'}>
    <h3>{props.title ?? 'Сравнение вариантов'}</h3>
    <p className="text-sm text-muted-foreground">{props.description??'Выберите версии для просмотра. Выбор для проекта сохраняется отдельной кнопкой.'}</p>
    {!left || !right ? <p className="text-sm text-muted-foreground">Пока нет версий для сравнения.</p> : <>
      <div className="grid gap-4 md:grid-cols-2">
        {(['left', 'right'] as const).map(side => <label className="block space-y-2" key={side} htmlFor={`${uid}-${side}`}>
          <span className="text-sm font-medium">{side === 'left' ? props.leftLabel??'Левый вариант' : props.rightLabel??'Правый вариант'}</span>
          {side==='left'&&props.fixedLeftId?<div className="rounded border border-primary/40 bg-primary/5 p-2 text-sm break-words">{left.label}</div>:<>
          <select id={`${uid}-${side}`} className="w-full rounded border border-input bg-background p-2 text-sm"
            value={(side === 'left' ? left : right).id}
            onChange={event => (side === 'left' ? setLeftId : setRightId)(event.target.value)}>
            {props.versions.map(version => <option key={version.id} value={version.id}>{version.label}</option>)}
          </select>
          </>}
        </label>)}
      </div>
      <ComparisonContent key={comparisonKey(left, right)} {...props} left={left} right={right}/>
    </>}
  </section>;
}

function ComparisonContent({ left, right, ...props }: VersionComparisonProps & { left: ComparisonVersion; right: ComparisonVersion }) {
  const diff = useMemo(() => compareParagraphs(left.text, right.text), [left.text, right.text]);
  const [choices, setChoices] = useState(() => choicesForSide(diff.rows, 'left'));
  const [draft, setDraft] = useState(() => mergeParagraphs(diff.rows, choices));
  const [operation, setOperation] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode,setMode]=useState(props.initialMode??'diff');
  const locked = props.disabled || operation;
  const perform = async (callback: () => void | Promise<void>, success: string) => {
    setOperation(true); setError(''); setNotice('');
    try { await callback(); setNotice(success); }
    catch (error) { setError(error instanceof Error ? error.message : 'Не удалось сохранить выбор. Попробуйте ещё раз.'); }
    finally { setOperation(false); }
  };
  const useSide = (side: 'left' | 'right') => {
    const next = choicesForSide(diff.rows, side);
    setChoices(next); setDraft(mergeParagraphs(diff.rows, next)); setNotice('');
  };
  const toggle = (index: number, side: 'left' | 'right') => {
    const next = choices.map((value, n) => n === index ? toggleMergeSide(value, side) : value);
    setChoices(next); setDraft(mergeParagraphs(diff.rows, next)); setNotice('');
  };
  return <div className="space-y-4">
    {props.allowFullText&&<div className="flex flex-wrap gap-2" aria-label="Режим сравнения текстов"><Button type="button" size="sm" variant={mode==='full'?'default':'outline'} aria-pressed={mode==='full'} onClick={()=>setMode('full')}>Цельные тексты</Button><Button type="button" size="sm" variant={mode==='diff'?'default':'outline'} aria-pressed={mode==='diff'} onClick={()=>setMode('diff')}>Различия по абзацам</Button></div>}
    {mode==='diff'&&<p className="text-sm text-muted-foreground">{diff.coarse
      ? 'Длинные тексты: укрупнённое сравнение. Всё содержание сохранено.'
      : 'Выделенные абзацы отличаются. Одинаковые показаны без выделения.'}</p>}
    <div className="grid items-start gap-4 md:grid-cols-2">
      {(['left', 'right'] as const).map(side => {
        const version = side === 'left' ? left : right;
        const metadata = comparisonMetadata(version);
        return <article className="min-w-0 space-y-3 rounded border border-border p-3" key={side} aria-label={`${side === 'left' ? 'Левый' : 'Правый'} вариант: ${version.label}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{version.label}</strong>
            <span className="text-xs text-muted-foreground">{props.approvedId === version.id ? '✓ Утверждён' : props.selectedId === version.id ? '✓ Выбран' : ''}</span>
          </div>
          {!!metadata.length && <dl className="space-y-1 text-xs text-muted-foreground">{metadata.map((entry, i) => <div className="break-words" key={i}><dt className="inline font-medium">{entry.label}: </dt><dd className="inline">{entry.value}</dd></div>)}</dl>}
          {!!props.onChoose && <Button type="button" size="sm" variant="outline"
            disabled={locked || version.selectable === false || props.selectedId === version.id}
            onClick={() => perform(() => props.onChoose!(version), 'Вариант выбран.')}>
            {props.selectedId === version.id ? '✓ Выбран для проекта' : 'Выбрать для проекта'}
          </Button>}
          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1" tabIndex={0} aria-label={`Текст: ${version.label}`}>
            {mode==='full'?<p className="whitespace-pre-wrap break-words text-sm">{version.text||'Текст пуст.'}</p>:<>
            {!diff.rows.length && <p className="text-sm text-muted-foreground">Текст пуст.</p>}
            {diff.rows.map((row, index) => {
              const text = row[side], choice = choices[index];
              return <div key={index} className={`rounded border p-3 text-sm ${row.kind === 'equal' ? 'border-transparent' : 'border-primary/40 bg-primary/5'}`}>
                <span className="mb-1 block text-xs text-muted-foreground">{index + 1}. {row.kind === 'equal' ? 'Без изменений' : text === undefined ? 'Нет абзаца' : row.kind === 'changed' ? 'Изменён' : side === 'left' ? 'Только слева' : 'Только справа'}</span>
                {text === undefined ? <p className="text-muted-foreground">—</p> : <p className="whitespace-pre-wrap break-words">{text}</p>}
                {!!props.onMerge && text !== undefined && <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" disabled={locked} checked={choice === side || choice === 'both'} onChange={() => toggle(index, side)}/>
                  В новый вариант
                </label>}
              </div>;
            })}</>}
          </div>
          {props.renderActions?.(version,side)}
        </article>;
      })}
    </div>
    {!!props.onMerge && <div className="space-y-3 rounded border border-border p-3">
      <h4 className="font-medium">Новый вариант из выбранных абзацев</h4>
      <p className="text-xs text-muted-foreground">Отметьте нужные абзацы и проверьте результат. Изменение состава абзацев обновит текст ниже. Исходные версии сохранятся.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => useSide('left')}>Взять весь левый</Button><Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => useSide('right')}>Взять весь правый</Button></div>
      <Textarea aria-label="Текст нового объединённого варианта" rows={8} value={draft} disabled={locked} onChange={event => { setDraft(event.target.value); setNotice(''); }}/>
      <Button type="button" disabled={locked || !draft.trim()} onClick={() => perform(() => props.onMerge!({ text: draft, sourceIds: [left.id, right.id] }), 'Новый вариант добавлен.')}>
        Добавить как новый вариант
      </Button>
    </div>}
    {!!error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!!notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </div>;
}
