import type { CharacterBrief, Item, Project } from './domain';
import { model } from './models';
import { availableForDirecting, promptCapacity } from './model-capabilities';
import { selectedReferences } from './reference-selection';
import { speechDirection, speechInfo, type SpeechType } from './speech-mode';
import { effectiveCreativeBrief, type CreativeOverrides } from './creative-brief';
import { FRAMING_NAMES, shotDirectionSchema, validateShotDirection, type ShotDirection } from './shot-direction';
import { googleSeconds } from './google-models';
import { zenProfile } from './zencreator-models';
import type { ActorProfile, LocationProfile, LocationState } from './world-assets';
import { videoPrompt } from './video';
import { planFields, storyboardPrompt } from './storyboard';
import { supportsEndFrame } from './video-end-frame';
import { VIDEO_DURATION_CONTRACTS, videoRequestTiming } from './video-duration';
import {compactPromptText,preparedPromptBody} from './prompt-text';
import {boundCharacterId,shotBindsCharacter} from './character-bindings';

export const REFERENCE_ROLES = ['first-frame', 'last-frame', 'character', 'location', 'style', 'reference'] as const;
export type ReferenceRole = typeof REFERENCE_ROLES[number];
export type PromptReference = { assetId: string; role?: ReferenceRole; itemId?: string; label?: string };
export type CompiledReference = PromptReference & { role: ReferenceRole };
type Continuity = { character: string; characterId?: string; outfit: string; props: string };
export type PromptPlan = {
  id?: string; sceneId?: string; title: string; duration: number; cast?: string[]; characterIds?: string[]; locationIds?: string[];
  description?: string; story?: string; stateIn?: string; stateOut?: string; camera?: string; cinematography?: string;
  productionDesign?: string; continuity?: string; continuityChanges?: string; direction?: ShotDirection;
  dialogue?: string | { speechType: SpeechType; speaker: string; text: string; delivery: string };
  speechType?: SpeechType; speaker?: string; sceneContinuity?: Continuity[];
  previousChanges?: { id: string; changes: string }[]; locationState?: LocationState;
};
export type PromptCapability = {
  modelId: string; provider: string; kind: 'image' | 'video';
  promptLimit: number; limitSource: string; newDirecting: boolean;
  adapter: { firstFrame: boolean; lastFrame: boolean; requiresFirstFrame: boolean; maxImageReferences: number; maxAdditionalReferences: number; camera: 'text'; nativeAudio: 'possible' | 'none' | 'unknown' };
  upstream: { lastFrame: boolean | 'unknown'; lastFrameField?: string; source?: string; checked?: string };
  duration?: { requestedSeconds: number; planMaxSeconds: number; variableResult: boolean };
};

/** Capabilities of the installed adapters; upstream extensions are never enabled implicitly. */
export function promptModelCapability(modelId: string): PromptCapability {
  const m = model(modelId);
  if (m.kind !== 'image' && m.kind !== 'video' || m.provider === 'sync') throw new PromptCompilationError('model_kind', 'Выберите модель генерации изображения или видеоплана.');
  const cap = promptCapacity(modelId, m.kind);
  const video = m.kind === 'video', maxAdditional = video && m.provider === 'xai' ? 7 : 0, lastFrame = video && supportsEndFrame(modelId);
  const requestedSeconds = googleSeconds(modelId) ?? zenProfile(modelId)?.seconds ?? 6;
  const result: PromptCapability = {
    modelId, provider: m.provider, kind: m.kind, promptLimit: cap.limit, limitSource: cap.source,
    newDirecting: availableForDirecting(modelId) && cap.limit >= 5000,
    adapter: { firstFrame: video, lastFrame, requiresFirstFrame: video,
      maxImageReferences: video ? 1 + Number(lastFrame) + maxAdditional : m.provider === 'xai' ? 5 : 8,
      maxAdditionalReferences: maxAdditional, camera: 'text',
      nativeAudio: !video ? 'none' : modelId === 'fal-wan-2.2-a14b' || modelId === 'MiniMax-Hailuo-2.3' ? 'none'
        : modelId === 'grok-imagine-video-1.5' || modelId === 'MiniMax-H3' || modelId === 'fal-minimax-h3-max' || modelId.startsWith('veo-') ? 'possible' : 'unknown' },
    upstream: { lastFrame: 'unknown' },
    ...(video ? { duration: { requestedSeconds, planMaxSeconds: Object.hasOwn(VIDEO_DURATION_CONTRACTS,modelId)?VIDEO_DURATION_CONTRACTS[modelId].max:requestedSeconds, variableResult: modelId === 'gemini-omni-1.1-flash' } } : {}),
  };
  if (modelId === 'grok-imagine-video-1.5') result.upstream = { lastFrame: true, lastFrameField: 'last_frame', checked: '2026-10-01', source: 'https://docs.x.ai/developers/model-capabilities/video/reference-to-video' };
  if (modelId === 'MiniMax-H3') result.upstream = { lastFrame: true, lastFrameField: 'content[].role=last_frame', checked: '2026-10-01', source: 'https://platform.minimax.io/docs/guides/video-generation' };
  if (modelId === 'fal-minimax-h3-max') result.upstream = { lastFrame: true, lastFrameField: 'end_image_url', checked: '2026-10-01', source: 'https://fal.ai/models/minimax/h3-max/image-to-video/api' };
  return result;
}

