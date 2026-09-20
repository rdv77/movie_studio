import { chosen, isApproved, participates, excludedShot, type Item, type Project } from './domain';
import { parseShots } from './shots';
import { spokenText } from './spoken-text';
import { scriptVideo } from './video';
import { planSpeech } from './plan-speech';
import { speechInfo, type SpeechInfo } from './speech-mode';

export function speechPlans(p: Project) {
  const script = scriptVideo(p);
  if (!script.source || !script.variant) throw new Error(script.message);
  let offset = 0;
  return p.items.filter(i => i.stage === 5 && participates(p,i)).map(frame => {
    const title = frame.sourceShot?.title ?? frame.title;
    const shot = script.shots.find(s => s.title === title);
    if (!shot || (frame.sourceShot && frame.sourceShot.scriptId !== script.source!.id))
      throw new Error('Обновите карточки раскадровки из текущего сценария.');
    const image = frame.variants.find(v => v.id === frame.approvedId);
    const duration = image?.duration ?? shot.duration;
    const start = offset; offset += duration;
    const item = p.items.find(i => i.stage === 6 && !i.planArchive && i.sourceShot?.scriptId === script.source!.id && i.sourceShot.title === title);
    const blocked = !!item && p.jobs.some(j => j.itemId === item.id && ['queued','dispatching','pending','saving','unknown'].includes(j.status));
    const current=item ? chosen(item) : undefined;
    const edited=current?.kind==='audio'&&!!current.dialogue.trim()?current:undefined;
    const info=edited?speechInfo(edited):planSpeech(p,frame,image);
    const text=edited?edited.dialogue:image?.speechType ? image.dialogue : shot.dialogue;
    return { frameId: frame.id, title, ...info, dialogue: info.speechType==='none'?'':spokenText(text, [...speechCharacters(p),info.speaker]), duration,
      offset: start, scriptId: script.source!.id, scriptVersion: script.variant!.id, item,
      hasAudio: !!item?.variants.some(v => v.kind === 'audio' && v.assetId), blocked };
  }).filter(row => row.dialogue);
}

export type SpeechSource = SpeechInfo & {
  id: string;
  title: string;
  dialogue: string;
  originalDialogue: string;
  offset: number;
  duration: number;
};

export function speechCharacters(p: Project): string[] {
  return p.items.filter((i) => i.stage === 1 && isApproved(p, i))
    .map((i) => (i.variants.find(v=>v.id===i.approvedId)?.character?.name ?? i.title).split(/\s+[—–-]\s+|[:(]/u)[0].trim())
    .filter(Boolean);
}

export function scriptSpeech(p: Project): {
  sources: SpeechSource[];
  message: string;
} {
  const script = p.items.find((i) => i.stage === 4 && isApproved(p, i));
  if (!script) return { sources: [], message: 'Сначала утвердите подробный сценарий.' };
  const version = script.variants.find((v) => v.id === script.approvedId)!;
  let shots;
  try {
    shots = parseShots(version.text, p.seconds).filter(s=>!excludedShot(p,script.id,s.title));
  } catch {
    return {
      sources: [],
      message: 'Не удалось прочитать реплики. В утверждённом подробном сценарии нужны планы с полем dialogue. Создайте подробный сценарий через ИИ и утвердите его.',
    };
  }
  let offset = 0;
  const characters = speechCharacters(p);
  const sources: SpeechSource[] = [];
  shots.forEach((shot, index) => {
    const info=speechInfo(shot);
    const dialogue = info.speechType==='none'?'':spokenText(shot.dialogue, [...characters,info.speaker]);
    if (dialogue) sources.push({
      id: `script:${version.id}:${index}`,
      ...info,
      title: shot.title,
      dialogue,
      originalDialogue: shot.dialogue,
      offset: Math.round(offset * 1000) / 1000,
      duration: shot.duration,
    });
    offset += shot.duration;
  });
  if (sources.length > 1 && sources.every(s=>s.speechType==='voiceover')) sources.unshift({
    speechType:'voiceover', speaker:'',
    id: 'script:all',
    title: 'Весь закадровый текст — одним голосом',
    dialogue: sources.map((s) => s.dialogue).join('\n\n'),
    originalDialogue: sources.map((s) => s.originalDialogue).join('\n\n'),
    offset: 0,
    duration: p.seconds,
  });
  return {
    sources,
    message: sources.length ? 'Из утверждённого подробного сценария.' : 'В утверждённом сценарии нет реплик: все планы без речи.',
  };
}

export function initialSpeech(item: Item, sources: SpeechSource[], characterNames: string[] = []) {
  const current = chosen(item);
  // Reopening a generated or edited track must preserve the director's text.
  if (current?.dialogue.trim()) return { sourceId: 'current', ...speechInfo(current), dialogue: spokenText(current.dialogue, [...characterNames,current.speaker??'']) };
  const matching = sources.filter((s) => s.id !== 'script:all' && s.title === item.title);
  const source = matching.length === 1 ? matching[0] : sources[0];
  return { sourceId: source?.id ?? 'current', ...speechInfo(source), dialogue: source?.dialogue ?? '' };
}

export function resolveSpeechSource(p: Project, sourceId?: string) {
  if (!sourceId) return undefined;
  const source = scriptSpeech(p).sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('Реплика сценария изменилась или больше не утверждена. Откройте окно озвучки заново.');
  return source;
}
