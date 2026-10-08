import type { CharacterBrief, Item, Project } from './domain';
import { model } from './models';
import { availableForDirecting, promptCapacity, promptSize, fitsPrompt, GROK_VIDEO_1080, KLING_VIDEO } from './model-capabilities';
import { selectedReferences } from './reference-selection';
import { speechDirection, speechInfo, type SpeechType } from './speech-mode';
import { effectiveCreativeBrief, type CreativeOverrides } from './creative-brief';
import { FRAMING_NAMES, shotDirectionSchema, validateShotDirection, type ShotDirection } from './shot-direction';
import { googleSeconds } from './google-models';
import { zenProfile,zenVideoSeconds } from './zencreator-models';
import type { ActorProfile, LocationProfile, LocationState } from './world-assets';
import { videoPrompt } from './video';
import { planFields, storyboardPrompt } from './storyboard';
import { supportsEndFrame } from './video-end-frame';
import { VIDEO_DURATION_CONTRACTS, videoRequestTiming } from './video-duration';
import {compactPromptText,preparedPromptBody,frameStyleText} from './prompt-text';
import {boundCharacterId,shotBindsCharacter} from './character-bindings';
import {keyframeRoleInstruction} from './keyframes';
import {effectiveStagingMode,stagingPrompt} from './staging-policy';
import {effectiveFacialExpression,facialExpressionPrompt} from './facial-expression';
import {cameraPolicyPrompt} from './camera-policy';
import {readableNarrativeBeat} from './emotional-dramaturgy';
import {storyMeaningContext,storyMeaningPublicationCurrent} from './story-meaning';
import {PORTRAIT_DIRECTION,portraitTraits,portraitStyleText} from './character-portrait';

export const REFERENCE_ROLES = ['first-frame', 'last-frame', 'character', 'location', 'style', 'reference'] as const;
export type ReferenceRole = typeof REFERENCE_ROLES[number];
export type PromptReference = { assetId: string; role?: ReferenceRole; itemId?: string; label?: string };
export type CompiledReference = PromptReference & { role: ReferenceRole };
type Continuity = { character: string; characterId?: string; outfit: string; props: string };
export type PromptPlan = {
  id?: string; sceneId?: string; title: string; duration: number; cast?: string[]; characterIds?: string[]; locationIds?: string[];
  meaningIds?: string[];
  description?: string; story?: string; stateIn?: string; stateOut?: string; camera?: string; cinematography?: string;
  productionDesign?: string; continuity?: string; continuityChanges?: string; direction?: ShotDirection;
  dialogue?: string | { speechType: SpeechType; speaker: string; text: string; delivery: string };
  speechType?: SpeechType; speaker?: string; sceneContinuity?: Continuity[];
  previousChanges?: { id: string; changes: string }[]; locationState?: LocationState;
};
export type PromptCapability = {
  modelId: string; provider: string; kind: 'image' | 'video';
  promptUnit: 'characters'|'tokens'; promptLimit: number; limitSource: string; newDirecting: boolean;
  adapter: { firstFrame: boolean; lastFrame: boolean; requiresFirstFrame: boolean; maxImageReferences: number; maxAdditionalReferences: number; camera: 'text'; nativeAudio: 'possible' | 'none' | 'unknown' };
  upstream: { lastFrame: boolean | 'unknown'; lastFrameField?: string; source?: string; checked?: string };
  duration?: { requestedSeconds: number; planMaxSeconds: number; variableResult: boolean };
};

