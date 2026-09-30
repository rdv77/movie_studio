import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('work/tests', { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), contents: `export * from './lib/shot-direction';` }, bundle: true,
  platform: 'node', format: 'esm', outfile: 'work/tests/shot-direction.mjs' });
const S = await import('../work/tests/shot-direction.mjs');
const direction = {
  framingStart: 'wide', framingEnd: 'close-up', angle: { type: 'eye-level' }, composition: 'Герой справа; слева открывается дверь',
  attention: { start: 'Дверь', end: 'Реакция героя' }, cameraMovement: { type: 'push-in', description: 'Плавный наезд к реакции' },
  actionBeats: [{ id: 'b1', start: 0, end: 2, action: 'Герой замечает свет' }, { id: 'b2', start: 2, end: 4, action: 'Переводит взгляд', emotionalChange: 'Тревога сменяется любопытством' }],
  timing: { openingHold: .5, endingHold: 1, revealAt: 2 },
  positions: [{ subject: 'Герой', subjectId: 'hero', start: 'У двери', end: 'У двери', screenDirection: 'static' }],
  performance: [{ characterId: 'hero', character: 'Герой', objective: 'Понять источник света', subtext: 'Страшно, но любопытно', visibleAction: 'Сжимает руку и поднимает взгляд', emotionStart: 'Страх', emotionEnd: 'Любопытство' }],
  transition: { type: 'match-cut', description: 'По направлению взгляда', toShotId: 's2' },
  sound: { ambience: 'Тихий ветер', effects: [{ at: 2, description: 'Скрип двери' }], music: 'Одна нота флейты' },
  startFrame: 'Общий: герой у двери', endFrame: 'Крупный: реакция героя; дверь вне кадра',
};
assert.deepEqual(S.shotDirectionSchema.parse(direction), direction);
assert.equal(S.shotDirectionSchema.safeParse({ framingStart: 'bad' }).success, false);
assert.equal(S.shotDirectionSchema.safeParse({ unexpected: true }).success, false);
assert.equal(S.shotDirectionSchema.safeParse({ actionBeats: [{ start: NaN, end: 1, action: 'Действие' }] }).success, false);
assert.deepEqual(S.validateShotDirection({ id: 'legacy', duration: 5 }), [], 'Legacy absent direction has no fabricated defaults or new blocking issues');
assert.equal(S.validateShotDirection({ id: 's1', duration: 5, direction }).length, 0);
for (const [bad, code] of [
  [{ ...direction, actionBeats: [{ start: 2, end: 1, action: 'Действие' }] }, 'beat_order'],
  [{ ...direction, actionBeats: [{ start: 0, end: 6, action: 'Действие' }] }, 'beat_fit'],
  [{ ...direction, timing: { openingHold: 4, endingHold: 2 } }, 'holds_fit'],
  [{ ...direction, sound: { effects: [{ at: 6, description: 'Звук' }] } }, 'sound_fit'],
  [{ ...direction, positions: [{ subject: 'А', start: '', end: '' }, { subject: 'А', start: '', end: '' }] }, 'position_subject'],
]) assert(S.validateShotDirection({ id: 's1', duration: 5, direction: bad }).some(issue => issue.severity === 'conflict' && issue.code === code));

const scene = { id: 'scene', title: 'Свет', shots: [
  { id: 's1', title: 'Дверь', duration: 5, story: 'Первое действие', direction, approved: 'old', imagePrompt: 'old prompt' },
  { id: 's2', title: 'Реакция', duration: 3, story: 'Второе действие', approved: 'keep' },
  { id: 's3', title: 'Уход', duration: 4, story: 'Третье действие' },
] };
const original = structuredClone(scene), before = S.scenePlanBasis(scene);
const common = { id: 'op1', sceneId: 'scene', basis: before, reason: 'Дать реакции время' };
const duration = { ...common, type: 'duration', shotId: 's2', before: 3, after: 4 };
const longer = S.applyMontageOperations(scene, [duration]);
assert.equal(longer.scene.shots[1].duration, 4); assert.equal(longer.scene.shots[1].id, 's2');
assert.equal(longer.scene.shots[1].approved, undefined, 'Changed content loses derived approval');
assert.equal(longer.scene.shots[0].approved, 'old', 'Unchanged materials retain their approval');
assert.deepEqual(scene, original, 'Pure operations never mutate their input');
assert.equal(longer.changes[0].before[0].duration, 3); assert.equal(longer.changes[0].after[0].duration, 4);
assert.notEqual(longer.basisBefore, longer.basisAfter);
assert.throws(() => S.applyMontageOperations(longer.scene, [duration]), /изменилась/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...duration, before: 2 }]), /Длительность/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...duration, after: 3 }]), /изменений нет/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...duration, sceneId: 'other' }]), /другой сцене/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...duration, basis: 'old' }]), /изменилась/);
assert.throws(() => S.applyMontageOperations(scene, [duration, duration]), /Повторяется ID/);
assert.throws(() => S.applyMontageOperations(scene, [duration, { ...duration, id: 'op2' }]), /один и тот же/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...duration, after: .1 }]), /./);

