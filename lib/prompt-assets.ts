import type { Job } from './domain';
import { isOpenAIImage, OPENAI_IMAGE_REFS_BYTES } from './openai-image';
import { isMiniMaxImage, miniMaxImageRefIssue } from './minimax-image';
import { prepareFalJobs } from './fal-models';
import { prepareGoogleJobs } from './google-models';
import { prepareZenJobs } from './zencreator-models';

export type PromptAsset = { mime: string; size: number };

/** Caller supplies a project-scoped loader. Compile/filter IDs BEFORE this function. */
export async function validateCompiledMediaAssets(job: Job, load: (id: string) => Promise<PromptAsset>): Promise<void> {
  const allIds = [...new Set([...job.refs, ...(job.characterRefs ?? [])])];
  const all = await Promise.all(allIds.map(async id => ({ id, data: await load(id) })));
  if (all.some(({ data }) => !data.mime.startsWith('image/'))) throw Error('Референс должен быть изображением.');
  const refs = job.refs.map(id => all.find(a => a.id === id)!.data);
  if (isOpenAIImage(job.model) && (refs.some(a => !['image/png', 'image/jpeg', 'image/webp'].includes(a.mime) || a.size > 10 * 1024 * 1024) || refs.reduce((n, a) => n + a.size, 0) > OPENAI_IMAGE_REFS_BYTES))
    throw Error('GPT Image: каждый референс PNG, JPEG или WebP до 10 МБ, суммарно до 20 МБ. Запрос не отправлен.');
  if (isMiniMaxImage(job.model)) { const issue = miniMaxImageRefIssue(refs); if (issue) throw Error(issue); }
  if (job.kind === 'video' && refs.some(a => !['image/png', 'image/jpeg', 'image/webp'].includes(a.mime)))
    throw Error('Первый кадр видеоплана должен быть PNG, JPEG или WebP.');
  if (job.model === 'MiniMax-H3' && refs.some(a => a.size > 10 * 1024 * 1024)) throw Error('MiniMax H3: первый кадр должен быть не больше 10 МБ. Запрос не отправлен.');
  // Retain adapter-specific limits, duration checks and minimum budget reservation.
  prepareFalJobs([job], refs);
  prepareGoogleJobs([job], refs);
  prepareZenJobs([job], refs);
}
