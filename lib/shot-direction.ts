import { z } from 'zod';
import {stagingModeSchema,STAGING_MODE_LABELS} from './staging-policy';
import {facialExpressionSchema,FACIAL_EXPRESSION_LABELS} from './facial-expression';

const idSchema = z.string().trim().min(1).max(100);
const note = z.string().max(3000);
const nonempty = z.string().trim().min(1).max(3000);
const second = z.number().finite().min(0).max(60);
export const FRAMINGS = ['extreme-wide', 'wide', 'medium', 'close-up', 'extreme-close-up', 'detail'] as const;
export const FRAMING_NAMES: Record<typeof FRAMINGS[number], string> = {
  'extreme-wide': 'Дальний', wide: 'Общий', medium: 'Средний', 'close-up': 'Крупный',
  'extreme-close-up': 'Очень крупный', detail: 'Деталь',
};

/** Optional as a whole on both DirectingShot and a flat ScriptPlan. No legacy defaults. */
export const shotDirectionSchema = z.object({
  facialExpression: facialExpressionSchema.optional(),
  stagingMode: stagingModeSchema.optional(),
  requiresEndFrame: z.boolean().optional(),
  framingStart: z.enum(FRAMINGS).optional(),
  framingEnd: z.enum(FRAMINGS).optional(),
  angle: z.object({
    type: z.enum(['eye-level', 'low', 'high', 'overhead', 'dutch', 'point-of-view', 'custom']),
    description: note.optional(),
  }).strict().optional(),
  composition: note.optional(),
  attention: z.object({ start: note, end: note }).strict().optional(),
  cameraMovement: z.object({
    type: z.enum(['static', 'pan', 'tilt', 'push-in', 'pull-out', 'dolly', 'tracking', 'orbit', 'handheld', 'crane', 'zoom', 'custom']),
    description: note, from: note.optional(), to: note.optional(),
  }).strict().optional(),
  actionBeats: z.array(z.object({
    id: idSchema.optional(), start: second, end: second, action: nonempty, emotionalChange: note.optional(),
  }).strict()).max(30).optional(),
  timing: z.object({ openingHold: second.optional(), endingHold: second.optional(), revealAt: second.optional() }).strict().optional(),
  positions: z.array(z.object({
    subject: z.string().trim().min(1).max(100), subjectId: idSchema.optional(), start: note, end: note,
    screenDirection: z.enum(['left-to-right', 'right-to-left', 'toward-camera', 'away-from-camera', 'static', 'custom']).optional(),
  }).strict()).max(30).optional(),
  performance: z.array(z.object({
    characterId: idSchema.optional(), character: z.string().trim().min(1).max(100),
    objective: note, subtext: note, visibleAction: note, emotionStart: note, emotionEnd: note,
  }).strict()).max(20).optional(),
  transition: z.object({
    type: z.enum(['cut', 'match-cut', 'dissolve', 'fade', 'black', 'custom']),
    description: note, toShotId: idSchema.optional(),
  }).strict().optional(),
  sound: z.object({
    ambience: note.optional(), effects: z.array(z.object({ at: second, description: nonempty }).strict()).max(30).optional(),
    music: note.optional(), silence: z.boolean().optional(),
  }).strict().optional(),
  // Visual descriptions of the two moments. The narrative states remain stateIn/stateOut.
  startFrame: note.optional(), endFrame: note.optional(),
}).strict();
export type ShotDirection = z.infer<typeof shotDirectionSchema>;
/** Agent suggestions may develop staging but cannot replace a director's
 * explicit acting preference. Manual shot edits deliberately bypass this. */
export function preserveShotFacialExpression(next:ShotDirection|undefined,previous:ShotDirection|undefined):ShotDirection|undefined {
  if(!next&&!previous?.facialExpression&&!previous?.stagingMode)return undefined;
  const {facialExpression,stagingMode,...direction}=next??{};
  return {...direction,...(previous?.facialExpression!==undefined?{facialExpression:previous.facialExpression}:{}),...(previous?.stagingMode!==undefined?{stagingMode:previous.stagingMode}:{})};
}
export type MontageShot = { id: string; duration: number; direction?: ShotDirection };
export type ScenePlan = { id: string; shots: MontageShot[] };
export type DirectionIssue = {
  severity: 'note' | 'conflict'; code: string; message: string; shotId?: string; field?: string;
};

