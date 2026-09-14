export type SpeechType = 'voiceover' | 'character' | 'none';
export type SpeechInfo = { speechType: SpeechType; speaker: string };
export type SpeechInput = { speechType?: SpeechType; speaker?: string; dialogue?: string };
export const speechNames: Record<SpeechType,string> = {
  voiceover: 'Закадровый голос', character: 'Герой в кадре', none: 'Без речи',
};

// Legacy projects were created with an explicit off-screen narration instruction.
// A name in old dialogue is not evidence that a visible character is speaking.
export function speechInfo(value: SpeechInput = {}): SpeechInfo {
  const speechType = value.speechType ?? (value.dialogue?.trim() ? 'voiceover' : 'none');
  return { speechType, speaker: speechType === 'none' ? '' : value.speaker?.trim() ?? '' };
}
export function speechDirection(info: SpeechInfo) {
  if (info.speechType === 'character') return `Реплику произносит в кадре ${info.speaker || 'один выбранный герой'}. Только этот герой естественно двигает губами; остальные не говорят. Лицо говорящего должно быть видно. Звук будет наложен отдельно; не добавляй свою речь, пение или субтитры.`;
  return `${info.speechType === 'voiceover' ? 'Речь звучит только за кадром и не принадлежит видимым персонажам.' : 'План без речи.'} Все персонажи держат рты закрытыми весь план: без артикуляции, шевеления губ, разговора и пения. Показывай эмоции взглядом, мимикой глаз и жестами. Не добавляй голос или субтитры.`;
}
export function withSpeechDirection(prompt: string, info: SpeechInfo) {
  // Replace only our own previous suffix when a reviewed prompt is resubmitted.
  return prompt.split('\n\nПравило речи для этого плана:')[0].trim() + '\n\nПравило речи для этого плана: ' + speechDirection(info);
}
export function assertSpeech(info: SpeechInfo, dialogue: string) {
  if (info.speechType === 'none' && dialogue.trim()) throw new Error('Для плана без речи оставьте текст пустым или выберите вид речи.');
  if (info.speechType === 'character' && !info.speaker) throw new Error('Укажите, какой герой произносит реплику в кадре.');
}
