import {z} from 'zod';
import type {Project,Variant} from './domain';
import type {Scene,DirectingShot} from './directing';

const fact=z.string().trim().min(1).max(400);
export const storyMeaningSchema=z.object({
  id:z.string().trim().min(1).max(100),title:z.string().trim().min(1).max(100),
  kind:z.enum(['setup','turn','climax','resolution','support']),priority:z.enum(['required','supporting']),
  viewerBefore:fact,viewerAfter:fact,event:fact,stakes:fact,
  evidence:z.array(z.string().trim().min(1).max(300)).min(1).max(4),
}).strict();
export type StoryMeaning=z.infer<typeof storyMeaningSchema>;
export const storyMeaningsSchema=z.array(storyMeaningSchema).max(20)
  .refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Смыслы должны иметь уникальные ID.')
  .refine(rows=>JSON.stringify(rows).length<=18000,'Карта смыслов должна быть краткой: не более 18 000 символов.');
export const meaningIdsSchema=z.array(z.string().trim().min(1).max(100)).max(20)
  .refine(ids=>new Set(ids).size===ids.length,'Ссылки на смыслы не должны повторяться.');

function stable(value:unknown):string{return Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(value)??'null';}
function fingerprint(value:unknown){let a=2166136261,b=5381;for(const c of stable(value)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);}
function screenplaySource(p:Project){const item=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive),variant=item?.variants.find(v=>v.id===item.approvedId);return variant?{itemId:item!.id,variantId:variant.id,text:variant.text}:undefined;}
export function storyMeaningBasis(p:Project){return fingerprint({screenplay:screenplaySource(p),meanings:p.directing?.storyMeanings??[]});}
export function storyMeaningsApproved(p:Project){return !!screenplaySource(p)&&!!p.directing?.storyMeanings?.length&&!!p.directing.storyMeaningsApproved&&p.directing.storyMeaningsApproved===storyMeaningBasis(p);}
export function storyMeaningPublicationCurrent(p:Project){
  if(!p.directing?.storyMeaningsApproved)return true;
  if(!storyMeaningsApproved(p))return false;
  const item=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive),source=item?.variants.find(v=>v.id===item.approvedId);
  try{return JSON.parse((source?.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')).storyMeaningBasis===storyMeaningBasis(p);}catch{return false;}
}
export function variantStoryMeanings(variant?:Variant):StoryMeaning[]|undefined{
  const settings=variant?.versionInfo?.settings;if(!settings||typeof settings!=='object'||Array.isArray(settings))return;
  const parsed=storyMeaningsSchema.safeParse((settings as {storyMeanings?:unknown}).storyMeanings);return parsed.success?structuredClone(parsed.data):undefined;
}
export function screenplayStoryMeanings(p:Project){const item=p.items.find(i=>i.stage===0&&!i.removedAt&&!i.planArchive);return variantStoryMeanings(item?.variants.find(v=>v.id===item.approvedId))??[];}

/** Explicit shot links only. A scene's list does not belong in every short clip.
 * An exported version carrying meaningIds (including []) keeps those exact links. */
export function storyMeaningsForShot(p:Project,shot?:{id?:string;meaningIds?:string[]}):StoryMeaning[]{
  if(!shot)return [];
  const ids=shot.meaningIds??p.directing?.scenes.flatMap(s=>s.shots).find(s=>s.id===shot.id)?.meaningIds??[];
  return (p.directing?.storyMeanings??[]).filter(meaning=>ids.includes(meaning.id));
}
export function storyMeaningContext(p:Project,shot?:{id?:string;meaningIds?:string[]}){return {approved:storyMeaningsApproved(p),meanings:shot?storyMeaningsForShot(p,shot):p.directing?.storyMeanings??[]};}
/** Conditional shape keeps every pre-feature approval hash unchanged. */
export function storyMeaningApprovalContext(p:Project,shot?:{id?:string;meaningIds?:string[]}){
  if(!p.directing?.storyMeaningsApproved)return {};
  return {storyMeaningApproval:{approved:storyMeaningsApproved(p),screenplay:screenplaySource(p),meanings:shot?storyMeaningsForShot(p,shot):p.directing.storyMeanings??[]}};
}
export function assertMeaningLinks(p:Project,ids?:string[]){
  const known=new Set(p.directing?.storyMeanings?.map(v=>v.id));
  for(const key of ids??[])if(!known.has(key))throw Error(`Смысл «${key}» отсутствует в карте. Обновите связи.`);
}
export type MeaningCoverageIssue={meaningId?:string;sceneId?:string;shotId?:string;severity:'note'|'conflict';message:string};
export function meaningCoverage(p:Project){
  const meanings=p.directing?.storyMeanings??[],scenes=p.directing?.scenes??[],known=new Set(meanings.map(m=>m.id));
  const issues:MeaningCoverageIssue[]=[],active=!!p.directing?.storyMeaningsApproved;
  const severity=active?'conflict':'note';
  if(active&&!storyMeaningsApproved(p))issues.push({severity:'conflict',message:'Карта смыслов или утверждённый сценарий изменились. Сверьте и снова утвердите смыслы истории.'});
  for(const scene of scenes){
    for(const meaningId of scene.meaningIds??[])if(!known.has(meaningId))issues.push({meaningId,sceneId:scene.id,severity,message:`«${scene.title}»: неизвестный смысл «${meaningId}».`});
    for(const shot of scene.shots)for(const meaningId of shot.meaningIds??[]){
      if(!known.has(meaningId))issues.push({meaningId,sceneId:scene.id,shotId:shot.id,severity,message:`«${shot.title}»: неизвестный смысл «${meaningId}».`});
      else if(!scene.meaningIds?.includes(meaningId))issues.push({meaningId,sceneId:scene.id,shotId:shot.id,severity,message:`«${shot.title}»: назначьте смысл «${meanings.find(m=>m.id===meaningId)!.title}» также сцене.`});
      if(!shot.direction?.narrativeBeat?.visibleEvidence.trim())issues.push({meaningId,sceneId:scene.id,shotId:shot.id,severity,message:`«${shot.title}»: укажите экранное подтверждение смысла в narrativeBeat.visibleEvidence.`});
    }
  }
  const rows=meanings.map(meaning=>{
    const linkedScenes=scenes.filter(s=>s.meaningIds?.includes(meaning.id));
    const shots=linkedScenes.flatMap(s=>s.shots.filter(shot=>shot.meaningIds?.includes(meaning.id)&&!!shot.direction?.narrativeBeat?.visibleEvidence.trim()));
    const covered=linkedScenes.length>0&&shots.length>0;
    if(meaning.priority==='required'&&!covered)issues.push({meaningId:meaning.id,severity,message:`«${meaning.title}»: обязательный смысл должен иметь сцену и план с экранным подтверждением.`});
    return {meaningId:meaning.id,title:meaning.title,priority:meaning.priority,sceneIds:linkedScenes.map(s=>s.id),shotIds:shots.map(s=>s.id),covered};
  });
  return {required:rows.filter(r=>r.priority==='required').length,covered:rows.filter(r=>r.priority==='required'&&r.covered).length,rows,issues};
}
/** First-time drafts and legacy films are advisory. Once approved, stale maps and
 * missing required coverage block publication. Per-shot approval remains local. */
export function assertStoryMeaningCoverage(p:Project,scene?:Scene,shot?:DirectingShot){
  if(!p.directing?.storyMeaningsApproved)return;
  const coverage=meaningCoverage(p),issue=coverage.issues.find(i=>i.severity==='conflict'&&(!scene||!i.meaningId||i.sceneId===scene.id&&(!shot||!i.shotId||i.shotId===shot.id)||!i.sceneId&&scene.meaningIds?.includes(i.meaningId)));
  if(issue)throw Error(issue.message);
}
export function saveStoryMeanings(p:Project,input:unknown){
  const meanings=storyMeaningsSchema.parse(input);if(!p.directing)throw Error('Сначала сохраните творческое задание.');
  // Keep the old signature: editing an already approved map must require review,
  // never silently fall back to the permissive first-draft/legacy path.
  p.directing.storyMeanings=meanings;return meanings;
}
export function approveStoryMeanings(p:Project){
  if(!p.directing?.storyMeanings?.length)throw Error('Сначала добавьте смыслы истории.');
  storyMeaningsSchema.parse(p.directing.storyMeanings);
  if(!screenplaySource(p))throw Error('Сначала утвердите общий сценарий.');
  p.directing.storyMeaningsApproved=storyMeaningBasis(p);
}
export const STORY_MEANING_INSTRUCTION=' Смысл истории — изменение понимания зрителя, а не перечень физических действий. Покажи, что зритель знает/ожидает до события (viewerBefore), что должен понять после (viewerAfter), само наблюдаемое событие (event), его цену и значимость (stakes), конкретные экранные доказательства (evidence). Не считай знание исходного произведения данностью. Различай завязку setup, поворот turn, кульминацию climax, развязку resolution и поддержку support только там, где они есть в этой истории: короткий фильм не обязан заполнять все роли или трёхактную схему. Обязательные смыслы required сохраняются при экономии и сокращении; supporting служат выразительности. Моргание, красивая деталь или формальное действие сами по себе не раскрывают смысл. Утверждённую карту нельзя менять по инициативе специалиста; отсутствие причины/экранного доказательства отметь конкретным замечанием. Не превращай внутренний смысл в новую речь, надписи или неутверждённое событие.';
export const STORY_MEANING_REVIEW=' Проверь понимание зрителя по каждому required-смыслу: где установлено viewerBefore, где показано event, какими наблюдаемыми признаками доказаны viewerAfter и stakes. Ссылки meaningIds — маршрут проверки, но не доказательство: проверь реальное story, постановку, масштаб и время на распознавание. Формально заполненные поля не заменяют экранного результата. Потеря обязательного смысла, включая подготовку развязки, — conflict с конкретным решением. Не требуй придуманную кульминацию от истории, которой она не нужна. Согласуй монтажные слияния и удаления с покрытием; сохраняй meaningIds удерживаемых событий.';
export const STORY_MEANING_EXTRACTION='Выдели из утверждённого общего сценария 1–20 смысловых опор. Это предложение карты для режиссёра, не автоматическое утверждение и не переписывание сценария. Если ранее передана карта, сохраняй ID опор с тем же смыслом. Не придумывай причин, ставок или событий; недостаток исходных данных явно опиши в соответствующем поле. Не более 18 000 символов суммарно. Верни {"meanings":[{"id":"meaning-1","title":"краткое название","kind":"setup|turn|climax|resolution|support","priority":"required|supporting","viewerBefore":"что зритель знает/ожидает до","viewerAfter":"что должен понять после","event":"наблюдаемое событие","stakes":"почему это важно","evidence":["конкретный видимый признак"]}]}. Каждое текстовое поле до 400 символов, title до 100, 1–4 evidence до 300 символов каждый.';