export function readableShotDirection(d?:ShotDirection):string {
  if(!d)return '';
  return [
    d.stagingMode!==undefined?`Постановка: ${STAGING_MODE_LABELS[d.stagingMode]}`:'',
    d.requiresEndFrame!==undefined?`Точная конечная композиция: ${d.requiresEndFrame?'нужен конечный кадр':'достаточно описания'}`:'',
    d.facialExpression!==undefined?`Мимика: ${FACIAL_EXPRESSION_LABELS[d.facialExpression]}`:'',
    d.framingStart||d.framingEnd?`Крупность: ${d.framingStart?FRAMING_NAMES[d.framingStart]:'не задана'} → ${d.framingEnd?FRAMING_NAMES[d.framingEnd]:'не задана'}`:'',
    d.startFrame?`Начальный ключевой кадр: ${d.startFrame}`:'',d.endFrame?`Конечный ключевой кадр: ${d.endFrame}`:'',
    d.angle?`Ракурс: ${d.angle.type}${d.angle.description?' · '+d.angle.description:''}`:'',d.composition?`Композиция: ${d.composition}`:'',
    d.attention?`Внимание: ${d.attention.start} → ${d.attention.end}`:'',
    d.cameraMovement?`Движение камеры: ${d.cameraMovement.type} · ${d.cameraMovement.description}${d.cameraMovement.from?' · от '+d.cameraMovement.from:''}${d.cameraMovement.to?' · к '+d.cameraMovement.to:''}`:'',
    ...(d.actionBeats??[]).map(b=>`Действие ${b.start}–${b.end} сек: ${b.action}${b.emotionalChange?' · '+b.emotionalChange:''}`),
    d.timing?.openingHold!==undefined?`Начальная пауза: ${d.timing.openingHold} сек`:'',d.timing?.endingHold!==undefined?`Конечная пауза: ${d.timing.endingHold} сек`:'',d.timing?.revealAt!==undefined?`Раскрытие: ${d.timing.revealAt} сек`:'',
    ...(d.positions??[]).map(v=>`${v.subject}: ${v.start} → ${v.end}${v.screenDirection?' · '+v.screenDirection:''}`),
    d.transition?`Склейка: ${d.transition.type} · ${d.transition.description}${d.transition.toShotId?' · к '+d.transition.toShotId:''}`:'',
    d.sound?.ambience?`Звуковая атмосфера: ${d.sound.ambience}`:'',d.sound?.music?`Музыка: ${d.sound.music}`:'',d.sound?.silence===true?'Намеренная тишина':'',
    ...(d.sound?.effects??[]).map(v=>`Звук на ${v.at} сек: ${v.description}`),
    ...(d.performance??[]).map(v=>`Актёрская задача · ${v.character}: цель ${v.objective}; подтекст ${v.subtext}; действие ${v.visibleAction}; ${v.emotionStart} → ${v.emotionEnd}`),
  ].filter(Boolean).join('\n');
}