/** Capabilities of the installed adapters; upstream extensions are never enabled implicitly. */
export function promptModelCapability(modelId: string): PromptCapability {
  const m = model(modelId);
  if (m.kind !== 'image' && m.kind !== 'video' || m.provider === 'sync') throw new PromptCompilationError('model_kind', 'Выберите модель генерации изображения или видеоплана.');
  const cap = promptCapacity(modelId, m.kind);
  const video = m.kind === 'video', maxAdditional = video && m.provider === 'xai' && modelId!==GROK_VIDEO_1080 ? 7 : 0, lastFrame = video && supportsEndFrame(modelId);
  const requestedSeconds = googleSeconds(modelId) ?? zenProfile(modelId)?.seconds ?? 6;
  const result: PromptCapability = {
    modelId, provider: m.provider, kind: m.kind, promptUnit:cap.unit, promptLimit: cap.limit, limitSource: cap.source,
    newDirecting: availableForDirecting(modelId),
    adapter: { firstFrame: video, lastFrame, requiresFirstFrame: video,
      maxImageReferences: video ? 1 + Number(lastFrame) + maxAdditional : m.provider === 'xai' ? 5 : 8,
      maxAdditionalReferences: maxAdditional, camera: 'text',
      nativeAudio: !video ? 'none' : modelId === 'fal-wan-2.2-a14b' || modelId === 'MiniMax-Hailuo-2.3' ? 'none'
        : modelId === 'grok-imagine-video-1.5' || modelId === 'MiniMax-H3' || modelId === 'fal-minimax-h3-max' || modelId.startsWith('veo-') ? 'possible' : 'unknown' },
    upstream: { lastFrame: 'unknown' },
    ...(video ? { duration: { requestedSeconds, planMaxSeconds: Object.hasOwn(VIDEO_DURATION_CONTRACTS,modelId)?VIDEO_DURATION_CONTRACTS[modelId].max:requestedSeconds, variableResult: modelId === 'gemini-omni-1.1-flash' } } : {}),
  };
  if (modelId === 'grok-imagine-video-1.5') result.upstream = { lastFrame: true, lastFrameField: 'last_frame', checked: '2026-10-01', source: 'https://docs.x.ai/developers/model-capabilities/video/reference-to-video' };
  if(modelId===KLING_VIDEO)result.upstream={lastFrame:true,lastFrameField:'end_image_url',checked:'2026-10-05',source:'https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api'};
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
  sections: PromptSection[];
  budget: { unit?:'characters'|'tokens'; used?:number; needsOptimization?:boolean; limit: number; source: string; criticalCharacters: number; originalCharacters: number; compiledCharacters: number; remaining: number };
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
export type PromptSection = { key: string; label: string; text: string; priority: number; required: boolean; verbatim?: boolean };
const render = (sections: readonly PromptSection[]) => sections.map(s => `${s.label}: ${s.text}`).join('\n\n');

/** Pure, deterministic preflight. Never performs compression calls, reads files, enqueues or mutates. */
export function compilePrompt(p: Project, item: Item, modelId: string, input: PromptInput): CompiledPrompt {
  if (!p.items.some(i => i.id === item.id && active(i)) || item.excludedAt) throw new PromptCompilationError('item_scope', 'Выберите действующую карточку текущего проекта.');
  const capability = promptModelCapability(modelId);
  if (capability.kind !== input.kind) throw new PromptCompilationError('model_kind', 'Тип модели не совпадает с задачей.');
  if (input.providerPromptLimit !== undefined && (!Number.isInteger(input.providerPromptLimit) || input.providerPromptLimit <= 0))
    throw new PromptCompilationError('provider_limit', 'Некорректный лимит из каталога провайдера.');
  const limit = Math.min(capability.promptLimit, input.providerPromptLimit ?? Infinity);
  if ((!capability.newDirecting) && !input.allowLegacyModel)
    throw new PromptCompilationError('short_model', `Этот старый компактный адаптер не используется для новой постановки. Выберите другую модель. Старые результаты и запросы сохранены.`);
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
  // Only explicit shot links participate. A scene's map, a later draft shot or
  // another scene must never expand the scope of a single generated clip.
  const meaningContext = plan?.meaningIds?.length ? storyMeaningContext(p, plan) : undefined;
  const meanings = meaningContext?.meanings ?? [];
  if (meaningContext && (!meaningContext.approved || !storyMeaningPublicationCurrent(p) || plan!.meaningIds!.some(id => !meanings.some(meaning => meaning.id === id))))
    throw new PromptCompilationError('story_meaning', 'Карта смысла этого плана не утверждена, изменилась или содержит потерянную связь. Проверьте карту смысла и заново подготовьте и примените подробный сценарий перед генерацией.');
  const scene = p.directing?.scenes.find(s => s.id === plan?.sceneId);
  const direction = plan?.direction ? shotDirectionSchema.parse(plan.direction) : undefined;
  const speech = plan && typeof plan.dialogue === 'object' ? speechInfo({ speechType: plan.dialogue.speechType, speaker: plan.dialogue.speaker, dialogue: plan.dialogue.text })
    : speechInfo({ speechType: plan?.speechType, speaker: plan?.speaker, dialogue: typeof plan?.dialogue === 'string' ? plan.dialogue : '' });
  const duration = input.duration ?? plan?.duration;
  if (input.kind === 'video' && duration !== undefined) {
    const modern = !!(input.endFrameId || item.videoPreparation || input.references?.some(ref => typeof ref !== 'string' && ref.role === 'last-frame'));
    try { const timing=videoRequestTiming(modelId,duration,modern,capability.duration!.requestedSeconds); capability.duration={...capability.duration!,requestedSeconds:zenProfile(modelId)?.kind==='video'?zenVideoSeconds(modelId,duration):timing.requestedSeconds,planMaxSeconds:timing.planMaxSeconds}; }
    catch(e) { throw new PromptCompilationError('duration_fit',(e as Error).message); }
  }
  if (input.kind === 'video' && direction && duration !== undefined) {
    const conflict = validateShotDirection({ id: plan?.id ?? item.id, duration, direction }).find(issue => issue.severity === 'conflict');
    if (conflict) throw new PromptCompilationError('direction_timing', `${conflict.message} Исправьте постановку перед запуском.`);
  }

  const warnings: string[] = modelId===GROK_VIDEO_1080?['Grok 1080p: передаётся только первый кадр. Конечный кадр и отдельные образы героев исключены; внешний вид задаёт первый кадр.']:[], omitted: PromptExclusion[] = [], sections: PromptSection[] = [];
  const add = (key: string, label: string, text: string | undefined, required: boolean, priority = 0) => {
    if (text?.trim()) sections.push({ key, label, text: /^(?:hero\.|hero-locked\.|continuity\.|location-identity\.|location-layout)/.test(key)?compactPromptText(text):text.trim(), required, priority,
      ...(input.kind==='video'&&(['camera-movement','camera-legacy','framing','narrative-beat'].includes(key)||key.startsWith('performance.')||key.startsWith('story-meaning.'))||
        input.kind==='image'&&meanings.length>0&&(['state','keyframe'].includes(key)||key.startsWith('meaning-evidence.'))?{verbatim:true}:{}) });
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

  const staging=effectiveStagingMode(p.directing?.brief.stagingMode,direction?.stagingMode);
  const keyframe = input.keyframe ?? 'start';
  const stillPlan = input.kind === 'image' && !!plan;
  const portrait = input.kind === 'image' && item.stage === 1;
  const videoPlan = input.kind === 'video' && !!plan;
  const visibleFaces=!!plan&&(heroes.length>0||!!plan.cast?.length||!!plan.characterIds?.length||plan.cast===undefined&&plan.characterIds===undefined);
  // Video adapters require a first frame. With an explicit shot entrance it is
  // the current-state snapshot; replaying an entire scene history can undo it.
  const currentVideoState = videoPlan && !!plan?.stateIn?.trim();
  // Modern first-keyframe requests have an explicit approved snapshot. The
  // scene ledger describes the whole scene, so replaying its prop history can
  // put objects back or reveal a character before the current shot starts.
  // Legacy calls without a declared keyframe keep their historical context.
  const currentStillState = stillPlan && (input.keyframe === 'start' || meanings.length > 0 && keyframe === 'start') && !!plan?.stateIn?.trim() && !!direction?.startFrame?.trim();
  const anchoredStill = stillPlan && keyframe !== 'start' && !!(input.startFrameId || input.references?.some(ref => typeof ref !== 'string' && ref.role === 'first-frame'));
  const exclude = (key: string, label: string, text: string | undefined) => {
    if (text?.trim()) omitted.push({key, label, reason: 'irrelevant', characters: text.length});
  };
  add('format', 'Формат', input.kind === 'image' ? `Одно цельное изображение анимационного фильма, ${p.format}. Без текста, коллажа, субтитров и пузырей речи.`
    : `Один непрерывный анимационный видеоплан, ${p.format}. Без дополнительных персонажей, склеек внутри клипа, надписей и субтитров.`, true);
  add('instruction', 'Обязательная задача режиссёра', input.instruction, true);
  if (portrait) add('portrait', 'Задача изображения героя', PORTRAIT_DIRECTION, true);
  const generatedRoleInstruction = stillPlan && input.keyframeInstruction === keyframeRoleInstruction(p, item, keyframe);
  // State, pose, framing and changes are rendered once from the approved shot below.
  if (!generatedRoleInstruction) add('keyframe-instruction', 'Назначение ключевого кадра', input.keyframeInstruction, true);
  else add('keyframe-role', 'Назначение ключевого кадра', keyframe === 'end' ? 'Создай последний кадр текущего плана.' : keyframe === 'start' ? 'Первый кадр текущего плана.' : 'Промежуточный кадр текущего плана.', true);
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
    add('cast', 'Участники в кадре', cast.length ? `${cast.join(', ')}. Показывай только этих участников; упоминания соседних планов не добавляют героев в кадр.${currentStillState?' Состав относится ко всему плану: скрытый в начальном состоянии герой остаётся скрытым, его присутствие в списке или референсах не требует показывать его.':''}`
      : plan.cast !== undefined || plan.characterIds !== undefined ? 'Персонажей нет. Не добавляй людей или героев.'
      : 'Состав не выделен в старом плане. Показывай только персонажей, непосредственно названных в его описании; не добавляй героев из соседних планов или референсов.', true);
    if (input.kind === 'image') {
      add('moment', 'Единственный момент изображения', keyframe === 'middle' ? 'Один промежуточный момент действия этого плана. Не повторяй начальное или конечное состояние, не показывай несколько фаз одновременно.'
        : keyframe === 'end' ? 'Конец текущего плана после его действий: одна неподвижная итоговая поза и композиция. Состояние к концу, конечный ключевой кадр и конечные положения ниже определяют изображение; не копируй начальную позу из референса. Не изображай путь к результату или несколько фаз одновременно. Если действие по сценарию возвращается в исходное состояние, сохрани именно этот результат, не придумывай отличий.'
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
      // Meaning evidence may describe a reveal that happens later. Only exact
      // evidence that is itself an approved still snapshot can be added. A
      // substring can sit inside a negation, so matching isolated words is not
      // proof of visibility. More detailed evidence stays in the locked snapshot.
      const snapshots = keyframe === 'start' ? [plan.stateIn, direction?.startFrame]
        : keyframe === 'end' ? [plan.stateOut, direction?.endFrame] : [];
      for (const meaning of meanings) {
        const visibleEvidence = meaning.evidence.filter(evidence => snapshots.some(snapshot => snapshot && normalized(snapshot) === normalized(evidence)));
        if (visibleEvidence.length) add(`meaning-evidence.${meaning.id}`, 'Видимые смысловые признаки только этого момента', visibleEvidence.join('\n'), true);
      }
    } else {
      add('action', 'Действие только текущего плана', plan.description ?? plan.story, true);
      add('state-in', 'Начало', plan.stateIn, true); add('state-out', 'Конец', plan.stateOut, true);
      add('start-frame', 'Начальная композиция', direction?.startFrame, true);
      add('end-frame', 'Конечная композиция', direction?.endFrame, true);
      add('changes', 'Изменения в действии, сохраняющиеся после плана', plan.continuityChanges, true);
      for (const meaning of meanings) add(`story-meaning.${meaning.id}`, 'Смысл текущего плана — передать наблюдаемым действием', [
        `Смысл: ${meaning.title}.`,
        `Зритель до: ${meaning.viewerBefore}`,
        `Зритель после: ${meaning.viewerAfter}`,
        `Событие и его причина: ${meaning.event}`,
        `Что поставлено на карту: ${meaning.stakes}`,
        `Конкретные видимые доказательства:\n${meaning.evidence.join('\n')}`,
        'Сохрани причинную связь, пространственные отношения и момент раскрытия. Покажи только вклад текущего плана в этот смысл по его началу, действию и концу; не повторяй уже показанные события и не переноси сюда будущие. Передай понимание через видимые признаки, без объясняющих надписей или придуманной речи.',
      ].join('\n'), true);
      add('shot-duration', 'Время действия', duration === undefined ? undefined : staging ? `Распредели описанное действие и короткую реакцию на ${duration} сек. Не замирай в финальной позе: сохраняй естественное микродвижение; пауза только если явно задана. Не добавляй новые события.` : `Заверши описанное действие за ${duration} сек; затем удерживай итоговую позу до конца клипа. Не добавляй новые события.`, true);
    }
  }
  for (const hero of heroes) {
    const c = hero.profile;
    const physical = item.stage === 1 ? c : hero.variant?.character ?? c;
    add(`hero.${hero.item.id}`, `Постоянная идентичность ${c.name}`, [physical.appearance, physical.actorProfile?.identity].filter(Boolean).join('\n') || 'Сохранить лицо, возраст и пропорции утверждённого образа; не выдумывать новые постоянные черты.', true);
    add(`hero-source.${hero.item.id}`, item.stage === 1 ? 'Работа с прообразами героя' : `Постоянные указания к образу ${c.name}`, physical.instructions, true);
    add(`hero-locked.${hero.item.id}`, `Нельзя менять у героя ${c.name}`, physical.locked, true);
    const performance = [c.description, c.actorProfile?.mannerisms].filter(Boolean).join('\n\n');
    if (stillPlan || videoPlan || portrait) exclude(`hero-performance.${hero.item.id}`, `Биография и общие манеры ${c.name} — не действие текущего изображения`, performance);
    else optional(`hero-performance.${hero.item.id}`, `Характер и манеры ${c.name}`, performance, 65);
    if (portrait) {
      optional(`portrait-traits.${hero.item.id}`, `Выразительность образа ${c.name}`, portraitTraits(c), 90);
      exclude(`actor.${hero.item.id}`, 'Роль, мотивация и сюжетные задания — для постановки сцен, не для портрета', c.actorProfile && [c.actorProfile.role,c.actorProfile.motivation,c.actorProfile.contradiction,...c.actorProfile.traits.map(t=>t.instruction)].join('\n'));
    }
    if (c.actorProfile && !stillPlan && !videoPlan && !portrait) {
      const actor = c.actorProfile;
      optional(`actor.${hero.item.id}`, `Актёрская задача ${c.name} — без изменения утверждённой внешности`,
        [`Роль: ${actor.role}. Мотив: ${actor.motivation}. Внутреннее противоречие: ${actor.contradiction}.`,
          ...actor.traits.map(t => `${t.name} · ${t.intensity}/10: ${t.intensity === 0 ? 'Не усиливать и не акцентировать эту особенность.' : t.instruction}`)].join('\n\n'), 90);
    }
  }
  // The pinned image already shows the current costume/props. Replaying the scene's
  // initial ledger and all earlier handovers here can undo the requested end state.
  const continuity = anchoredStill || currentVideoState ? [] : plan?.sceneContinuity ?? scene?.continuity ?? [];
  if (anchoredStill) add('source-continuity', 'Что сохранить из первого изображения', 'Сохрани идентичность героев, одежду, постоянные предметы, географию, технику рисунка, палитру и свет выбранного первого кадра. Изменяй позы, взгляды, положение предметов и крупность только согласно целевому моменту ниже. Описание конечного состояния важнее начального расположения на референсе.', true);
  if (currentVideoState) add('source-continuity', 'Текущее состояние по первому кадру', 'Первый кадр задаёт текущую одежду, реквизит, владельцев предметов и локацию. Сохрани их и внешность героев. Начало, конец и действия текущего плана задают только явно описанные изменения; не возвращай прежние состояния, не меняй локацию, не раскрывай скрытых персонажей или предметы раньше указанного момента.', true);
  if (currentStillState) add('current-still-state', 'Приоритет начального состояния', 'Изобрази только утверждённые «Состояние в начале» и «Начальный ключевой кадр». Они определяют позы, эмоцию, видимость героев, положение и владельцев предметов. Общие описания сцены, художественного решения и образцы внешности не отменяют этот момент. Не показывай результат будущего действия и не возвращай прежнее положение реквизита.', true);
  for (const c of continuity.filter(c => heroes.some(h => c.characterId ? c.characterId === h.item.id : normalized(c.character) === normalized(h.profile.name)) ||
    (plan?.cast ?? []).some(name => name === c.characterId || normalized(name) === normalized(c.character))))
    {
      add(`continuity.${c.characterId ?? c.character}`, currentStillState?`Постоянная одежда ${c.character}`:`Одежда и предметы ${c.character}`, currentStillState?`Одежда: ${c.outfit}. Текущее положение героя и предметов задано начальным кадром.`:`Одежда: ${c.outfit}. Предметы, состояние и владелец: ${c.props}. Не меняй их без описанного действия.`, true);
      if(currentStillState)exclude(`scene-props.${c.characterId??c.character}`,'История предметов сцены — начальное состояние уже задано',c.props);
    }
  // History is ordered: take / hand over / take again are distinct transitions,
  // even when two rows have identical text. Never deduplicate these changes.
  for (const change of plan?.previousChanges ?? []) {
    if (anchoredStill || currentVideoState || currentStillState) exclude(`prior.${change.id}`, 'История действий — состояние уже задано текущим планом и первым кадром', change.changes);
    else add(`prior.${change.id}`, 'Уже произошедшее изменение — сохранять', change.changes, true);
  }
  if (!anchoredStill && !currentVideoState && !continuity.length) add('legacy-continuity', 'Непрерывность одежды, предметов и положения', plan?.continuity, true);
  for (const card of locations) {
    const v = approved(card) as WorldVariant | undefined, profile = (item.stage === 3 ? (card as WorldItem).location : undefined) ?? v?.location ?? (card as WorldItem).location;
    if (profile) {
      add(`location-identity.${card.id}`, `Постоянная локация ${profile.name}`, `Признаки: ${profile.identity}. Постоянные предметы: ${profile.permanentProps}.`, true);
      optional(`location-geography.${card.id}`, `География ${profile.name}`, profile.geography, 85);
    } else optional(`location.${card.id}`, `Локация ${card.title}`, v?.text, 85);
  }
  if (portrait) {
    for (const card of p.items.filter(i => i.stage === 3 && active(i) && approved(i)))
      exclude(`portrait-world.${card.id}`, 'Локация фильма — не фон портрета', approved(card)!.text);
  }
  if (!anchoredStill && !currentVideoState) add('location-layout', 'Текущее расположение предметов локации', locationState?.layout, true);
  add('location-changes', 'Разрешённые изменения локации', locationState?.allowedChanges, true);
  optional('location-state', 'Свет, время, погода и художественное решение сцены', [locationState?.time, locationState?.light, locationState?.weather, locationState?.artDirection].filter(Boolean).join('\n\n'), 80);
  add('mouth', 'Правило речи и рта', input.kind === 'video' ? speechDirection(speech)
    : 'В этом неподвижном ключевом кадре рты всех персонажей закрыты; допустимы выразительные глаза, взгляд, брови, улыбка с закрытым ртом и поза. Закрытый рот не означает неподвижное лицо. Не изображай текст речи.', true);
  if (input.kind === 'video' && speech.speechType === 'character') add('spoken-text', `Текст для артикуляции ${speech.speaker}`, typeof plan?.dialogue === 'object' ? plan.dialogue.text : plan?.dialogue, true);
  if (speech.speechType === 'character' && (plan?.cast !== undefined || plan?.characterIds !== undefined) && !(plan?.cast ?? heroes.map(h => h.profile.name)).some(name => name === speech.speaker || normalized(name) === normalized(speech.speaker)))
    throw new PromptCompilationError('speaker', 'Говорящий герой не входит в состав текущего плана. Исправьте участника или выберите закадровый голос.');

  if (direction) {
    const middle = input.kind === 'image' && keyframe === 'middle';
    const framing = input.kind === 'image' && !middle ? keyframe === 'end' ? direction.framingEnd : direction.framingStart : undefined;
    const framingPath = [direction.framingStart && FRAMING_NAMES[direction.framingStart], direction.framingEnd && FRAMING_NAMES[direction.framingEnd]].filter(Boolean).join(' → ');
    add('framing', 'Крупность', framing ? FRAMING_NAMES[framing] : middle && framingPath ? `Промежуточная на пути ${framingPath}; одна композиция.` : input.kind === 'video' ? framingPath : '', true);
    if (!(stillPlan && keyframe === 'end' && direction.endFrame) && !currentStillState) add('composition', 'Композиция', direction.composition, true);
    add('angle', 'Ракурс', direction.angle && `${direction.angle.type}${direction.angle.description ? ': ' + direction.angle.description : ''}`, true);
    add('attention', 'Центр внимания', middle && direction.attention ? `Одна промежуточная фаза между ${direction.attention.start} и ${direction.attention.end}.` : input.kind === 'image' ? keyframe === 'end' ? direction.attention?.end : direction.attention?.start
      : direction.attention && `В начале: ${direction.attention.start}. В конце: ${direction.attention.end}.`, true);
    for (const position of direction.positions ?? []) add(`position.${position.subjectId ?? position.subject}`, `Положение ${position.subject}`, middle ? `Одна промежуточная поза между ${position.start} и ${position.end}. Не совмещай несколько поз.` : input.kind === 'image' ? keyframe === 'end' ? position.end : position.start
      : `В начале: ${position.start}. В конце: ${position.end}. Направление на экране: ${position.screenDirection ?? 'сохранить'}.`, true);
    if (input.kind === 'video') {
      // The performance specialist may express the visible reaction without
      // repeating why the event matters. Preserve that approved causal meaning
      // separately; an optimizer must not reduce it to neutral facial motion.
      if(direction.narrativeBeat)add('narrative-beat','Причина и смысл переживания — показать игрой, без озвучивания мыслей',
        readableNarrativeBeat(direction.narrativeBeat)+(direction.narrativeBeat.role==='reaction'?'\nЕсли повод уже показан в предыдущем плане, играй только нынешнюю реакцию; не повторяй событие.':''),true);
      const movement=direction.cameraMovement;
      add('camera-movement', 'Движение камеры', movement && [
        `${movement.type}: ${movement.description}`,
        movement.purpose&&`Задача: ${movement.purpose}`,movement.from&&`Откуда: ${movement.from}`,movement.to&&`Куда: ${movement.to}`,
        movement.speed&&`Скорость: ${movement.speed}`,movement.start!==undefined&&`Начало: ${movement.start} сек`,movement.end!==undefined&&`Остановка: ${movement.end} сек`,
        movement.keepInFrame&&`Оставить в кадре: ${movement.keepInFrame}`,
      ].filter(Boolean).join('. '), true);
      if(!movement)add('camera-legacy','Камера',plan?.camera??plan?.cinematography,true);
      for (const [n, beat] of (direction.actionBeats ?? []).entries()) add(`beat.${n}`, `Действие ${beat.start}–${beat.end} сек`, beat.action + (beat.emotionalChange ? `. Изменение эмоции: ${beat.emotionalChange}` : ''), true);
      add('timing', 'Ритм плана', direction.timing && `Начальная пауза ${direction.timing.openingHold ?? 0} сек; конечная ${direction.timing.endingHold ?? 0} сек${direction.timing.revealAt !== undefined ? `; раскрытие на ${direction.timing.revealAt} сек` : ''}.`, true);
      exclude('transition', 'Монтажная склейка находится за пределами генерируемого клипа', direction.transition?.description);
      optional('sound', 'Звуки без собственной речи и пения', [direction.sound?.ambience, ...(direction.sound?.effects ?? []).map(s => `${s.at} сек: ${s.description}`), direction.sound?.silence ? 'Тишина' : undefined].filter(Boolean).join('\n\n'), 55);
    }
    // The approved shot task supplies the motivation as well as its visible arc.
    // Omitting objective/subtext reduced meaningful reactions to generic movement.
    // Videos freeze this compact task for optimization; stills retain one instant.
    for(const [n,a] of (direction.performance??[]).entries())add(`performance.${n}`,stillPlan?'Эмоция в изображаемый момент':'Актёрское задание — передать игрой, без озвучивания мыслей',stillPlan&&keyframe!=='middle'
      ? `${a.character}: ${keyframe==='end'?a.emotionEnd:a.emotionStart}`
      : videoPlan ? `${a.character}. ${[
        a.objective&&`Цель: ${a.objective}`,a.subtext&&`Подтекст: ${a.subtext}`,
        a.emotionStart&&`В начале: ${a.emotionStart}`,a.visibleAction&&`Развитие и видимая реакция: ${a.visibleAction}`,
        a.emotionEnd&&`В конце: ${a.emotionEnd}`,
      ].filter(Boolean).join('; ')}`
      : `${a.character}: ${a.visibleAction}. ${a.emotionStart} → ${a.emotionEnd}`,true,90);
  } else if (!(stillPlan && keyframe === 'end' && plan?.stateOut)) add('camera-legacy', input.kind === 'image' ? 'Ракурс ключевого кадра' : 'Камера', plan?.camera ?? plan?.cinematography, true);
  if(videoPlan){
    if((plan?.cast?.length||plan?.characterIds?.length||heroes.length)&&!direction?.performance?.length)warnings.push('В утверждённом сценарии этого плана нет отдельного актёрского задания. Общая настройка мимики не заменяет цель, подтекст и смену эмоций. Запустите «Доработать: Актёрская работа», проверьте и утвердите план, затем нажмите «Подготовить промпты и применить сценарий» перед новой видеогенерацией.');
    for(const actor of direction?.performance??[]){
      const fields={objective:'цель',subtext:'подтекст',visibleAction:'видимая реакция',emotionStart:'начальная эмоция',emotionEnd:'конечная эмоция'} as const;
      const missing=Object.entries(fields).filter(([field])=>{const value=actor[field as keyof typeof fields];return typeof value!=='string'||!value.trim();}).map(([,label])=>label);
      if(missing.length)warnings.push(`В актёрском задании героя «${actor.character}» не заполнены: ${missing.join(', ')}. Компилятор не выдумывает переживания: дополните задание в подробном сценарии и примените его перед новой видеогенерацией.`);
    }
  }
  optional('design', 'Художественное решение текущего плана', plan?.productionDesign, 90);
  for (const style of p.items.filter(i => i.stage === 2 && active(i) && approved(i))) {
    if (anchoredStill) exclude(`style.${style.id}`, 'Общее описание фильма — стиль уже задан первым изображением', approved(style)!.text);
    else {
      const original = approved(style)!.text;
      const visual = portrait ? portraitStyleText(p,heroes[0]?.profile,original) : stillPlan || videoPlan ? frameStyleText(original,
        locations.flatMap(card => [card.title, (approved(card) as WorldVariant)?.location?.name ?? (card as WorldItem).location?.name ?? '']),
        p.items.filter(card => card.stage === 3 && active(card) && !locations.some(l => l.id === card.id)).flatMap(card => [card.title, (approved(card) as WorldVariant)?.location?.name ?? (card as WorldItem).location?.name ?? ''])) : original;
      optional(`style.${style.id}`, 'Единый визуальный стиль фильма', visual, 95);
      if (portrait && !visual.trim()) warnings.push('Из документа визуального стиля не выделены отдельные указания о рисунке, палитре или свете. Сюжет и локации не переданы в портрет. При необходимости задайте стиль в правках к этой генерации.');
      if (visual !== original) omitted.push({key:`style-context.${style.id}`,label:'Сюжетные разделы и другие локации общего описания стиля',reason:'irrelevant',characters:Math.max(0,original.length-visual.length)});
    }
  }
  if (p.directing && !stillPlan && !videoPlan && !portrait) {
    const brief = effectiveCreativeBrief(p.directing.brief, scene?.creativeOverrides as CreativeOverrides | undefined);
    optional('creative', 'Творческое задание этой сцены', `Жанр: ${brief.genre}. Подход: ${brief.director}. Приёмы: ${brief.techniques}. Воздействие: ${brief.effect}.`, 75);
    if (brief.strengths) optional('creative-strengths', 'Сила выбранных приёмов', `Шкала 0–10: 0 — не применять приём, 10 — выраженно применять. Утверждённые события, внешность и состояние важнее интенсивности. ${JSON.stringify(brief.strengths)}`, 70);
  }
  const at = plans.findIndex(s => plan?.id ? s.id === plan.id : s.title === plan?.title);
  if (!stillPlan && !videoPlan && !portrait) {
    optional('previous', 'Только для стыковки — выход предыдущего плана', plans[at - 1]?.stateOut, 25);
    optional('next', 'Только для стыковки — вход следующего плана', plans[at + 1]?.stateIn, 25);
  }
  // Only the exact studio-generated repetition may be compressed. Manual instructions
  // are critical unless the caller supplies a separate, explicit director delta.
  const taskWithoutSeries = input.prompt.replace(/\n\nСоздай самостоятельный вариант \d+ из \d+, сохраняя обязательные признаки текущего плана\.$/, '').trim();
  const generatedTask = input.kind === 'video' ? videoPrompt(p, item) : item.stage === 5 ? storyboardPrompt(p, item) : '';
  const roleTask = stillPlan && !!input.keyframeInstruction?.trim() && taskWithoutSeries === input.keyframeInstruction.trim();
  const automaticStartTask = stillPlan && keyframe !== 'start' && !!generatedTask.trim() && taskWithoutSeries === generatedTask.trim();
  const defaultVideoWrapper = videoPlan && !((sourcePlan as PromptPlan & {videoPrompt?:string})?.videoPrompt) && taskWithoutSeries === generatedTask.trim();
  const preparedStillShot=currentStillState?p.directing?.scenes.flatMap(scene=>scene.shots).find(shot=>shot.id===sourcePlan?.id):undefined;
  const preparedStillStartTask=!!preparedStillShot?.promptBasis&&taskWithoutSeries===generatedTask.trim()&&preparedStillShot.imagePrompt?.trim()===taskWithoutSeries&&
    (sourcePlan as PromptPlan&{imagePrompt?:string})?.imagePrompt?.trim()===taskWithoutSeries;
  if (roleTask || automaticStartTask || defaultVideoWrapper || preparedStillStartTask) {
    omitted.push({key: 'task', label: preparedStillStartTask?'Повтор автоматически подготовленного первого кадра — состояние задано утверждённой постановкой':roleTask ? 'Повтор назначения ключевого кадра' : 'Автоматический промпт первого кадра — не относится к этому моменту', reason: roleTask||preparedStillStartTask ? 'duplicate' : 'irrelevant', characters: taskWithoutSeries.length});
    add('series', 'Вариант', input.prompt.match(/Создай самостоятельный вариант \d+ из \d+, сохраняя обязательные признаки текущего плана\.$/)?.[0], true);
  } else if (plan && (input.instruction?.trim() || taskWithoutSeries === generatedTask.trim())) {
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
  // The current film/approved shot setting is compiled for every new request,
  // including legacy shots with an older prepared prompt. Never read unapproved
  // shot edits or rewrite an already queued job to obtain this preference.
  if(plan&&staging)add('staging-policy','Читаемость действия и живое завершение',stagingPrompt(staging,input.kind),true);
  if(videoPlan&&p.directing?.brief.cameraPolicy)add('camera-policy','Политика работы камеры',cameraPolicyPrompt(p.directing.brief.cameraPolicy),true);
  if(visibleFaces)add('facial-expression','Актуальная выразительность мимики',facialExpressionPrompt(effectiveFacialExpression(p.directing?.brief.facialExpression,direction?.facialExpression)),true);

  const knownOwners = new Map<string, Item>();
  for (const card of p.items) for (const assetId of [...(card.character?.refs ?? []), ...card.variants.flatMap(v => v.assetId ? [v.assetId] : []),
    ...((card as WorldItem).location?.refs ?? []), ...((card as WorldItem).location?.approvedAngles.flatMap(a => a.refs) ?? [])]) knownOwners.set(assetId, card);
  const heroAssets = new Map(heroes.flatMap(h => [h.variant?.assetId, ...h.profile.refs].filter((id): id is string => !!id).map(assetId => [assetId, h] as const)));
  if (portrait && heroes[0]) for (const variant of item.variants)
    if (variant.kind === 'image' && variant.assetId) heroAssets.set(variant.assetId, heroes[0]);
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
    if (portrait && owner && owner.id !== item.id && !hero) {
      omitted.push({key:`ref.${id}`,label:'Другой герой, локация или материал фильма — не прообраз этого героя',reason:'irrelevant',assetId:id}); continue;
    }
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
  if ((input.kind === 'video' || anchoredStill) && !references.some(ref => ref.role === 'first-frame'))
    throw new PromptCompilationError('first_frame', 'Выберите первый кадр именно текущего плана. Он скрыт, удалён или относится к другой карточке.');
  if (input.kind === 'video' && endFrame && capability.adapter.lastFrame && !references.some(ref => ref.role === 'last-frame'))
    throw new PromptCompilationError('last_frame', 'Выберите конечный кадр именно текущего плана. Он скрыт, удалён или относится к другой карточке.');
  if (input.kind === 'image' && modelId === 'fal-qwen-image-edit-2511' && !references.length)
    throw new PromptCompilationError('references_required', 'Qwen Image Edit нужен хотя бы один относящийся к плану референс. Выберите героя, локацию или начальный кадр.');
  if (references.length > capability.adapter.maxImageReferences || input.kind === 'video' && references.filter(ref => ref.role !== 'first-frame' && ref.role !== 'last-frame').length > capability.adapter.maxAdditionalReferences)
    throw new PromptCompilationError('reference_count', `Выбрано ${references.length} подходящих изображений, но адаптер допускает ${capability.adapter.maxImageReferences}. Снимите лишние референсы или выберите другую модель; обязательные образы не исключаются автоматически.`);
  for (const [n, ref] of references.entries()) add(`ref-role.${n}`, `Изображение ${n + 1}`, ref.role === 'first-frame' ? anchoredStill
    ? 'Выбранный первый кадр текущего плана — визуальная основа для внешности, одежды, окружения и стиля. Начальные позы и положение предметов НЕ являются заданием для новой картинки. Изобрази только целевой момент, описанный в этом запросе; не копируй первый кадр целиком.'
    : 'Начальная композиция текущего плана; сохраняй лица и окружение.'
    : ref.role === 'last-frame' ? 'Конечная композиция текущего плана.' : ref.role === 'character' ? canonicalFace(ref)
      ? `Утверждённый образ героя ${ref.label} — основной образец его лица и внешности. Воспроизведи узнаваемые черты этого конкретного героя, а не похожий типаж. Он важнее исходных прообразов и стилизации. Не копируй позу или фон; костюм и текущее состояние задаёт постановка.`
      : `Исходный прообраз героя ${ref.label}, вспомогательный референс. Если приложен утверждённый образ этого героя, его лицо и внешность имеют приоритет. Не смешивай лица, не копируй позу или фон.`
    : ref.role === 'location' ? `Локация ${ref.label}; не переноси посторонних персонажей.` : ref.role === 'style' ? 'Только техника изображения, свет и цвет; не переносить чужих героев или композицию.' : portrait ? 'Выбранный режиссёром прообраз этого героя. Используй внешность; не копируй фон, окружение и других персонажей фотографии.' : 'Выбранный режиссёром прообраз только для текущего плана.', true);
  if (input.kind === 'video' && references.some(ref => ref.role === 'last-frame') && duration !== undefined && duration !== capability.duration!.requestedSeconds)
    warnings.push(`Модель запрашивается на ${capability.duration!.requestedSeconds} сек, а план рассчитан на ${duration} сек. Конечный кадр закреплён в конце полного клипа. Обрезка конца может убрать выбранную композицию; проверьте фактическое время перед монтажом.`);
  if (capability.adapter.nativeAudio === 'possible') warnings.push('Модель может создать свой звук. Утверждённая озвучка накладывается отдельно; промпт запрещает самостоятельную речь и пение.');
  if (capability.duration?.variableResult) warnings.push('Фактическая длительность результата может отличаться от запрошенной; проверьте файл перед озвучкой и монтажом.');

  // Deduplicate static facts across their approved sources, not action beats:
  // taking / returning / taking an object again must remain distinct actions.
  const originalCharacters=render(sections).length,staticFacts = new Set<string>();
  for (const section of sections) {
    if (!/^(?:hero\.|hero-source\.|hero-locked\.|continuity\.|location-identity\.|location-geography\.|style\.|design$)/.test(section.key)) continue;
    const original=section.text;
    const heroScope=section.key.match(/^(?:hero|hero-source|hero-locked|continuity)\.(.+)$/)?.[1];
    const locationScope=section.key.match(/^location-(?:identity|geography)\.([^.]+)/)?.[1];
    const scope=heroScope?`hero:${heroScope}`:locationScope?`location:${locationScope}`:'visual';
    section.text=compactPromptText(original).split(/(?<=[.!?])\s+(?=[А-ЯA-Z«“])|\n\s*\n/gu).filter(fact=>{
      const value=fact.trim().replace(/\s+/g,' '),key=scope+'\n'+value;
      if(!value||staticFacts.has(key))return false;
      staticFacts.add(key);return true;
    }).join(' ');
    if(section.text!==original)omitted.push({key:`duplicate.${section.key}`,label:section.label,reason:'duplicate',characters:original.length-section.text.length});
  }
  const seenTexts=new Set<string>();
  const included=sections.filter(section=>{
    if(!section.text)return false;
    if(!section.required&&seenTexts.has(section.text)){omitted.push({key:section.key,label:section.label,reason:'duplicate',characters:section.text.length});return false;}
    seenTexts.add(section.text);return true;
  });
  const criticalText = render(included.filter(s => s.required));
  const prompt=render(included),used=promptSize(prompt,{unit:capability.promptUnit}),needsOptimization=!fitsPrompt(prompt,{...promptCapacity(modelId,input.kind),limit});
  if(needsOptimization)warnings.push(capability.promptUnit==='tokens'
    ? 'Перед отправкой сервер проверит токены. LLM сократит промпт только при превышении лимита. Если API не поддерживает подсчёт, используется консервативная верхняя граница по UTF-8.'
    : 'Промпт превышает лимит. Перед генерацией подключённая текстовая LLM сократит его, сохранив обязательные детали. Это отдельный платный запрос в журнале.');
  return {prompt,references,criticalText,capability,sections:included,
    budget:{limit,unit:capability.promptUnit,used,needsOptimization,source:input.providerPromptLimit!==undefined?'Проверенный лимит каталога API':capability.limitSource,
      criticalCharacters:criticalText.length,originalCharacters,compiledCharacters:prompt.length,remaining:limit-used},
    compression:{shortened:prompt.length<originalCharacters,omitted,includedKeys:included.map(s=>s.key)},warnings:[...new Set(warnings)]};
}
