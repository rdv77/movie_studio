import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('work/tests', { recursive: true });
await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export * from './lib/version-comparison';
    export { VersionComparison } from './app/version-comparison';
  ` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/version-comparison.mjs',
  external: ['react', 'react-dom'],
});
const C = await import('../work/tests/version-comparison.mjs');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

function reconstruct(result, side) {
  return C.mergeParagraphs(result.rows, C.choicesForSide(result.rows, side));
}
const left = 'Начало.\n\nСтарый поворот.\n\nФинал.';
const right = 'Начало.\n\nНовый поворот.\n\nФинал.\n\nПослесловие.';
const diff = C.compareParagraphs(left, right);
assert.equal(diff.coarse, false);
assert.deepEqual(diff.rows.map(row => row.kind), ['equal', 'changed', 'equal', 'added']);
assert.equal(reconstruct(diff, 'left'), left);
assert.equal(reconstruct(diff, 'right'), right);
assert.equal(C.mergeParagraphs(diff.rows, ['both', 'right', 'none', 'right']), 'Начало.\n\nНовый поворот.\n\nПослесловие.');
assert.equal(C.mergeParagraphs([{ kind: 'changed', left: 'А', right: 'Б' }], ['both']), 'А\n\nБ');
assert.equal(C.mergeParagraphs(diff.rows, []), '');
assert.equal(C.toggleMergeSide('left', 'right'), 'both');
assert.equal(C.toggleMergeSide('both', 'left'), 'right');
assert.equal(C.toggleMergeSide('right', 'right'), 'none');
assert.equal(C.toggleMergeSide('none', 'left'), 'left');
assert.deepEqual(C.compareParagraphs('', '').rows, []);
assert.equal(reconstruct(C.compareParagraphs('', right), 'right'), right);
assert.equal(reconstruct(C.compareParagraphs(left, ''), 'left'), left);
assert.equal(reconstruct(C.compareParagraphs('А\r\n\r\nБ', 'А\n\nБ'), 'left'), 'А\n\nБ');

// Repeated paragraphs and moved material retain each source's exact normalized order.
for (const [a, b] of [
  ['А\n\nБ\n\nА\n\nВ', 'Б\n\nА\n\nВ\n\nА'],
  ['А\n\nБ\n\nВ', 'В\n\nБ\n\nА'],
  ['А', 'Б'], ['А\n\nА', 'А'],
]) {
  const result = C.compareParagraphs(a, b);
  assert.equal(reconstruct(result, 'left'), a);
  assert.equal(reconstruct(result, 'right'), b);
}
const manyLeft = Array.from({ length: 600 }, (_, i) => `Старый абзац ${i}`).join('\n\n');
const manyRight = Array.from({ length: 610 }, (_, i) => `Новый абзац ${i}`).join('\n\n');
const bounded = C.compareParagraphs(manyLeft, manyRight);
assert.equal(bounded.coarse, true);
assert(bounded.rows.length <= C.MAX_COMPARISON_PARAGRAPHS);
assert.equal(reconstruct(bounded, 'left'), manyLeft);
assert.equal(reconstruct(bounded, 'right'), manyRight);
const enormous = 'Ж'.repeat(C.MAX_COMPARISON_CHARACTERS + 1);
const coarse = C.compareParagraphs(enormous, 'Короткий вариант');
assert.equal(coarse.coarse, true);
assert.equal(coarse.rows.length, 1);
assert.equal(reconstruct(coarse, 'left'), enormous);
const cellBound = C.compareParagraphs(Array.from({length: 200}, (_, i) => `А${i}`).join('\n\n'), Array.from({length: 200}, (_, i) => `Б${i}`).join('\n\n'));
assert.equal(cellBound.coarse, true, 'Matrix allocation must obey its cell bound, not only paragraph bound');

const versions = Object.freeze([
  Object.freeze({ id: 'a', label: 'До', text: left, metadata: Object.freeze({ origin: 'Исходный сценарий', model: 'Модель А', created: 'bad-date', settings: Object.freeze({ Жанр: 'Сказка', Драматизм: 0, Проверка: false }), actualCost: '$0.08', estimatedCost: '$0.10' }) }),
  Object.freeze({ id: 'b', label: 'После', text: right }),
  Object.freeze({ id: 'c', label: 'Альтернатива', text: '<script>это текст</script>', selectable: false }),
]);
assert.equal(C.comparisonPair(versions, 'a', 'c').right.id, 'c');
assert.equal(C.comparisonPair(versions, 'c', 'b').left.id, 'c');
assert.deepEqual(C.comparisonPair(versions, 'b', 'b'), { left: versions[1], right: versions[1] });
assert.deepEqual(C.comparisonPair(versions, 'deleted', 'deleted'), { left: versions[0], right: versions[1] });
assert.deepEqual(C.comparisonPair([], 'deleted', 'deleted'), { left: undefined, right: undefined });
assert.equal(C.comparisonPair([versions[0]]).right.id, 'a');
assert.equal(C.comparisonKey(versions[0], versions[1]), C.comparisonKey(versions[0], versions[1]));
assert.notEqual(C.comparisonKey(versions[0], versions[1]), C.comparisonKey({ ...versions[0], text: 'Новая редакция' }, versions[1]));
assert.notEqual(C.comparisonKey(versions[0], versions[1]), C.comparisonKey(versions[1], versions[0]));
const metadata = C.comparisonMetadata(versions[0]);
assert(metadata.some(row => row.label === 'Фактическая стоимость' && row.value === '$0.08'));
assert(metadata.some(row => row.label === 'Оценка стоимости' && row.value === '$0.10'));
assert(metadata.some(row => row.label === 'Драматизм' && row.value === '0'));
assert(metadata.some(row => row.label === 'Проверка' && row.value === 'false'));
assert(metadata.some(row => row.label === 'Создано' && row.value === 'bad-date'));
assert.deepEqual(C.comparisonMetadata(versions[1]), []);

let choices = 0, merges = 0, providerCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = () => { providerCalls++; throw Error('No provider calls in comparison'); };
try {
  const props = { versions, initialLeftId: 'b', initialRightId: 'c', selectedId: 'b', onChoose: () => choices++, onMerge: () => merges++ };
  const before = JSON.stringify(versions);
  const html = renderToStaticMarkup(createElement(C.VersionComparison, props));
  assert.equal((html.match(/<select /g) ?? []).length, 2);
  assert(html.includes('value="b" selected=""') && html.includes('value="c" selected=""'), 'Both display selectors use their independent initial values');
  assert(html.includes('✓ Выбран для проекта'));
  assert(html.includes('Добавить как новый вариант'));
  assert(html.includes('&lt;script&gt;это текст&lt;/script&gt;'));
  assert(!html.includes('<script>это текст</script>'));
  const readonly = renderToStaticMarkup(createElement(C.VersionComparison, { versions }));
  assert(!readonly.includes('Добавить как новый вариант'));
  assert(!readonly.includes('Выбрать для проекта'));
  assert(readonly.includes('Фактическая стоимость') && readonly.includes('Оценка стоимости'));
  const empty = renderToStaticMarkup(createElement(C.VersionComparison, { versions: [] }));
  assert(empty.includes('Пока нет версий для сравнения'));
  assert.equal(JSON.stringify(versions), before, 'Viewing comparison must not mutate its inputs');
  assert.equal(choices, 0, 'Callbacks only run after explicit actions, never rendering');
  assert.equal(merges, 0);
  assert.equal(providerCalls, 0);
} finally { globalThis.fetch = previousFetch; }
console.log('PASS version comparison: bounded paragraph diff, independent selectors, lossless merge, metadata, read-only rendering; no provider requests');