export function validateShotDirection(shot: MontageShot): DirectionIssue[] {
  const issues: DirectionIssue[] = [];
  const add = (code: string, message: string, field: string, severity: DirectionIssue['severity'] = 'conflict') =>
    issues.push({ severity, code, message, shotId: shot.id, field });
  if (!Number.isFinite(shot.duration) || shot.duration < .5 || shot.duration > 60) {
    add('duration', 'Длительность плана должна быть от 0,5 до 60 секунд.', 'duration'); return issues;
  }
  if (shot.direction === undefined) return issues;
  const parsed = shotDirectionSchema.safeParse(shot.direction);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add('direction_schema', `Некорректная постановка: ${issue.message}`, `direction.${issue.path.join('.')}`);
    return issues;
  }
  const d = parsed.data;
  const seen = new Set<string>();
  let previousStart = -1;
  for (const [n, beat] of (d.actionBeats ?? []).entries()) {
    const field = `direction.actionBeats.${n}`;
    if (beat.end <= beat.start) add('beat_order', 'Окончание действия должно быть позже начала.', field);
    if (beat.end > shot.duration || beat.start > shot.duration) add('beat_fit', 'Действие выходит за длительность плана.', field);
    if (beat.start < previousStart) add('beat_sequence', 'Действия должны идти в порядке времени начала.', field);
    previousStart = beat.start;
    if (beat.id && seen.has(beat.id)) add('beat_id', 'Повторяется ID действия.', field);
    if (beat.id) seen.add(beat.id);
  }
  if ((d.timing?.openingHold ?? 0) + (d.timing?.endingHold ?? 0) > shot.duration)
    add('holds_fit', 'Начальная и конечная паузы не помещаются в план.', 'direction.timing');
  if (d.timing?.revealAt !== undefined && d.timing.revealAt > shot.duration)
    add('reveal_fit', 'Момент раскрытия выходит за длительность плана.', 'direction.timing.revealAt');
  for (const [n, effect] of (d.sound?.effects ?? []).entries())
    if (effect.at > shot.duration) add('sound_fit', 'Звуковой эффект выходит за длительность плана.', `direction.sound.effects.${n}`);
  const subjects = new Set<string>();
  for (const [n, position] of (d.positions ?? []).entries()) {
    const key = position.subjectId ?? position.subject;
    if (subjects.has(key)) add('position_subject', 'Для героя или предмета заданы повторные положения.', `direction.positions.${n}`);
    subjects.add(key);
  }
  if (!d.framingStart) add('framing_start', 'Уточните начальную крупность.', 'direction.framingStart', 'note');
  if (!d.framingEnd) add('framing_end', 'Уточните конечную крупность.', 'direction.framingEnd', 'note');
  if (!d.endFrame?.trim()) add('end_frame', 'Опишите конечный ключевой кадр.', 'direction.endFrame', 'note');
  return issues;
}

export function validateScenePlan(scene: ScenePlan, nextShotId?: string): DirectionIssue[] {
  const issues: DirectionIssue[] = [], ids = new Set<string>();
  if (!idSchema.safeParse(scene.id).success) issues.push({ severity: 'conflict', code: 'scene_id', message: 'Не указан корректный ID сцены.' });
  if (scene.shots.length > 40) issues.push({ severity: 'conflict', code: 'shot_count', message: 'В одной сцене максимум 40 планов.' });
  for (const [n, shot] of scene.shots.entries()) {
    if (!idSchema.safeParse(shot.id).success || ids.has(shot.id))
      issues.push({ severity: 'conflict', code: 'shot_id', message: 'ID планов должны быть заполнены и не повторяться.', shotId: shot.id });
    ids.add(shot.id); issues.push(...validateShotDirection(shot));
    const to = shot.direction?.transition?.toShotId, actualNext = scene.shots[n + 1]?.id ?? nextShotId;
    if (to && to !== actualNext) issues.push({ severity: 'note', code: 'transition_target', shotId: shot.id,
      field: 'direction.transition.toShotId', message: 'Порядок изменился: проверьте переход к следующему плану.' });
  }
  return issues;
}

const DERIVED_FIELDS = new Set(['approved', 'approvedFoundation', 'approvalVersion', 'imagePrompt', 'videoPrompt', 'promptBasis']);
function content(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(content);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !DERIVED_FIELDS.has(key)).map(([key, item]) => [key, content(item)]));
  return value;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function basis(value: unknown): string {
  let a = 2166136261, b = 5381;
  const text = stable(content(value));
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code; }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
export const shotContentBasis = (shot: MontageShot): string => basis(shot);
export const scenePlanBasis = (scene: ScenePlan): string => basis(scene);

