import { chosen, dependencies, id, makeVariant, type Item, type Project, type Variant } from './domain';
import { scriptVideo, syncVideoPlans, videoShot } from './video';
import { planSpeech } from './plan-speech';
import { speechInfo, speechDirection } from './speech-mode';
import { reconcilePlanStage, planKey } from './plan-sync';
import { parseShots } from './shots';

export function preparePlanCards(p: Project) {
  const script = scriptVideo(p,true);
  if (!script.source) throw new Error(script.message);
  if (p.jobs.some(j => ['queued', 'pending', 'dispatching', 'saving'].includes(j.status)))
    throw new Error('Дождитесь текущей серии перед подготовкой карточек.');
  let changed = reconcilePlanStage(p,5,script);
  for (const shot of script.shots) {
    const frame=p.items.find(i=>i.stage===5&&!i.planArchive&&i.sourceShot?.scriptId===script.source!.id&&i.sourceShot.title===shot.title);
    if(!frame)continue;
    const selected=chosen(frame);
    let generatedDraft=!!selected?.planDraft;
    // Migrate untouched automatic descriptions from older app versions. Manual
    // edits are identified by comparing the original source snapshot, not title alone.
    if(selected&&!selected.assetId&&!selected.jobId&&selected.kind==='text'&&selected.title==='Описание плана из сценария'&&selected.shotSource){
      try {
        const old=p.items.flatMap(i=>i.stage===4?i.variants:[]).find(v=>v.id===selected.shotSource);
        const previous=old&&parseShots(old.text,p.seconds).find(s=>planKey(s.title)===planKey(shot.title));
        generatedDraft ||= !!previous&&['description','duration','camera','dialogue','continuity'].every(k=>(k==='description'?selected.text:(selected as any)[k])===(previous as any)[k])&&JSON.stringify(speechInfo(selected))===JSON.stringify(speechInfo(previous));
      } catch { /* Preserve descriptions whose provenance cannot be verified. */ }
    }
    if (!frame.variants.length || (generatedDraft&&selected?.shotSource!==script.variant!.id)) {
      const draft = makeVariant(p, frame, { title: 'Описание плана из сценария', text: shot.description,
        kind: 'text', duration: shot.duration, camera: shot.camera, dialogue: shot.dialogue,
        ...speechInfo(shot),
        continuity: shot.continuity, shotSource: script.variant!.id, planDraft:true });
      frame.variants.push(draft);
      frame.selectedId = draft.id;
      changed = true;
    }
  }
  return syncVideoPlans(p) || changed;
}

export function planFields(p: Project, item: Item, value?: Variant) {
  const shot = [5, 7].includes(item.stage) ? videoShot(p, item) : undefined;
  const currentVersion=scriptVideo(p).variant?.id;
  if(shot&&item.stage===5&&value?.kind==='image'&&value.jobId&&value.shotSource&&value.shotSource!==currentVersion)
    return {...speechInfo(shot),duration:shot.duration,camera:shot.camera,continuity:shot.continuity,dialogue:shot.dialogue,shotSource:currentVersion};
  const legacy = !value?.shotSource && (!value || !!value.jobId);
  const defaults = {
    ...planSpeech(p,item,value),
    duration: value?.duration ?? shot?.duration ?? 5,
    camera: value?.camera ?? shot?.camera ?? 'Статичная камера',
    continuity: value?.continuity ?? shot?.continuity ?? '',
    dialogue: value?.dialogue ?? shot?.dialogue ?? '',
  };
  if (!shot) return { ...defaults, shotSource: value?.shotSource };
  return {
    ...planSpeech(p,item,value),
    duration: legacy ? shot.duration : defaults.duration,
    camera: legacy && (!value?.camera || value.camera === 'Статичная камера') ? shot.camera : defaults.camera,
    continuity: legacy && !value?.continuity ? shot.continuity : defaults.continuity,
    dialogue: legacy && !value?.dialogue ? shot.dialogue : defaults.dialogue,
    shotSource: value?.shotSource ?? scriptVideo(p).variant?.id,
  };
}

export function storyboardPrompt(p: Project, item: Item) {
  const shot = videoShot(p, item);
  if (!shot) return '';
  if(shot.imagePrompt)return shot.imagePrompt;
  const v = chosen(item), fields = planFields(p, item, v);
  // A saved image brief may already be our complete task. Refresh only its
  // known metadata footer; keep the action and any appended director notes.
  if(v?.text?.startsWith('Создай одно цельное изображение — первый кадр плана')&&(!v.jobId||v.kind==='text')){
    const cameraAt=v.text.lastIndexOf('\nКамера (покажи начальный ракурс): ');
    const continuityAt=v.text.indexOf('\nСтыковка: ',cameraAt);
    const speechAt=['\nРечь звучит только за кадром','\nПлан без речи.','\nРеплику произносит в кадре'].map(s=>v.text.indexOf(s,continuityAt)).filter(n=>n>=0).sort((a,b)=>a-b)[0];
    if(cameraAt>=0&&continuityAt>cameraAt&&speechAt>continuityAt){
      const ending=v.text.startsWith('\nРеплику',speechAt)?'не добавляй свою речь, пение или субтитры.':'Не добавляй голос или субтитры.';
      const end=v.text.indexOf(ending,speechAt);
      if(end>=0)return `${v.text.slice(0,cameraAt)}\nКамера (покажи начальный ракурс): ${fields.camera}\nСтыковка: ${fields.continuity}\n${speechDirection(fields)}${v.text.slice(end+ending.length)}`;
    }
    return v.text;
  }
  const description = v?.text && (v.kind === 'text' || !v.jobId) ? v.text : shot.description;
  return `Создай одно цельное изображение — первый кадр плана «${shot.title}» для анимационного фильма. Не рисуй комикс, коллаж, несколько панелей или стрелки камеры. Покажи начальное состояние действия. Сохрани утверждённые внешность персонажей, одежду и визуальный стиль.\n\nДействие: ${description}\nКамера (покажи начальный ракурс): ${fields.camera}\nСтыковка: ${fields.continuity}\n${speechDirection(fields)}`;
}

export function storyboardBatchPlans(p: Project) {
  return p.items.filter(i => i.stage === 5 && videoShot(p, i)).map(item => ({
    item, hasImage: item.variants.some(v => v.kind === 'image' && v.assetId),
    blocked: p.jobs.some(j => j.itemId === item.id && ['queued', 'dispatching', 'pending', 'saving', 'unknown'].includes(j.status))
      ? 'Дождитесь результата или проверьте попытку с неизвестным исходом.'
      : chosen(item) && chosen(item)!.deps !== dependencies(p, 5)
        ? 'Основа изменилась. Обновите выбранное описание через «Правки».' : '',
  }));
}