export type PromptInput = {
  kind: 'image' | 'video'; keyframe?: 'start' | 'middle' | 'end'; prompt: string; instruction?: string;
  /** Generated role guidance is mandatory, but is not a director's explicit delta. */
  keyframeInstruction?: string;
  references?: readonly (string | PromptReference)[]; startFrameId?: string; endFrameId?: string;
  characterIds?: readonly string[]; duration?: number;
  /** Server-resolved approved plan, not an unchecked client replacement. */
  plan?: PromptPlan;
  /** Verified live catalog maxLength may lower, never raise, the installed budget. */
  providerPromptLimit?: number;
  /** Only for explicit regeneration of an older model; existing jobs are never recompiled. */
  allowLegacyModel?: boolean;
};
export type PromptExclusion = { key: string; label: string; reason: 'budget' | 'irrelevant' | 'hidden' | 'unsupported' | 'duplicate'; characters?: number; assetId?: string };
export type CompiledPrompt = {
  prompt: string; references: CompiledReference[]; criticalText: string; capability: PromptCapability;
  budget: { limit: number; source: string; criticalCharacters: number; originalCharacters: number; compiledCharacters: number; remaining: number };
  compression: { shortened: boolean; omitted: PromptExclusion[]; includedKeys: string[] };
  warnings: string[];
};
export class PromptCompilationError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: { limit?: number; requiredCharacters?: number; sections?: string[] } = {}) {
    super(message); this.name = 'PromptCompilationError';
  }
}
const active = (item: Item) => !item.removedAt && !item.planArchive;
const approved = (item: Item) => item.variants.find(v => v.id === item.approvedId);
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const mentions = (text: string, label: string) => !!normalized(label) && ` ${normalized(text)} `.includes(` ${normalized(label)} `);
const paragraphs = (text: string) => text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/).map(p => p.trim()).filter(Boolean);
type WorldItem = Item & { location?: LocationProfile };
type WorldVariant = NonNullable<ReturnType<typeof approved>> & { location?: LocationProfile };
type ActorCharacter = CharacterBrief & { actorProfile?: ActorProfile };

