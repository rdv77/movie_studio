import type { Job } from './domain';

export const FAL_QWEN = 'fal-qwen-image-edit-2511';
export const FAL_ENDPOINT = 'fal-ai/qwen-image-edit-2511';
// Studio's compact prompt budget, not an advertised upstream limit.
export const FAL_PROMPT_BUDGET = 5000;
export const isFalImage = (id: string) => id === FAL_QWEN;
export function falRefIssue(refs: { mime: string; size: number }[]) {
  if (!refs.length) return 'Qwen Image Edit: добавьте фотографию или утверждённый образ героя. Модель редактирует изображения по референсам.';
  if (refs.length > 8) return 'Qwen Image Edit: в студии можно передать до 8 референсов.';
  if (refs.some(r => !['image/png','image/jpeg','image/webp'].includes(r.mime) || !Number.isFinite(r.size) || r.size <= 0))
    return 'Qwen Image Edit: нужны изображения PNG, JPEG или WebP.';
  if (refs.reduce((n,r) => n+r.size,0) > 20*1024*1024) return 'Qwen Image Edit: выберите референсы суммарно до 20 МБ.';
  return '';
}
export function prepareFalJobs(jobs: Job[], refs: {mime:string;size:number}[]) {
  for (const j of jobs.filter(j => isFalImage(j.model))) {
    const issue = falRefIssue(refs);
    if (issue) throw new Error(issue);
    if (j.kind !== 'image' || !j.prompt.trim() || j.prompt.length > FAL_PROMPT_BUDGET)
      throw new Error('Qwen Image Edit: сократите задачу и описания до бюджета студии — 5000 символов. Запрос не отправлен.');
  }
}