const common = { id: idSchema, sceneId: idSchema, basis: z.string().min(1).max(200), reason: nonempty, issueId: idSchema.optional() };
const afterShot = z.object({ id: idSchema, duration: z.number().finite().min(.5).max(60), direction: shotDirectionSchema.optional() }).passthrough();
export const montageOperationSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('duration'), shotId: idSchema, before: z.number().finite().min(.5).max(60), after: z.number().finite().min(.5).max(60) }).strict(),
  z.object({ ...common, type: z.literal('remove'), shotId: idSchema, before: z.string().min(1).max(200) }).strict(),
  z.object({ ...common, type: z.literal('reorder'), before: z.array(idSchema).max(40), after: z.array(idSchema).max(40) }).strict(),
  z.object({ ...common, type: z.literal('merge'), shotIds: z.array(idSchema).min(2).max(40), keepShotId: idSchema,
    before: z.array(z.object({ shotId: idSchema, basis: z.string().min(1).max(200) }).strict()).min(2).max(40), after: afterShot }).strict(),
]);
export type MontageOperation = z.infer<typeof montageOperationSchema>;
export type MontageChange<T extends MontageShot> = { operationId: string; type: MontageOperation['type']; reason: string; before: T[]; after: T[] };
export type MontageOptions<T extends MontageShot> = { validateShot?: (value: unknown) => T; nextShotId?: string };
export type MontageResult<S extends ScenePlan> = {
  scene: S; changes: MontageChange<S['shots'][number]>[]; removedShots: S['shots'][number][];
  affectedShotIds: string[]; basisBefore: string; basisAfter: string; issues: DirectionIssue[];
};

