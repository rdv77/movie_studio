import {fitsPrompt,promptCapacity} from './model-capabilities';
import type { Job } from './domain';
import { modernVideoTiming, videoRequestTiming } from './video-duration';

export const FAL_QWEN = 'fal-qwen-image-edit-2511';
export const FAL_ENDPOINT = 'fal-ai/qwen-image-edit-2511';
export const FAL_KLING = 'fal-kling-3.0-pro';
export const FAL_H3 = 'fal-minimax-h3-max';
export const FAL_WAN = 'fal-wan-2.2-a14b';
export const FAL_ENDPOINTS: Record<string,string> = {
  [FAL_KLING]: 'fal-ai/kling-video/v3/pro/image-to-video',
  [FAL_QWEN]: FAL_ENDPOINT,
  [FAL_H3]: 'minimax/h3-max/image-to-video',
  [FAL_WAN]: 'fal-ai/wan/v2.2-a14b/image-to-video',
};
// Studio's compact prompt budget, not an advertised upstream limit.
export const FAL_PROMPT_BUDGET = 60000;
export const isFalImage = (id: string) => id === FAL_QWEN;
export const isFalVideo = (id: string) => id === FAL_H3 || id === FAL_WAN || id === FAL_KLING;
export function falVideoRefIssue(refs: {mime:string;size:number}[]) {
  if (refs.length !== 1) return 'fal.ai: выберите один первый кадр видеоплана.';
  if (!['image/png','image/jpeg','image/webp'].includes(refs[0].mime) || !Number.isFinite(refs[0].size) || refs[0].size <= 0)
    return 'fal.ai: первый кадр должен быть изображением PNG, JPEG или WebP.';
  if (refs[0].size > 20*1024*1024) return 'fal.ai: первый кадр должен быть не больше 20 МБ.';
  return '';
}
export function falRefIssue(refs: { mime: string; size: number }[]) {
  if (!refs.length) return 'Qwen Image Edit: добавьте фотографию или утверждённый образ героя. Модель редактирует изображения по референсам.';
  if (refs.length > 8) return 'Qwen Image Edit: в студии можно передать до 8 референсов.';
  if (refs.some(r => !['image/png','image/jpeg','image/webp'].includes(r.mime) || !Number.isFinite(r.size) || r.size <= 0))
    return 'Qwen Image Edit: нужны изображения PNG, JPEG или WebP.';
  if (refs.reduce((n,r) => n+r.size,0) > 20*1024*1024) return 'Qwen Image Edit: выберите референсы суммарно до 20 МБ.';
  return '';
}
export function prepareFalJobs(jobs: Job[], refs: {mime:string;size:number}[], loadedEndFrame = false, admission = false) {
  for (const j of jobs.filter(j => isFalImage(j.model) || isFalVideo(j.model))) {
    const video = isFalVideo(j.model);
    const issue = video ? falVideoRefIssue(refs) : falRefIssue(refs);
    if (issue) throw new Error(issue);
    if (video) {
      if (j.kind !== 'video' || !j.prompt.trim() || !admission && !fitsPrompt(j.prompt,promptCapacity(j.model,'video')))
        throw new Error('fal.ai: для видеоплана нужен промпт в пределах лимита API выбранной модели. Запрос не отправлен.');
      videoRequestTiming(j.model,j.duration,loadedEndFrame || modernVideoTiming(j));
    } else if (j.kind !== 'image' || !j.prompt.trim() || !admission && !fitsPrompt(j.prompt,promptCapacity(j.model,'image')))
      throw new Error('Qwen Image Edit: сократите задачу и описания до технического предела студии — 60 000 символов. Запрос не отправлен.');
  }
}