const reordered = S.applyMontageOperations(scene, [{ ...common, type: 'reorder', before: ['s1', 's2', 's3'], after: ['s3', 's1', 's2'] }, { ...duration, id: 'op2' }]);
assert.deepEqual(reordered.scene.shots.map(s => s.id), ['s3', 's1', 's2']);
assert.equal(reordered.scene.shots[2].duration, 4);
assert.equal(reordered.scene.shots[1].direction.endFrame, direction.endFrame);
assert.throws(() => S.applyMontageOperations(scene, [{ ...common, type: 'reorder', before: ['s1', 's3', 's2'], after: ['s3', 's1', 's2'] }]), /Исходный порядок/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...common, type: 'reorder', before: ['s1', 's2', 's3'], after: ['s1', 's1', 's3'] }]), /ровно один раз/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...common, type: 'reorder', before: ['s1', 's2', 's3'], after: ['s1', 'foreign', 's3'] }]), /ровно один раз/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...common, type: 'reorder', before: ['s1', 's2', 's3'], after: ['s1', 's2', 's3'] }]), /изменений нет/);

const remove = { ...common, type: 'remove', shotId: 's2', before: S.shotContentBasis(scene.shots[1]) };
const removed = S.applyMontageOperations(scene, [remove]);
assert.deepEqual(removed.scene.shots.map(s => s.id), ['s1', 's3']);
assert.deepEqual(removed.removedShots, [scene.shots[1]]);
assert(removed.issues.some(issue => issue.code === 'transition_target'), 'Broken transitions are surfaced for review');
assert.throws(() => S.applyMontageOperations(scene, [{ ...remove, before: 'outdated' }]), /Удаляемый план/);
assert.throws(() => S.applyMontageOperations(scene, [duration, { ...remove, id: 'op2', shotId: 's3', before: 'outdated' }]), /Удаляемый план/);
assert.deepEqual(scene, original, 'A late invalid before rejects the entire package before source state changes');
const mergedShot = { ...scene.shots[0], title: 'Дверь и реакция', duration: 8, story: 'Единое действие и реакция', direction: { ...direction, transition: { type: 'cut', description: 'На уход', toShotId: 's3' } } };
const merge = { ...common, type: 'merge', shotIds: ['s1', 's2'], keepShotId: 's1',
  before: scene.shots.slice(0, 2).map(s => ({ shotId: s.id, basis: S.shotContentBasis(s) })), after: mergedShot };
const merged = S.applyMontageOperations(scene, [merge]);
assert.deepEqual(merged.scene.shots.map(s => s.id), ['s1', 's3']);
assert.equal(merged.scene.shots[0].story, mergedShot.story);
assert.equal(merged.scene.shots[0].duration, 8);
assert.equal(merged.scene.shots[0].approved, undefined); assert.equal(merged.scene.shots[0].imagePrompt, undefined);
assert.deepEqual(merged.removedShots, [scene.shots[1]]);
assert.deepEqual(merged.changes[0].before, scene.shots.slice(0, 2));
assert.deepEqual(merged.affectedShotIds, ['s1', 's2']);
assert.throws(() => S.applyMontageOperations(scene, [{ ...merge, shotIds: ['s1', 's3'] }]), /соседние планы/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...merge, after: { ...mergedShot, id: 'new' } }]), /существующий ID/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...merge, before: [{ shotId: 's1', basis: 'wrong' }, merge.before[1]] }]), /Содержимое/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...merge, after: { id: 's1', duration: 8 } }]), /полный новый план/);
assert.throws(() => S.applyMontageOperations(scene, [duration, { ...remove, id: 'op2' }]), /один и тот же/);

// Full application validators can enforce dialogue, cast, states and other required production data.
assert.throws(() => S.applyMontageOperations(scene, [merge], { validateShot() { throw Error('Реплика не помещается'); } }), /Реплика/);
assert.throws(() => S.applyMontageOperations(scene, [merge], { validateShot(s) { return { ...s, duration: 9 }; } }), /Проверка изменила/);
assert.throws(() => S.applyMontageOperations(scene, [duration], { validateShot(s) { return { ...s, id: 'another' }; } }), /Проверка изменила/);
assert.throws(() => S.applyMontageOperations(scene, [{ ...common, type: 'duration', shotId: 's1', before: 5, after: 2 }]), /Действие выходит/);
assert.deepEqual(scene, original, 'Rejected packages must also leave source state untouched');
assert.equal(S.scenePlanBasis(scene), S.scenePlanBasis({ ...scene, shots: scene.shots.map(s => ({ ...s, approved: 'new', approvedFoundation: 'new', imagePrompt: 'new', promptBasis: 'new' })) }), 'Approvals and compiled prompts do not change editorial content basis');
assert.notEqual(S.scenePlanBasis(scene), S.scenePlanBasis({ ...scene, title: 'Другая сцена' }));
assert.notEqual(S.shotContentBasis(scene.shots[0]), S.shotContentBasis({ ...scene.shots[0], direction: { ...direction, framingEnd: 'detail' } }));
assert.notEqual(S.shotContentBasis({ id: 'emoji', duration: 1, story: '🙂' }), S.shotContentBasis({ id: 'emoji', duration: 1, story: '🙃' }), 'Content signatures must include both UTF-16 code units');
assert(S.validateScenePlan({ ...scene, shots: [scene.shots[0], scene.shots[0]] }).some(i => i.code === 'shot_id'));
console.log('PASS shot direction: legacy schema, framing/motion/end frame, timed actions, immutable explicit montage with stable IDs, before/basis conflicts and history trace');