/** Explicit application only: full preflight, immutable clone, and an audit trace for caller history. */
export function applyMontageOperations<S extends ScenePlan>(scene: S, values: readonly unknown[], options: MontageOptions<S['shots'][number]> = {}): MontageResult<S> {
  type Shot = S['shots'][number];
  const operations = z.array(montageOperationSchema).min(1).max(40).parse(values);
  const initialBasis = scenePlanBasis(scene), initial = new Map(scene.shots.map(shot => [shot.id, shot]));
  if (validateScenePlan(scene).some(issue => issue.code === 'shot_id' || issue.code === 'scene_id' || issue.code === 'shot_count'))
    throw Error('Сначала исправьте ID или количество планов сцены.');
  const operationIds = new Set<string>(), touched = new Set<string>();
  const prepared = new Map<string, Shot>();
  const reorder = operations.filter(op => op.type === 'reorder');
  if (reorder.length > 1 || reorder.length && operations.some(op => op.type === 'remove' || op.type === 'merge'))
    throw Error('Перестановку и изменение состава планов применяйте отдельными проверенными пакетами.');
  const requireShot = (id: string) => { const shot = initial.get(id); if (!shot) throw Error('План больше не существует.'); return shot; };
  // All proposals refer to one initial scene; later operations cannot conceal a stale before.
  for (const op of operations) {
    if (operationIds.has(op.id)) throw Error('Повторяется ID монтажного решения.');
    operationIds.add(op.id);
    if (op.sceneId !== scene.id) throw Error('Монтажное решение относится к другой сцене.');
    if (op.basis !== initialBasis) throw Error('Сцена изменилась после предложения редактора. Проверьте решение заново.');
    if (op.type === 'reorder') {
      if (stable(op.before) !== stable(scene.shots.map(shot => shot.id))) throw Error('Исходный порядок планов уже изменился.');
      if (new Set(op.after).size !== op.after.length || op.after.length !== scene.shots.length || op.after.some(id => !initial.has(id)))
        throw Error('Новый порядок должен содержать каждый существующий план ровно один раз.');
      if (stable(op.before) === stable(op.after)) throw Error('Выбран прежний порядок: изменений нет.');
      continue;
    }
    const shotIds = op.type === 'merge' ? op.shotIds : [op.shotId];
    if (new Set(shotIds).size !== shotIds.length) throw Error('Повторяются планы в монтажном решении.');
    for (const id of shotIds) { requireShot(id); if (touched.has(id)) throw Error('Выбранные монтажные решения меняют один и тот же план.'); touched.add(id); }
    if (op.type === 'duration') {
      if (requireShot(op.shotId).duration !== op.before) throw Error('Длительность плана уже изменилась.');
      if (op.after === op.before) throw Error('Выбрана прежняя длительность: изменений нет.');
    } else if (op.type === 'remove') {
      if (shotContentBasis(requireShot(op.shotId)) !== op.before) throw Error('Удаляемый план уже изменился.');
    } else {
      const at = scene.shots.findIndex(shot => shot.id === op.shotIds[0]);
      if (op.shotIds.some((id, n) => scene.shots[at + n]?.id !== id)) throw Error('Объединять можно только соседние планы в их текущем порядке.');
      if (!op.shotIds.includes(op.keepShotId) || op.after.id !== op.keepShotId) throw Error('Объединённый план должен сохранять выбранный существующий ID.');
      if (op.before.length !== op.shotIds.length || new Set(op.before.map(s => s.shotId)).size !== op.before.length ||
        op.before.some(s => !op.shotIds.includes(s.shotId) || shotContentBasis(requireShot(s.shotId)) !== s.basis))
        throw Error('Содержимое объединяемых планов уже изменилось.');
      const candidate = structuredClone(content(op.after)) as Shot;
      const direction=preserveShotFacialExpression(candidate.direction,requireShot(op.keepShotId).direction);
      if(direction)candidate.direction=direction;else delete candidate.direction;
      // Without an application validator, a generic caller must supply a complete replacement.
      if (!options.validateShot && Object.keys(content(requireShot(op.keepShotId)) as object).some(key =>
        (candidate as Record<string, unknown>)[key] === undefined)) throw Error('Для объединения нужен полный новый план, а не отдельные поля.');
      const after = options.validateShot ? options.validateShot(candidate) : candidate as Shot;
      if (after.id !== op.keepShotId || after.duration !== op.after.duration) throw Error('Проверка изменила выбранный ID или длительность объединённого плана.');
      prepared.set(op.id, structuredClone(content(after)) as Shot);
    }
  }
  const copy = structuredClone(scene), changes: MontageChange<Shot>[] = [], removedShots: Shot[] = [];
  const affected = new Set<string>();
  for (const op of operations) {
    const current = () => copy.shots.find(shot => shot.id === (op.type === 'duration' || op.type === 'remove' ? op.shotId : ''))! as Shot;
    if (op.type === 'duration') {
      const before = structuredClone(current()), after = { ...content(before) as Shot, duration: op.after };
      const validated = options.validateShot ? options.validateShot(after) : after;
      if (validated.id !== op.shotId || validated.duration !== op.after) throw Error('Проверка изменила выбранный ID или длительность.');
      const applied = structuredClone(content(validated)) as Shot;
      copy.shots[copy.shots.findIndex(shot => shot.id === op.shotId)] = applied;
      changes.push({ operationId: op.id, type: op.type, reason: op.reason, before: [before], after: [structuredClone(applied)] });
      affected.add(op.shotId);
    } else if (op.type === 'remove') {
      const before = structuredClone(current()); copy.shots = copy.shots.filter(shot => shot.id !== op.shotId);
      removedShots.push(before); affected.add(op.shotId);
      changes.push({ operationId: op.id, type: op.type, reason: op.reason, before: [before], after: [] });
    } else if (op.type === 'merge') {
      const at = copy.shots.findIndex(shot => shot.id === op.shotIds[0]), before = structuredClone(copy.shots.slice(at, at + op.shotIds.length)) as Shot[];
      const after = prepared.get(op.id)!;
      copy.shots.splice(at, op.shotIds.length, after);
      removedShots.push(...before.filter(shot => shot.id !== op.keepShotId));
      for (const id of op.shotIds) affected.add(id);
      changes.push({ operationId: op.id, type: op.type, reason: op.reason, before, after: [structuredClone(after)] });
    } else {
      const before = structuredClone(copy.shots) as Shot[], map = new Map(copy.shots.map(shot => [shot.id, shot]));
      copy.shots = op.after.map(id => map.get(id)!);
      for (const shot of copy.shots) affected.add(shot.id);
      changes.push({ operationId: op.id, type: op.type, reason: op.reason, before, after: structuredClone(copy.shots) as Shot[] });
    }
  }
  const issues = validateScenePlan(copy, options.nextShotId);
  const conflicts = issues.filter(issue => issue.severity === 'conflict');
  if (conflicts.length) throw Error(conflicts[0].message);
  return { scene: copy, changes, removedShots, affectedShotIds: [...affected], basisBefore: initialBasis, basisAfter: scenePlanBasis(copy), issues };
}