function resolvePlans(p: Project, item: Item): PromptPlan[] {
  const script = p.items.find(i => i.stage === 4 && active(i) && i.approvedId);
  if (!script || item.sourceShot && item.sourceShot.scriptId !== script.id) return [];
  try {
    const data = JSON.parse((approved(script)?.text ?? '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    const shots: PromptPlan[] = Array.isArray(data.shots) ? data.shots : [];
    // Preserve source IDs and approved shot states; a newer unapproved scene never replaces this snapshot.
    const ranks = new Map((p.storyboardOrder ?? []).flatMap((id, n) => {
      const frame = p.items.find(i => i.id === id && active(i) && !i.excludedAt && i.sourceShot?.scriptId === script.id);
      return frame ? [[frame.sourceShot!.shotId ?? frame.sourceShot!.title, n] as const] : [];
    }));
    return shots.filter(s => typeof s.title === 'string' && !p.items.some(i => i.stage === 5 && i.excludedAt && i.sourceShot?.scriptId === script.id &&
      (i.sourceShot.shotId ? i.sourceShot.shotId === s.id : i.sourceShot.title === s.title)))
      .sort((a, b) => (ranks.get(a.id ?? a.title) ?? Infinity) - (ranks.get(b.id ?? b.title) ?? Infinity));
  } catch { return []; }
}
function belongsToPlan(frame: Item, item: Item, plan: PromptPlan): boolean {
  if (!active(frame) || frame.excludedAt || ![5, 7].includes(frame.stage)) return false;
  if (item.sourceShot?.scriptId && frame.sourceShot?.scriptId !== item.sourceShot.scriptId) return false;
  return frame.id === item.id || !!frame.sourceShot && (plan.id ? frame.sourceShot.shotId === plan.id : frame.sourceShot.title === plan.title);
}
type Section = { key: string; label: string; text: string; priority: number; required: boolean };
const render = (sections: readonly Section[]) => sections.map(s => `${s.label}: ${s.text}`).join('\n\n');

/** Pure, deterministic preflight. Never performs compression calls, reads files, enqueues or mutates. */
export function compilePrompt(p: Project, item: Item, modelId: string, input: PromptInput): CompiledPrompt {
  if (!p.items.some(i => i.id === item.id && active(i)) || item.excludedAt) throw new PromptCompilationError('item_scope', 'Выберите действующую карточку текущего проекта.');
  const capability = promptModelCapability(modelId);
  if (capability.kind !== input.kind) throw new PromptCompilationError('model_kind', 'Тип модели не совпадает с задачей.');
  if (input.providerPromptLimit !== undefined && (!Number.isInteger(input.providerPromptLimit) || input.providerPromptLimit <= 0))
    throw new PromptCompilationError('provider_limit', 'Некорректный лимит из каталога провайдера.');
  const limit = Math.min(capability.promptLimit, input.providerPromptLimit ?? Infinity);
  if ((!capability.newDirecting || limit < 5000) && !input.allowLegacyModel)
    throw new PromptCompilationError('short_model', `Для новой постановки выберите модель с бюджетом не меньше 5000 символов. У этой модели доступно ${limit}. Старые результаты и запросы сохранены.`);
  const plans = resolvePlans(p, item), sourcePlan = input.plan ?? plans.find(s => item.sourceShot?.shotId ? s.id === item.sourceShot.shotId : s.title === (item.sourceShot?.title ?? item.title));
  const value = item.variants.find(v => v.id === item.selectedId);
  const fields = sourcePlan && !input.plan && [5, 7].includes(item.stage) ? planFields(p, item, value) : undefined;
  // The current card may carry reviewed action/camera/speech edits. An automatic
  // wrapper is optional only after its substantive fields have become mandatory.
  const reviewedText = item.stage === 5 && value && !value.planDraft && (value.kind === 'text' || !value.jobId) ? value.text.trim() : '';
  const reviewedWrapped = reviewedText.startsWith('Создай одно цельное изображение — первый кадр плана');
  const reviewedAction = reviewedWrapped ? reviewedText.match(/\n\nДействие: ([\s\S]*?)\nКамера \(покажи начальный ракурс\): /)?.[1]?.trim() ?? reviewedText : reviewedText;
  const footerEnd = reviewedWrapped ? ['не добавляй свою речь, пение или субтитры.', 'Не добавляй голос или субтитры.']
    .map(marker => { const at = reviewedText.lastIndexOf(marker); return at < 0 ? -1 : at + marker.length; }).filter(at => at >= 0).sort((a, b) => b - a)[0] : undefined;
  const reviewedNotes = footerEnd === undefined ? '' : reviewedText.slice(footerEnd).trim();
  const plan = sourcePlan && fields ? { ...sourcePlan, camera: fields.camera, continuity: fields.continuity, duration: fields.duration,
    dialogue: fields.dialogue, speechType: fields.speechType, speaker: fields.speaker,
    ...(reviewedAction ? { description: reviewedAction } : {}) } : sourcePlan;
  if ([5, 7].includes(item.stage) && !plan) throw new PromptCompilationError('missing_plan', 'Не найден план утверждённого подробного сценария. Подготовьте и примените сценарий, затем откройте карточку снова.');
  const scene = p.directing?.scenes.find(s => s.id === plan?.sceneId);
  const direction = plan?.direction ? shotDirectionSchema.parse(plan.direction) : undefined;
  const speech = plan && typeof plan.dialogue === 'object' ? speechInfo({ speechType: plan.dialogue.speechType, speaker: plan.dialogue.speaker, dialogue: plan.dialogue.text })
    : speechInfo({ speechType: plan?.speechType, speaker: plan?.speaker, dialogue: typeof plan?.dialogue === 'string' ? plan.dialogue : '' });
  const duration = input.duration ?? plan?.duration;
  if (input.kind === 'video' && duration !== undefined) {
    const modern = !!(input.endFrameId || item.videoPreparation || input.references?.some(ref => typeof ref !== 'string' && ref.role === 'last-frame'));
    try { const timing=videoRequestTiming(modelId,duration,modern,capability.duration!.requestedSeconds); capability.duration={...capability.duration!,requestedSeconds:timing.requestedSeconds,planMaxSeconds:timing.planMaxSeconds}; }
    catch(e) { throw new PromptCompilationError('duration_fit',(e as Error).message); }
  }
  if (input.kind === 'video' && direction && duration !== undefined) {
    const conflict = validateShotDirection({ id: plan?.id ?? item.id, duration, direction }).find(issue => issue.severity === 'conflict');
    if (conflict) throw new PromptCompilationError('direction_timing', `${conflict.message} Исправьте постановку перед запуском.`);
  }

  const warnings: string[] = [], omitted: PromptExclusion[] = [], sections: Section[] = [];
  const add = (key: string, label: string, text: string | undefined, required: boolean, priority = 0) => {
    if (text?.trim()) sections.push({ key, label, text: /^(?:hero\.|hero-locked\.|continuity\.|location-identity\.|location-layout)/.test(key)?compactPromptText(text):text.trim(), required, priority });
  };
  const optional = (key: string, label: string, text: string | undefined, priority: number) =>
    paragraphs(text ?? '').forEach((text, n) => add(`${key}.${n}`, label, text, false, priority));
  const profiles = p.items.filter(i => i.stage === 1 && active(i) && approved(i)?.character).map(i => {
    const origin = approved(i)!.character as ActorCharacter;
    return { item: i, variant: approved(i)!, profile: { ...origin,
      ...(i.character?.actorProfile ? { description: i.character.description, actorProfile: i.character.actorProfile } : {}),
    } as ActorCharacter };
  });
  const heroes = item.stage === 1 ? profiles.filter(h => h.item.id === item.id) : profiles.filter(h => {
    if (!plan) return false;
    if (shotBindsCharacter(p,plan,h.item.id)) return true;
    if (plan.characterIds !== undefined) return plan.characterIds.includes(h.item.id);
    if (plan.cast !== undefined) return plan.cast.some(name => name === h.item.id || normalized(name) === normalized(h.profile.name));
    return mentions(sourcePlan?.description ?? sourcePlan?.story ?? '', h.profile.name) || speech.speechType === 'character' && normalized(speech.speaker) === normalized(h.profile.name);
  });
  if (item.stage === 1) {
    const draft = item.character ?? item.variants.find(v => v.id === item.selectedId)?.character ?? approved(item)?.character;
    heroes.length = 0;
    if (draft) heroes.push({ item, variant: approved(item) ?? item.variants.find(v => v.id === item.selectedId)!, profile: draft as ActorCharacter });
  }
  if (plan?.characterIds?.some(id => !heroes.some(h => h.item.id === id))) throw new PromptCompilationError('missing_hero', 'В плане указан удалённый или неутверждённый герой. Исправьте ссылки на героев текущего проекта.');
  if(plan?.cast?.some(name=>{const id=boundCharacterId(p,name);return id&&!heroes.some(h=>h.item.id===id);}))throw new PromptCompilationError('missing_hero','Связанный образ героя удалён или не утверждён. Исправьте связь персонажей в раскадровке.');
  if (plan?.characterIds !== undefined && plan.cast?.some(name => profiles.some(h => (name === h.item.id || normalized(name) === normalized(h.profile.name)) && !plan.characterIds!.includes(h.item.id)&&!shotBindsCharacter(p,plan,h.item.id))))
    throw new PromptCompilationError('cast_conflict', 'Имена участников и ссылки на героев в плане противоречат друг другу. Проверьте состав текущего плана.');
  const ids = plan?.locationIds ?? scene?.locationIds;
  const locations = p.items.filter(i => i.stage === 3 && active(i) && (item.stage === 3 ? i.id === item.id : approved(i) && plan && (ids !== undefined ? ids.includes(i.id)
    : normalized(i.title).length >= 4 && mentions([scene?.location, plan.description, plan.story].filter(Boolean).join('\n'), i.title))));
  if (ids?.some(id => !locations.some(location => location.id === id))) throw new PromptCompilationError('missing_location', 'В плане указана удалённая или неутверждённая локация. Выберите локацию текущего проекта.');
  const locationState = plan?.locationState ?? (scene as typeof scene & { locationState?: LocationState })?.locationState;

  const keyframe = input.keyframe ?? 'start';
  add('format', 'Формат', input.kind === 'image' ? `Одно цельное изображение анимационного фильма, ${p.format}. Без текста, коллажа, субтитров и пузырей речи.`
    : `Один непрерывный анимационный видеоплан, ${p.format}. Без дополнительных персонажей, склеек внутри клипа, надписей и субтитров.`, true);
  add('instruction', 'Обязательная задача режиссёра', input.instruction, true);
  add('keyframe-instruction', 'Назначение ключевого кадра', input.keyframeInstruction, true);
  add('card-notes', 'Сохранённые правки к карточке плана', reviewedNotes, true);
  if ([5,7].includes(item.stage) && heroes.length) add('face-identity', 'Узнаваемость лица — обязательное условие',
    `${heroes.map(h=>h.profile.name).join(', ')}: это те же конкретные персонажи из утверждённых образов. Сохраняй форму лица, посадку и расстояние между глазами, брови, нос, губы, линию челюсти, возраст, цвет глаз, волос и кожи, причёску и отличительные признаки по их образцам. Не заменяй лица типовыми, не омолаживай и не приукрашивай. Стиль, свет, эмоция и ракурс не меняют идентичность. Не смешивай лица разных героев. Меняй только позу, выражение и ракурс по постановке; не превращай общий план в портрет ради детализации лица.`, true);
  if (reviewedAction && reviewedAction !== (sourcePlan?.description ?? sourcePlan?.story)?.trim())
    add('card-action', 'Уточнение действия в выбранной карточке — учитывать при выборе единственного момента', reviewedAction, true);
  if (plan) {
    add('plan', 'Текущий план', plan.title, true);
    const visible = heroes.map(h => h.profile.name);
    const cast = (plan.cast ?? (visible.length ? visible : speech.speechType === 'character' ? [speech.speaker] : [])).map(name => heroes.find(h => h.item.id === name||boundCharacterId(p,name)===h.item.id)?.profile.name ?? name);
    const bindings=(plan.cast??[]).flatMap(name=>{const hero=heroes.find(h=>boundCharacterId(p,name)===h.item.id);return hero&&normalized(name)!==normalized(hero.profile.name)?[`${name} — это ${hero.profile.name} из утверждённого образа; один персонаж, не два.`]:[];});
    add('hero-bindings','Соответствие имён сценарию',bindings.join(' '),true);
    add('cast', 'Участники в кадре', cast.length ? `${cast.join(', ')}. Показывай только этих участников; упоминания соседних планов не добавляют героев в кадр.`
      : plan.cast !== undefined || plan.characterIds !== undefined ? 'Персонажей нет. Не добавляй людей или героев.'
      : 'Состав не выделен в старом плане. Показывай только персонажей, непосредственно названных в его описании; не добавляй героев из соседних планов или референсов.', true);
    if (input.kind === 'image') {
      add('moment', 'Единственный момент изображения', keyframe === 'middle' ? 'Один промежуточный момент действия этого плана. Не повторяй начальное или конечное состояние, не показывай несколько фаз одновременно.'
        : keyframe === 'end' ? 'Конец текущего плана после его действий. Не изображай промежуточные фазы одновременно.'
          : 'Самое начало текущего плана до его действий. Не выполняй будущие действия в первом кадре.', true);
      if (keyframe === 'middle') {
        add('state-boundaries', 'Границы действия — не текущее состояние картинки', [plan.stateIn && `Вход: ${plan.stateIn}.`, plan.stateOut && `Выход: ${plan.stateOut}.`, 'Выбери только одну промежуточную фазу согласно назначению ключевого кадра.'].filter(Boolean).join(' '), true);
        add('middle-action', 'Действие, из которого нужен промежуточный момент', plan.description ?? plan.story, true);
      } else {
        add('state', keyframe === 'end' ? 'Состояние к концу' : 'Состояние в начале', keyframe === 'end' ? plan.stateOut : plan.stateIn, true);
        add('keyframe', keyframe === 'end' ? 'Конечный ключевой кадр' : 'Начальный ключевой кадр', keyframe === 'end' ? direction?.endFrame : direction?.startFrame, true);
      }
      if (keyframe === 'end') add('changes', 'Обоснованные изменения этого плана к концу', plan.continuityChanges, true);
      if (!plan.stateIn && keyframe === 'start' || !plan.stateOut && keyframe === 'end') add('legacy-action', 'Состояние по описанию плана', plan.description ?? plan.story, true);
    } else {
      add('action', 'Действие только текущего плана', plan.description ?? plan.story, true);
      add('state-in', 'Начало', plan.stateIn, true); add('state-out', 'Конец', plan.stateOut, true);
      add('end-frame', 'Конечная композиция', direction?.endFrame, true);
      add('changes', 'Изменения в действии, сохраняющиеся после плана', plan.continuityChanges, true);
    }
  }
  for (const hero of heroes) {
    const c = hero.profile;
    const physical = item.stage === 1 ? c : hero.variant?.character ?? c;
    add(`hero.${hero.item.id}`, `Постоянная идентичность ${c.name}`, [physical.appearance, physical.actorProfile?.identity].filter(Boolean).join('\n') || 'Сохранить лицо, возраст и пропорции утверждённого образа; не выдумывать новые постоянные черты.', true);
    add(`hero-source.${hero.item.id}`, item.stage === 1 ? 'Работа с прообразами героя' : `Постоянные указания к образу ${c.name}`, physical.instructions, true);
    add(`hero-locked.${hero.item.id}`, `Нельзя менять у героя ${c.name}`, physical.locked, true);
    optional(`hero-performance.${hero.item.id}`, `Характер и манеры ${c.name}`, [c.description, c.actorProfile?.mannerisms].filter(Boolean).join('\n\n'), 65);
    if (c.actorProfile) {
      const actor = c.actorProfile;
      optional(`actor.${hero.item.id}`, `Актёрская задача ${c.name} — без изменения утверждённой внешности`,
        [`Роль: ${actor.role}. Мотив: ${actor.motivation}. Внутреннее противоречие: ${actor.contradiction}.`,
          ...actor.traits.map(t => `${t.name} · ${t.intensity}/10: ${t.intensity === 0 ? 'Не усиливать и не акцентировать эту особенность.' : t.instruction}`)].join('\n\n'), 90);
    }
  }
  const continuity = plan?.sceneContinuity ?? scene?.continuity ?? [];
  for (const c of continuity.filter(c => heroes.some(h => c.characterId ? c.characterId === h.item.id : normalized(c.character) === normalized(h.profile.name)) ||
    (plan?.cast ?? []).some(name => name === c.characterId || normalized(name) === normalized(c.character))))
    add(`continuity.${c.characterId ?? c.character}`, `Одежда и предметы ${c.character}`, `Одежда: ${c.outfit}. Предметы, состояние и владелец: ${c.props}. Не меняй их без описанного действия.`, true);
  // History is ordered: take / hand over / take again are distinct transitions,
  // even when two rows have identical text. Never deduplicate these changes.
  for (const change of plan?.previousChanges ?? []) add(`prior.${change.id}`, 'Уже произошедшее изменение — сохранять', change.changes, true);
  if (!continuity.length) add('legacy-continuity', 'Непрерывность одежды, предметов и положения', plan?.continuity, true);
  for (const card of locations) {
    const v = approved(card) as WorldVariant | undefined, profile = (item.stage === 3 ? (card as WorldItem).location : undefined) ?? v?.location ?? (card as WorldItem).location;
    if (profile) {
      add(`location-identity.${card.id}`, `Постоянная локация ${profile.name}`, `Признаки: ${profile.identity}. Постоянные предметы: ${profile.permanentProps}.`, true);
      optional(`location-geography.${card.id}`, `География ${profile.name}`, profile.geography, 85);
    } else optional(`location.${card.id}`, `Локация ${card.title}`, v?.text, 85);
  }
  // A portrait still belongs to the film's world. Reuse scene-related location TEXT,
  // without transferring all location pictures or people into a character reference.
  if (item.stage === 1) {
    const name = heroes[0]?.profile.name;
    const heroScenes = p.directing?.scenes.filter(s => s.shots.some(shot => shot.characterIds?.includes(item.id) ||
      shot.cast.some(c => c === item.id || !!name && normalized(c) === normalized(name))) || s.continuity.some(c => c.characterId === item.id || !!name && normalized(c.character) === normalized(name))) ?? [];
    const relatedIds = new Set(heroScenes.flatMap(s => s.locationIds ?? []));
    const contextLocations = p.items.filter(i => i.stage === 3 && active(i) && approved(i) &&
      (!heroScenes.length || (relatedIds.size ? relatedIds.has(i.id) : heroScenes.some(s => mentions(s.location, i.title)))));
    for (const card of contextLocations) {
      const v = approved(card) as WorldVariant, profile = v.location ?? (card as WorldItem).location;
      optional(`portrait-world.${card.id}`, `Среда героя — ${card.title}`, profile ? [profile.identity, profile.permanentProps].filter(Boolean).join('\n\n') : v.text, 70);
    }
  }
  add('location-layout', 'Текущее расположение предметов локации', locationState?.layout, true);
  add('location-changes', 'Разрешённые изменения локации', locationState?.allowedChanges, true);
  optional('location-state', 'Свет, время, погода и художественное решение сцены', [locationState?.time, locationState?.light, locationState?.weather, locationState?.artDirection].filter(Boolean).join('\n\n'), 80);
  add('mouth', 'Правило речи и рта', input.kind === 'video' ? speechDirection(speech)
    : 'В этом неподвижном ключевом кадре рты всех персонажей закрыты; эмоции передаются глазами, взглядом и позой. Не изображай текст речи.', true);
  if (input.kind === 'video' && speech.speechType === 'character') add('spoken-text', `Текст для артикуляции ${speech.speaker}`, typeof plan?.dialogue === 'object' ? plan.dialogue.text : plan?.dialogue, true);
  if (speech.speechType === 'character' && (plan?.cast !== undefined || plan?.characterIds !== undefined) && !(plan?.cast ?? heroes.map(h => h.profile.name)).some(name => name === speech.speaker || normalized(name) === normalized(speech.speaker)))
    throw new PromptCompilationError('speaker', 'Говорящий герой не входит в состав текущего плана. Исправьте участника или выберите закадровый голос.');

  if (direction) {
    const middle = input.kind === 'image' && keyframe === 'middle';
    const framing = input.kind === 'image' && !middle ? keyframe === 'end' ? direction.framingEnd : direction.framingStart : undefined;
    const framingPath = [direction.framingStart && FRAMING_NAMES[direction.framingStart], direction.framingEnd && FRAMING_NAMES[direction.framingEnd]].filter(Boolean).join(' → ');
    add('framing', 'Крупность', framing ? FRAMING_NAMES[framing] : middle && framingPath ? `Промежуточная на пути ${framingPath}; одна композиция.` : input.kind === 'video' ? framingPath : '', true);
    add('composition', 'Композиция', direction.composition, true);
    add('angle', 'Ракурс', direction.angle && `${direction.angle.type}${direction.angle.description ? ': ' + direction.angle.description : ''}`, true);
    add('attention', 'Центр внимания', middle && direction.attention ? `Одна промежуточная фаза между ${direction.attention.start} и ${direction.attention.end}.` : input.kind === 'image' ? keyframe === 'end' ? direction.attention?.end : direction.attention?.start
      : direction.attention && `В начале: ${direction.attention.start}. В конце: ${direction.attention.end}.`, true);
    for (const position of direction.positions ?? []) add(`position.${position.subjectId ?? position.subject}`, `Положение ${position.subject}`, middle ? `Одна промежуточная поза между ${position.start} и ${position.end}. Не совмещай несколько поз.` : input.kind === 'image' ? keyframe === 'end' ? position.end : position.start
      : `В начале: ${position.start}. В конце: ${position.end}. Направление на экране: ${position.screenDirection ?? 'сохранить'}.`, true);
    if (input.kind === 'video') {
      add('camera-movement', 'Движение камеры', direction.cameraMovement && `${direction.cameraMovement.type}: ${direction.cameraMovement.description}${direction.cameraMovement.from ? '. Откуда: ' + direction.cameraMovement.from : ''}${direction.cameraMovement.to ? '. Куда: ' + direction.cameraMovement.to : ''}`, true);
      for (const [n, beat] of (direction.actionBeats ?? []).entries()) add(`beat.${n}`, `Действие ${beat.start}–${beat.end} сек`, beat.action + (beat.emotionalChange ? `. Изменение эмоции: ${beat.emotionalChange}` : ''), true);
      add('timing', 'Ритм плана', direction.timing && `Начальная пауза ${direction.timing.openingHold ?? 0} сек; конечная ${direction.timing.endingHold ?? 0} сек${direction.timing.revealAt !== undefined ? `; раскрытие на ${direction.timing.revealAt} сек` : ''}.`, true);
      optional('transition', 'Стыковка после плана — не внутренняя склейка', direction.transition?.description, 60);
      optional('sound', 'Звуки без собственной речи и пения', [direction.sound?.ambience, ...(direction.sound?.effects ?? []).map(s => `${s.at} сек: ${s.description}`), direction.sound?.silence ? 'Тишина' : undefined].filter(Boolean).join('\n\n'), 55);
    }
    optional('performance', 'Видимые актёрские действия текущего плана', direction.performance?.map(a => `${a.character}: ${a.visibleAction}. ${a.emotionStart} → ${a.emotionEnd}`).join('\n\n'), 90);
  } else add('camera-legacy', input.kind === 'image' ? 'Начальный ракурс' : 'Камера', plan?.camera ?? plan?.cinematography, true);
  optional('design', 'Художественное решение текущего плана', plan?.productionDesign, 90);
  for (const style of p.items.filter(i => i.stage === 2 && active(i) && approved(i))) optional(`style.${style.id}`, 'Единый визуальный стиль фильма', approved(style)!.text, 95);
  if (p.directing) {
    const brief = effectiveCreativeBrief(p.directing.brief, scene?.creativeOverrides as CreativeOverrides | undefined);
    optional('creative', 'Творческое задание этой сцены', `Жанр: ${brief.genre}. Подход: ${brief.director}. Приёмы: ${brief.techniques}. Воздействие: ${brief.effect}.`, 75);
    if (brief.strengths) optional('creative-strengths', 'Сила выбранных приёмов', `Шкала 0–10: 0 — не применять приём, 10 — выраженно применять. Утверждённые события, внешность и состояние важнее интенсивности. ${JSON.stringify(brief.strengths)}`, 70);
  }
  const at = plans.findIndex(s => plan?.id ? s.id === plan.id : s.title === plan?.title);
  optional('previous', 'Только для стыковки — выход предыдущего плана', plans[at - 1]?.stateOut, 25);
  optional('next', 'Только для стыковки — вход следующего плана', plans[at + 1]?.stateIn, 25);
  // Only the exact studio-generated repetition may be compressed. Manual instructions
  // are critical unless the caller supplies a separate, explicit director delta.
  const taskWithoutSeries = input.prompt.replace(/\n\nСоздай самостоятельный вариант \d+ из \d+, сохраняя обязательные признаки текущего плана\.$/, '').trim();
  const generatedTask = input.kind === 'video' ? videoPrompt(p, item) : item.stage === 5 ? storyboardPrompt(p, item) : '';
  if (plan && (input.instruction?.trim() || taskWithoutSeries === generatedTask.trim())) {
    const saved=input.kind==='image'?(sourcePlan as PromptPlan&{imagePrompt?:string})?.imagePrompt:(sourcePlan as PromptPlan&{videoPrompt?:string})?.videoPrompt;
    const preparedShot=p.directing?.scenes.flatMap(scene=>scene.shots).find(shot=>shot.id===sourcePlan?.id);
    const prepared=!!preparedShot?.promptBasis&&saved?.trim()===taskWithoutSeries&&(input.kind==='image'?preparedShot.imagePrompt:preparedShot.videoPrompt)?.trim()===taskWithoutSeries;
    const core=prepared?preparedPromptBody(taskWithoutSeries,p.format):taskWithoutSeries;
    const series=input.prompt.match(/\n\nСоздай самостоятельный вариант \d+ из \d+, сохраняя обязательные признаки текущего плана\.$/)?.[0]??'';
    const body=prepared?core+series:input.prompt;
    optional('task', 'Автоматическая задача текущего плана', body, 100);
    if(core!==taskWithoutSeries&&prepared)omitted.push({key:'prepared-context',label:'Повтор утверждённых героев, состояния и локации из подготовленного промпта',reason:'duplicate',characters:taskWithoutSeries.length-core.length});
  }
  else if (plan) add('task', 'Задача и правки режиссёра', input.prompt, true);
  else add('task', 'Задача', input.prompt, true);

  const knownOwners = new Map<string, Item>();
  for (const card of p.items) for (const assetId of [...(card.character?.refs ?? []), ...card.variants.flatMap(v => v.assetId ? [v.assetId] : []),
    ...((card as WorldItem).location?.refs ?? []), ...((card as WorldItem).location?.approvedAngles.flatMap(a => a.refs) ?? [])]) knownOwners.set(assetId, card);
  const heroAssets = new Map(heroes.flatMap(h => [h.variant?.assetId, ...h.profile.refs].filter((id): id is string => !!id).map(assetId => [assetId, h] as const)));
  const locationAssets = new Map(locations.flatMap(card => {
    const v = approved(card) as WorldVariant | undefined, profile = (item.stage === 3 ? (card as WorldItem).location : undefined) ?? v?.location ?? (card as WorldItem).location;
    return [v?.assetId, ...(profile?.refs ?? []), ...(profile?.approvedAngles.filter(a => locationState?.angleIds?.includes(a.id)).flatMap(a => a.refs) ?? [])]
      .filter((id): id is string => !!id).map(assetId => [assetId, card] as const);
  }));
  const frames = plan ? p.items.filter(card => belongsToPlan(card, item, plan)) : [];
  const frameAssets = new Set(frames.flatMap(card => card.variants.flatMap(v => v.kind === 'image' && v.assetId ? [v.assetId] : [])));
  const autoFirst = frames.filter(card => card.stage === 5).map(approved).find(v => v?.kind === 'image' && v.assetId)?.assetId;
  const raw = input.references ?? [...heroes.filter(h => !input.characterIds || input.characterIds.includes(h.item.id)).flatMap(h => h.variant?.assetId ? [h.variant.assetId] : []),
    ...(item.stage === 1 ? heroes.flatMap(h => h.profile.refs) : []),
    ...locations.flatMap(card => approved(card)?.assetId ? [approved(card)!.assetId!] : []),
    ...(item.stage === 3 ? locations.flatMap(card => (card as WorldItem).location?.refs ?? []) : [])];
  const explicitFirst = raw.find((ref): ref is PromptReference => typeof ref !== 'string' && ref.role === 'first-frame');
  const explicitLast = raw.find((ref): ref is PromptReference => typeof ref !== 'string' && ref.role === 'last-frame');
  const selectedFrame = raw.map(ref => typeof ref === 'string' ? ref : ref.assetId).find(id => frameAssets.has(id));
  const startFrame = input.startFrameId ?? explicitFirst?.assetId ?? (input.kind === 'video' ? selectedFrame ?? autoFirst : undefined);
  const endFrame = input.endFrameId ?? explicitLast?.assetId;
  const candidates: PromptReference[] = [
    ...(startFrame ? [{ assetId: startFrame, role: 'first-frame' as const }] : []),
    ...(endFrame ? [{ assetId: endFrame, role: 'last-frame' as const }] : []),
    ...raw.map(ref => typeof ref === 'string' ? { assetId: ref } : ref),
  ];
  const references: CompiledReference[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    const id = candidate.assetId, owner = knownOwners.get(id), hero = heroAssets.get(id), location = locationAssets.get(id);
    if (typeof id !== 'string' || !id.trim() || id.length > 100 || /^(?:data:|https?:)/i.test(id) || candidate.role !== undefined && !REFERENCE_ROLES.includes(candidate.role))
      throw new PromptCompilationError('reference_id', 'Передавайте только ID сохранённых референсов и поддерживаемую роль изображения, без URL или встроенных файлов.');
    if (!selectedReferences(p, [id]).length) { omitted.push({ key: `ref.${id}`, label: 'Референс', reason: 'hidden', assetId: id }); continue; }
    let role: ReferenceRole | undefined = candidate.role === 'last-frame' && id === endFrame ? 'last-frame' : id === startFrame ? 'first-frame' : id === endFrame ? 'last-frame' : hero ? 'character' : location ? 'location'
      : frameAssets.has(id) ? candidate.role === 'last-frame' ? 'last-frame' : 'reference' : !owner ? ['first-frame', 'last-frame', 'style'].includes(candidate.role ?? '') ? candidate.role : 'reference'
        : (candidate.role === 'style' || candidate.role === undefined) && owner.stage === 2 && active(owner) ? 'style' : undefined;
    if (owner && (!active(owner) || owner.excludedAt || !hero && !location && !frameAssets.has(id) && role !== 'style') ||
      (role === 'first-frame' || role === 'last-frame') && owner && !frameAssets.has(id)) role = undefined;
    if (!role || candidate.itemId && candidate.itemId !== (hero?.item.id ?? location?.id ?? owner?.id)) {
      omitted.push({ key: `ref.${id}`, label: 'Референс другого героя, локации или плана', reason: 'irrelevant', assetId: id }); continue;
    }
    if (role === 'character' && input.characterIds && !input.characterIds.includes(hero!.item.id)) { omitted.push({ key: `ref.${id}`, label: hero!.profile.name, reason: 'irrelevant', assetId: id }); continue; }
    if (input.kind === 'video' && (role === 'last-frame' && !capability.adapter.lastFrame || role !== 'first-frame' && role !== 'last-frame' && !capability.adapter.maxAdditionalReferences)) {
      omitted.push({ key: `ref.${id}`, label: role === 'last-frame' ? 'Конечный кадр' : 'Дополнительный референс', reason: 'unsupported', assetId: id });
      if (role === 'last-frame') warnings.push('Подключённый адаптер не передаёт конечный кадр. Конец описан текстом; изображение не заменяется референсом героя.');
      continue;
    }
    const referenceKey = role === 'first-frame' || role === 'last-frame' ? `${role}:${id}` : id;
    if (seen.has(referenceKey)) { omitted.push({ key: `ref.${id}`, label: 'Повторный референс', reason: 'duplicate', assetId: id }); continue; }
    seen.add(referenceKey); references.push({ assetId: id, role, itemId: hero?.item.id ?? location?.id ?? owner?.id, label: hero?.profile.name ?? location?.title ?? candidate.label ?? owner?.title });
  }
  const roleOrder: Record<ReferenceRole, number> = { 'first-frame': 0, 'last-frame': 1, character: 2, location: 3, style: 4, reference: 5 };
  const canonicalFace=(ref:CompiledReference)=>[5,7].includes(item.stage)&&ref.role==='character'&&heroAssets.get(ref.assetId)?.variant?.assetId===ref.assetId;
  references.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || Number(canonicalFace(b))-Number(canonicalFace(a)));
  if (input.kind==='image' && item.stage===5) for(const hero of heroes) {
    if (hero.item.selectedId!==hero.item.approvedId && hero.item.variants.some(v=>v.id===hero.item.selectedId&&v.kind==='image'&&v.assetId))
      warnings.push(`У героя «${hero.profile.name}» выбран другой, ещё не утверждённый вариант. Для раскадровки используется утверждённый образ. Утвердите новый вариант в «Героях», если хотите заменить внешность.`);
    if (!references.some(ref=>ref.role==='character'&&ref.assetId===hero.variant?.assetId))
      warnings.push(`Не прикреплён утверждённый образ героя «${hero.profile.name}». По тексту или исходному фото лицо может отличаться от выбранного варианта. Отметьте изображение утверждённого героя в референсах этого плана.`);
  }
  if (input.kind === 'video' && !references.some(ref => ref.role === 'first-frame'))
    throw new PromptCompilationError('first_frame', 'Выберите первый кадр именно текущего плана. Он скрыт, удалён или относится к другой карточке.');
  if (input.kind === 'video' && endFrame && capability.adapter.lastFrame && !references.some(ref => ref.role === 'last-frame'))
    throw new PromptCompilationError('last_frame', 'Выберите конечный кадр именно текущего плана. Он скрыт, удалён или относится к другой карточке.');
  if (input.kind === 'image' && modelId === 'fal-qwen-image-edit-2511' && !references.length)
    throw new PromptCompilationError('references_required', 'Qwen Image Edit нужен хотя бы один относящийся к плану референс. Выберите героя, локацию или начальный кадр.');
  if (references.length > capability.adapter.maxImageReferences || input.kind === 'video' && references.filter(ref => ref.role !== 'first-frame' && ref.role !== 'last-frame').length > capability.adapter.maxAdditionalReferences)
    throw new PromptCompilationError('reference_count', `Выбрано ${references.length} подходящих изображений, но адаптер допускает ${capability.adapter.maxImageReferences}. Снимите лишние референсы или выберите другую модель; обязательные образы не исключаются автоматически.`);
  for (const [n, ref] of references.entries()) add(`ref-role.${n}`, `Изображение ${n + 1}`, ref.role === 'first-frame' ? 'Начальная композиция текущего плана; сохраняй лица и окружение.'
    : ref.role === 'last-frame' ? 'Конечная композиция текущего плана.' : ref.role === 'character' ? canonicalFace(ref)
      ? `Утверждённый образ героя ${ref.label} — основной образец его лица и внешности. Воспроизведи узнаваемые черты этого конкретного героя, а не похожий типаж. Он важнее исходных прообразов и стилизации. Не копируй позу или фон; костюм и текущее состояние задаёт постановка.`
      : `Исходный прообраз героя ${ref.label}, вспомогательный референс. Если приложен утверждённый образ этого героя, его лицо и внешность имеют приоритет. Не смешивай лица, не копируй позу или фон.`
    : ref.role === 'location' ? `Локация ${ref.label}; не переноси посторонних персонажей.` : ref.role === 'style' ? 'Только техника изображения, свет и цвет; не переносить чужих героев или композицию.' : 'Выбранный режиссёром прообраз только для текущего плана.', true);
  if (input.kind === 'video' && references.some(ref => ref.role === 'last-frame') && duration !== undefined && duration !== capability.duration!.requestedSeconds)
    warnings.push(`Модель запрашивается на ${capability.duration!.requestedSeconds} сек, а план рассчитан на ${duration} сек. Конечный кадр закреплён в конце полного клипа. Обрезка конца может убрать выбранную композицию; проверьте фактическое время перед монтажом.`);
  if (capability.adapter.nativeAudio === 'possible') warnings.push('Модель может создать свой звук. Утверждённая озвучка накладывается отдельно; промпт запрещает самостоятельную речь и пение.');
  if (capability.duration?.variableResult) warnings.push('Фактическая длительность результата может отличаться от запрошенной; проверьте файл перед озвучкой и монтажом.');

  const mandatory = sections.filter(s => s.required), criticalText = render(mandatory);
  if (criticalText.length > limit) throw new PromptCompilationError('critical_too_long', `Обязательная постановка занимает ${criticalText.length} символов при лимите ${limit}. Сократите правки режиссёра, постоянную внешность, одежду, предметы или действия текущего плана либо выберите модель с большим бюджетом. Автоматическое описание можно заменить краткими правками. Обязательные признаки не обрезаны; запрос не отправлен.`,
    { limit, requiredCharacters: criticalText.length, sections: mandatory.map(s => s.label) });
  const kept = new Set(mandatory.map(s => s.key));
  const includedTexts = new Set(mandatory.map(s => s.text));
  let used = criticalText.length;
  for (const section of sections.filter(s => !s.required).sort((a, b) => b.priority - a.priority)) {
    if (includedTexts.has(section.text)) { omitted.push({ key: section.key, label: section.label, reason: 'duplicate', characters: section.text.length }); continue; }
    const cost = render([section]).length + (used ? 2 : 0);
    if (used + cost <= limit) { kept.add(section.key); includedTexts.add(section.text); used += cost; }
    else omitted.push({ key: section.key, label: section.label, reason: 'budget', characters: section.text.length });
  }
  const included = sections.filter(s => kept.has(s.key)), prompt = render(included);
  return { prompt, references, criticalText, capability,
    budget: { limit, source: input.providerPromptLimit !== undefined && input.providerPromptLimit < capability.promptLimit ? 'проверенный лимит текущего каталога API' : capability.limitSource,
      criticalCharacters: criticalText.length, originalCharacters: render(sections).length, compiledCharacters: prompt.length, remaining: limit - prompt.length },
    compression: { shortened: prompt.length < render(sections).length, omitted, includedKeys: included.map(s => s.key) }, warnings: [...new Set(warnings)] };
}
