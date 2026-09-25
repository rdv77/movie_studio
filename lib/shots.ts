import { z } from 'zod';
import { speechInfo, speechNames, assertSpeech } from './speech-mode';
export const shotSchema = z.object({
  schemaVersion:z.number().optional(),timingMode:z.enum(['actual']).optional(),
  shots: z
    .array(
      z.object({
        id:z.string().optional(),sceneId:z.string().optional(),cast:z.array(z.string()).optional(),productionDesign:z.string().max(6000).optional(),imagePrompt:z.string().max(32000).optional(),videoPrompt:z.string().max(32000).optional(),
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(6000),
        duration: z.number().min(0.5).max(60),
        camera: z.string().max(6000),
        dialogue: z.string().max(4000),
        speechType: z.enum(['voiceover','character','none']).optional(),
        speaker: z.string().trim().max(100).optional(),
        continuity: z.string().max(20000),
      }),
    )
    .min(1)
    .max(120),
});
export function parseShots(text: string, seconds: number) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let data;
  try {
    data = shotSchema.parse(JSON.parse(clean));
  } catch {
    throw new Error(
      'Для подготовки карточек нужен сценарий в формате JSON с массивом shots. Создайте подробный сценарий через ИИ или исправьте его структуру.',
    );
  }
  for (const shot of data.shots) if (shot.speechType) assertSpeech(speechInfo(shot),shot.dialogue);
  const total = data.shots.reduce((s, v) => s + v.duration, 0);
  if (data.timingMode!=='actual'&&Math.abs(total - seconds) > 0.1)
    throw new Error(
      `Сумма планов ${total} сек, длительность фильма ${seconds} сек. Исправьте длительности в сценарии.`,
    );
  return data.shots;
}
export function readableText(text: string) {
  try {
    const data = shotSchema.parse(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, ''),
      ),
    );
    return data.shots
      .map(
        (s, i) =>
          `${String(i + 1).padStart(2, '0')}. ${s.title} · ${s.duration} сек\n${s.description}\nКамера: ${s.camera}\n${speechNames[speechInfo(s).speechType]}${s.speaker ? ' · '+s.speaker : ''}: ${s.dialogue || 'Без речи'}\nМонтаж: ${s.continuity}`,
      )
      .join('\n\n');
  } catch {
    return text;
  }
}
