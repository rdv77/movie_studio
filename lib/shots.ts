import { z } from 'zod';
import { speechInfo, speechNames, assertSpeech } from './speech-mode';
export const shotSchema = z.object({
  shots: z
    .array(
      z.object({
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(4000),
        duration: z.number().min(0.5).max(15),
        camera: z.string().max(2000),
        dialogue: z.string().max(4000),
        speechType: z.enum(['voiceover','character','none']).optional(),
        speaker: z.string().trim().max(100).optional(),
        continuity: z.string().max(2000),
      }),
    )
    .min(2)
    .max(20),
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
  if (Math.abs(total - seconds) > 0.1)
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
