import { chosen, dependencies, getItem, isApproved, stageReady,variantCurrent, type Project, type Job, type Variant, type Item } from './domain';
import { videoShot } from './video';
import { speechInfo } from './speech-mode';
import { spokenText } from './spoken-text';

export function originalLipsyncVideo(item: Item) {
  let video = chosen(item);
  const seen = new Set<string>();
  while (video?.lipsync && video.lipsync.inputType !== 'image' && !seen.has(video.id)) {
    seen.add(video.id);
    const sourceId = video.lipsync.videoVariantId;
    const original = item.variants.find(v => v.id === sourceId && v.kind === 'video' && v.assetId);
    if (!original) break;
    video = original;
  }
  if (video?.kind === 'video' && video.assetId) return video.id;
  const videos = item.variants.filter(v => v.kind === 'video' && v.assetId);
  return videos.length === 1 ? videos[0].id : '';
}

export const SYNC_FILE_LIMIT = 19 * 1024 * 1024;
export const SYNC_PAIR_LIMIT = 25 * 1024 * 1024;
export function hasCurrentLipsyncVisuals(p: Project, video: Variant) {
  const item=p.items.find(i=>i.stage===7&&i.variants.some(v=>v.id===video.id));
  if(video.reviewBasis&&item)return variantCurrent(p,item,video);
  if (video.deps === dependencies(p,7)) return true;
  // Voice replacement is an input to this operation, not a reason to regenerate
  // the source footage. Keep the scenario, character and storyboard checks.
  try {
    const previous = JSON.parse(video.deps);
    if (!Array.isArray(previous)) return false;
    const speechItems = new Set(p.items.filter(i=>i.stage===6).map(i=>i.id));
    const visual = previous.filter((entry,n)=>n===0 || !Array.isArray(entry) || !speechItems.has(entry[0]));
    return JSON.stringify(visual) === dependencies(p,6);
  } catch { return false; }
}
function lipsyncAudioSource(p: Project, itemId: string) {
  const item = getItem(p, itemId);
  if (p.speechMode !== 'plans') throw new Error('Сначала подготовьте и утвердите озвучку по планам.');
  if (item.planArchive || item.stage !== 7 || !item.sourceShot) throw new Error('Выберите актуальный видеоплан, связанный со сценарием.');
  if (p.jobs.some(j=>j.itemId===itemId && j.lipsync && j.status==='unknown' && j.actual===null))
    throw new Error('Есть попытка sync.so с неизвестным исходом. Сначала сверьте её в журнале расходов.');
  if (!stageReady(p, 7)) throw new Error('Утвердите актуальные раскадровку и озвучку.');
  const audioItem = p.items.find(i => i.stage === 6 && !i.planArchive && i.sourceShot?.scriptId === item.sourceShot!.scriptId && i.sourceShot?.title === item.sourceShot!.title);
  const audio = audioItem?.variants.find(v => v.id === audioItem.approvedId);
  if (!audioItem || !isApproved(p, audioItem) || audio?.kind !== 'audio' || !audio.assetId)
    throw new Error('Для этого плана нет утверждённой аудиозаписи.');
  const selectedAudio = chosen(audioItem);
  if (selectedAudio?.kind === 'audio' && selectedAudio.id !== audio.id)
    throw new Error('Выбран новый голос, но утверждён прежний. В разделе «Голоса и аниматик» нажмите «Утвердить выбранные новые голоса».');
  if (audio.volume <= 0) throw new Error('Громкость реплики равна нулю. Исправьте озвучку.');
  if (speechInfo({...audio,dialogue:audio.dialogue||audio.text}).speechType!=='character')
    throw new Error('У этого плана закадровый голос или нет речи: губы синхронизировать не нужно. Если герой должен говорить в кадре, в «Голоса и аниматик» откройте «Правки», выберите «Герой в кадре», укажите имя и утвердите вариант.');
  if (!audio.speaker?.trim() || !spokenText(audio.dialogue,[audio.speaker])) throw new Error('Для синхронизации укажите имя говорящего и произносимый текст реплики в озвучке, затем утвердите вариант.');
  return { item, audioItem, audio };
}
export function lipsyncSource(p: Project, itemId: string, videoId?: string) {
  const source = lipsyncAudioSource(p, itemId), { item } = source;
  const video = videoId ? item.variants.find(v => v.id === videoId) : chosen(item);
  if (!video?.assetId || video.kind !== 'video') throw new Error('Выберите готовый видеоролик этого плана.');
  if (!hasCurrentLipsyncVisuals(p,video)) throw new Error('Сценарий, герои или раскадровка изменились после создания видео. Откройте этот видеоплан, проверьте ролик через «Правки» и сохраните актуальный вариант.');
  return { ...source, video };
}
export function lipsyncImageSource(p: Project, itemId: string) {
  const source = lipsyncAudioSource(p, itemId), { item } = source;
  const imageItem = p.items.find(i => i.stage === 5 && !i.planArchive && i.sourceShot?.scriptId === item.sourceShot!.scriptId && i.sourceShot.title === item.sourceShot!.title);
  const image = imageItem?.variants.find(v => v.id === imageItem.approvedId);
  if (!imageItem || !isApproved(p, imageItem) || image?.kind !== 'image' || !image.assetId)
    throw new Error('Утвердите отдельное изображение этого плана в раскадровке.');
  const selected = chosen(imageItem);
  if (selected?.kind === 'image' && selected.id !== image.id)
    throw new Error('В раскадровке выбран новый кадр, но утверждён прежний. Сначала утвердите нужное изображение.');
  return { ...source, imageItem, image, duration: image.duration };
}
export const SYNC_IMAGE_PROMPT_LIMIT = 2000;
export function lipsyncImagePrompt(p: Project, item: Item) {
  const shot = videoShot(p, item);
  // Replace the earlier off-screen-speech direction for this explicitly selected talking shot.
  const visibleSpeech = (text: string) => text.split(/(?<=[.!?])\s+/u)
    .filter(s => !/рты\s+(?:всех\s+персонажей\s+)?закрыты|рот\s+закрыт|речь\s+.*за\s+кадром|mouths?\s+closed|voice.?over/i.test(s)).join(' ');
  return ['Animate the selected character speaking naturally to the supplied audio. Keep the same characters, clothes and animation style. Keep the selected face visible throughout the line. Do not add subtitles.',
    shot ? `Действие: ${visibleSpeech(shot.description)}` : '',
    shot ? `Камера: ${shot.camera}` : '',
    shot ? `Стыковка: ${shot.continuity}` : '',
  ].filter(Boolean).join('\n\n');
}
export function lipsyncImageSeconds(duration: number, audio: Variant, audioSeconds: number) {
  const speech = audioSeconds - audio.trim;
  if (!Number.isFinite(speech) || speech <= 0 || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Не удалось прочитать длительность плана или реплики.');
  const seconds = Math.ceil(Math.max(duration, speech) * 24 - 1e-8) / 24;
  if (seconds > 15) throw new Error('Для пробной синхронизации разделите план на фрагменты до 15 секунд.');
  return seconds;
}
export function lipsyncSeconds(video: Variant, audio: Variant, videoSeconds: number, audioSeconds: number) {
  const speech = audioSeconds - audio.trim;
  if (!Number.isFinite(speech) || speech <= 0) throw new Error('Не удалось прочитать длительность реплики.');
  const seconds = Math.ceil(Math.max(video.duration, speech) * 24 - 1e-8) / 24;
  if (seconds > 15) throw new Error('Для пробной синхронизации разделите план на фрагменты до 15 секунд.');
  if (!Number.isFinite(videoSeconds) || videoSeconds - video.trim + 0.001 < seconds)
    throw new Error(`Не хватает видео для полной реплики: нужно ${seconds.toFixed(2)} сек. Выберите более длинный ролик.`);
  return seconds;
}
export function lipsyncEstimate(rate: string, seconds: number, inputType: 'video' | 'image' = 'video') {
  // An image has no source frame rate. Use the published 25 fps reference,
  // conservatively rounding up output frames; actual billing remains unknown.
  if (inputType === 'image') return ((BigInt(rate) * BigInt(Math.ceil(seconds * 25 - 1e-8)) + 24n) / 25n).toString();
  // Published per-second rates assume 25 fps; our prepared media uses 24 fps.
  const frames = Math.ceil(seconds * 24 - 1e-8);
  return ((BigInt(rate) * BigInt(frames) + 24n) / 25n).toString();
}
export function assertLipsyncJob(p: Project, job: Job) {
  if (!job.lipsync) return;
  const source = job.lipsync.inputType === 'image' ? lipsyncImageSource(p, job.itemId) : lipsyncSource(p, job.itemId, job.lipsync.videoVariantId);
  if (job.lipsync.inputType === 'image' && 'image' in source &&
    (source.image.id !== job.lipsync.imageVariantId || source.imageItem.id !== job.lipsync.imageItemId))
    throw new Error('Утверждённый кадр изменился. Подготовьте генерацию заново.');
  if (source.audioItem.id !== job.lipsync.audioItemId || source.audio.id !== job.lipsync.audioVariantId)
    throw new Error('Утверждённая реплика изменилась. Подготовьте синхронизацию заново.');
}
