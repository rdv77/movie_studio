/** Read-only comparison data. Costs are display strings supplied by the caller. */
export type ComparisonVersion = {
  id: string;
  label: string;
  text: string;
  selectable?: boolean;
  metadata?: {
    origin?: string;
    model?: string;
    created?: string;
    settings?: Readonly<Record<string, unknown>>;
    actualCost?: string;
    estimatedCost?: string;
  };
};

export type ComparisonRow = {
  kind: 'equal' | 'changed' | 'removed' | 'added';
  left?: string;
  right?: string;
};
export type ParagraphComparison = { rows: ComparisonRow[]; coarse: boolean };
export type MergeChoice = 'left' | 'right' | 'both' | 'none';
export type ComparisonMerge = { text: string; sourceIds: [string, string] };

export const MAX_COMPARISON_PARAGRAPHS = 200;
export const MAX_COMPARISON_CELLS = 40_000;
export const MAX_COMPARISON_CHARACTERS = 160_000;

export function comparisonParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  return normalized ? normalized.split(/\n[\t ]*\n+/).map(p => p.trim()).filter(Boolean) : [];
}

function comparisonRow(left?: string, right?: string): ComparisonRow {
  return { kind: left === undefined ? 'added' : right === undefined ? 'removed' : left === right ? 'equal' : 'changed',
    ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) };
}

/** Paragraph LCS has a fixed work bound. Large inputs retain all text in coarse rows. */
export function compareParagraphs(leftText: string, rightText: string): ParagraphComparison {
  if (leftText.length + rightText.length > MAX_COMPARISON_CHARACTERS) {
    const left = leftText.trim(), right = rightText.trim();
    return { rows: left || right ? [comparisonRow(left || undefined, right || undefined)] : [], coarse: true };
  }
  const left = comparisonParagraphs(leftText), right = comparisonParagraphs(rightText);
  if (left.length > MAX_COMPARISON_PARAGRAPHS || right.length > MAX_COMPARISON_PARAGRAPHS ||
    (left.length + 1) * (right.length + 1) > MAX_COMPARISON_CELLS) {
    return { rows: Array.from({ length: Math.max(left.length, right.length) }, (_, i) => comparisonRow(left[i], right[i]))
      .slice(0, MAX_COMPARISON_PARAGRAPHS - 1).concat(
        Math.max(left.length, right.length) >= MAX_COMPARISON_PARAGRAPHS
          ? [comparisonRow(left.slice(MAX_COMPARISON_PARAGRAPHS - 1).join('\n\n') || undefined,
            right.slice(MAX_COMPARISON_PARAGRAPHS - 1).join('\n\n') || undefined)] : []), coarse: true };
  }
  const width = right.length + 1, lcs = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    lcs[i * width + j] = left[i] === right[j] ? 1 + lcs[(i + 1) * width + j + 1]
      : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  }
  const rows: ComparisonRow[] = [], removed: string[] = [], added: string[] = [];
  const flush = () => {
    for (let n = 0; n < Math.max(removed.length, added.length); n++) rows.push(comparisonRow(removed[n], added[n]));
    removed.length = 0; added.length = 0;
  };
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      flush(); rows.push(comparisonRow(left[i++], right[j++]));
    } else if (i < left.length && (j === right.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      removed.push(left[i++]);
    } else { added.push(right[j++]); }
  }
  flush();
  return { rows, coarse: false };
}

/** A disappeared version gets a safe display fallback; this never changes project selection. */
export function comparisonPair(versions: readonly ComparisonVersion[], leftId?: string, rightId?: string) {
  const left = versions.find(v => v.id === leftId) ?? versions[0];
  const right = versions.find(v => v.id === rightId) ?? versions.find(v => v.id !== left?.id) ?? left;
  return { left, right };
}

export function choicesForSide(rows: readonly ComparisonRow[], side: 'left' | 'right'): MergeChoice[] {
  return rows.map(row => row[side] === undefined ? 'none' : side);
}

export function mergeParagraphs(rows: readonly ComparisonRow[], choices: readonly MergeChoice[]): string {
  const paragraphs: string[] = [];
  rows.forEach((row, i) => {
    const choice = choices[i] ?? 'none';
    if ((choice === 'left' || choice === 'both') && row.left !== undefined) paragraphs.push(row.left);
    if ((choice === 'right' || choice === 'both') && row.right !== undefined &&
      !(choice === 'both' && row.left === row.right)) paragraphs.push(row.right);
  });
  return paragraphs.join('\n\n');
}

export function toggleMergeSide(choice: MergeChoice, side: 'left' | 'right'): MergeChoice {
  if (choice === 'both') return side === 'left' ? 'right' : 'left';
  if (choice === side) return 'none';
  return choice === 'none' ? side : 'both';
}

/** Reset only local comparison drafts when the viewed source content changes. */
export function comparisonKey(left: ComparisonVersion, right: ComparisonVersion): string {
  let hash = 2166136261;
  for (const text of [left.text, right.text]) {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 0, 16777619);
  }
  return JSON.stringify([left.id, right.id, hash >>> 0]);
}

export function comparisonMetadata(version: ComparisonVersion): { label: string; value: string }[] {
  const m = version.metadata;
  if (!m) return [];
  const rows: { label: string; value: string }[] = [];
  if (m.origin) rows.push({ label: 'Источник', value: m.origin });
  if (m.model) rows.push({ label: 'Модель', value: m.model });
  if (m.created) {
    const date = new Date(m.created);
    rows.push({ label: 'Создано', value: Number.isNaN(date.getTime()) ? m.created : date.toLocaleString('ru-RU') });
  }
  for (const [label, value] of Object.entries(m.settings ?? {})) {
    if (value === undefined) continue;
    let text: string;
    try { text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value); }
    catch { text = String(value); }
    rows.push({ label, value: text.length > 500 ? text.slice(0, 499) + '…' : text });
  }
  if (m.actualCost) rows.push({ label: 'Фактическая стоимость', value: m.actualCost });
  if (m.estimatedCost) rows.push({ label: 'Оценка стоимости', value: m.estimatedCost });
  return rows;
}
