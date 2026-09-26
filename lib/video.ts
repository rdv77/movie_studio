import { planCharacterIds } from './plan-references';
import { id, isApproved, excludedShot, type Item, type Project } from './domain';
import { parseShots } from './shots';
import { MODELS } from './models';
import { chosen } from './domain';
import { planSpeech } from './plan-speech';
import { withSpeechDirection } from './speech-mode';
import { withCharacterIdentity } from './characters';
import { reconcilePlanStage } from './plan-sync';
import { orderedScriptShots } from './plan-order';

export function selectedVideoModel(p: Project, item: Item) {
  const v = chosen(item);
  // Only the model identity is reused. New jobs get current prompts, refs and dependencies.
  if (item.planArchive || item.stage !== 7 || !v?.assetId || v.kind !== 'video') return undefined;
  return MODELS.find(m => m.kind === 'video' && m.id === v.model);
}
export function remainingVideoPlans(p: Project) {
  return p.items.filter(i => i.stage === 7 && videoShot(p, i) &&
    !i.variants.some(v => v.kind === 'video' && v.assetId) &&
    !p.jobs.some(j => j.itemId === i.id && ['queued', 'dispatching', 'pending', 'saving', 'unknown'].includes(j.status)));
}

// A common application limit; MiniMax's video API accepts at most 2000 characters.
export const VIDEO_PROMPT_LIMIT = 2000;
export function scriptVideo(p: Project, includeExcluded = false) {
  const source = p.items.find(i => i.stage === 4 && isApproved(p, i));
  if (!source) return { shots: [], message: 'Утвердите подробный сценарий.' };
  try {
    const variant = source.variants.find(v => v.id === source.approvedId)!;
    const parsed = orderedScriptShots(p,source.id,parseShots(variant.text, p.seconds));
    const shots = includeExcluded ? parsed : parsed.filter(s=>!excludedShot(p,source.id,s.title));
    if (new Set(shots.map(s => s.title)).size !== shots.length)
      throw new Error('Названия планов в сценарии должны быть разными.');
    return { shots, source, variant, message: '' };
  } catch (e) {
    return { shots: [], message: e instanceof Error ? e.message : String(e) };
  }
}
export function videoShot(p: Project, item: Item) {
  if(item.planArchive)return undefined;
  const script = scriptVideo(p);
  if (item.sourceShot && item.sourceShot.scriptId !== script.source?.id) return undefined;
  return script.shots.find(s => s.title === (item.sourceShot?.title ?? item.title));
}
export function syncVideoPlans(p: Project) {
  const script = scriptVideo(p,true);
  if (!script.source) throw new Error(script.message);
  if (p.jobs.some(j => ['queued', 'dispatching', 'pending', 'saving'].includes(j.status)))
    throw new Error('Дождитесь текущей серии перед подготовкой планов.');
  let changed = reconcilePlanStage(p,7,script);
  changed = reconcilePlanStage(p,6,script,false) || changed;
  return changed;
}
export function videoPrompt(p: Project, item: Item) {
  const script = scriptVideo(p), shot = videoShot(p, item);
  if (!shot) return '';
  if(shot.videoPrompt)return shot.videoPrompt;
  const index = script.shots.findIndex(s => s.title === shot.title);
  const sections = [
    `Анимационный фильм. Сохрани внешность героев, одежду, палитру и стиль первого кадра. Формат ${p.format}.`,
    `План: ${shot.title}. Заверши действие за ${shot.duration} с; затем удерживай финальную позу до конца клипа.`,
    `Действие: ${shot.description}`,
    `Камера: ${shot.camera}`,
    ...(shot.productionDesign?[`Художественное решение: ${shot.productionDesign}`]:[]),
    `Непрерывность и монтаж: ${shot.continuity}`,
    `Предыдущий план: ${script.shots[index - 1]?.title ?? 'начало фильма'}. Следующий: ${script.shots[index + 1]?.title ?? 'конец фильма'}.`,
  ];
  // Never cut action/camera instructions silently. A long source requires director edits.
  return sections.join('\n\n');
}
export function videoGenerationPrompt(p: Project, item: Item, prompt: string, characterIds?:string[]) {
  const shot=videoShot(p,item);
  if(shot?.videoPrompt&&prompt.trim()===shot.videoPrompt.trim())return withSpeechDirection(prompt,planSpeech(p,item));
  return withSpeechDirection(withCharacterIdentity(p,prompt,planCharacterIds(p,item,characterIds)),planSpeech(p,item));
}
export function videoFrame(p: Project, item: Item) {
  const title = item.sourceShot?.title ?? item.title;
  const frame = p.items.find(i => i.stage === 5 &&
    (i.sourceShot ? i.sourceShot.scriptId === item.sourceShot?.scriptId && i.sourceShot.title === title : i.title === title) && isApproved(p, i));
  const variant = frame?.variants.find(v => v.id === frame.approvedId && v.kind === 'image');
  return variant?.assetId;
}
export function videoFrameOptions(p: Project, item: Item) {
  const title = item.sourceShot?.title ?? item.title;
  const cards = p.items.filter(i => !i.planArchive && (i.id === item.id || (i.stage === 5 &&
    (i.sourceShot ? i.sourceShot.scriptId === item.sourceShot?.scriptId && i.sourceShot.title === title : i.title === title))));
  const images = new Map<string, {assetId: string; title: string; model: string; approved: boolean}>();
  for (const card of cards) for (const v of card.variants) {
    if (v.kind !== 'image' || !v.assetId) continue;
    const approved = card.approvedId === v.id && isApproved(p, card);
    const existing = images.get(v.assetId);
    if (existing) existing.approved ||= approved;
    else images.set(v.assetId, {assetId: v.assetId, title: v.title, model: v.model, approved});
  }
  return [...images.values()];
}
