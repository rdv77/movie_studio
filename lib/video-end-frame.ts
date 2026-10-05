import type { Job } from './domain';
import { ProviderError } from './provider-http';

/** Installed, payload-tested adapters only. Other upstream capabilities stay disabled. */
export const END_FRAME_ADAPTERS: Record<string, { field: string; source: string; checked: string; maxBytes?: number }> = {
  'grok-imagine-video-1.5': { field: 'last_frame', source: 'https://docs.x.ai/developers/model-capabilities/video/reference-to-video', checked: '2026-10-01' },
  'fal-kling-3.0-pro': {field:'end_image_url',source:'https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api',checked:'2026-10-05',maxBytes:20*1024*1024},
  'MiniMax-H3': { field: 'content[].role=last_frame', source: 'https://platform.minimax.io/docs/guides/video-generation', checked: '2026-10-01', maxBytes: 10 * 1024 * 1024 },
  'fal-minimax-h3-max': { field: 'end_image_url', source: 'https://fal.ai/models/minimax/h3-max/image-to-video/api', checked: '2026-10-01', maxBytes: 20 * 1024 * 1024 },
};
export const supportsEndFrame = (modelId: string) => Object.hasOwn(END_FRAME_ADAPTERS, modelId);
type EndJob = Pick<Job, 'model' | 'kind' | 'endFrameAssetId'>;
export type EndFrameAsset = { mime: string; size: number };
export function assertEndFrameModel(job: EndJob): void {
  if (job.kind !== 'video' || !supportsEndFrame(job.model))
    throw new ProviderError('Этот адаптер не передаёт конечный кадр. Выберите Grok Video 1.5 720p, MiniMax H3, fal H3 Max или Kling 3.0 Pro. Запрос не отправлен.', true, true);
}
export function validateEndFrameAsset(job: EndJob, file?: EndFrameAsset): void {
  assertEndFrameModel(job);
  if (!file) throw new ProviderError('Конечный кадр не загружен. Проверьте файл и связь с текущим планом. Запрос не отправлен.', true, true);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mime) || !Number.isFinite(file.size) || file.size <= 0)
    throw new ProviderError('Конечный кадр должен быть непустым изображением PNG, JPEG или WebP. Запрос не отправлен.', true, true);
  const max = END_FRAME_ADAPTERS[job.model].maxBytes;
  if (max && file.size > max) throw new ProviderError(`Конечный кадр этой модели должен быть не больше ${max / 1024 / 1024} МБ. Запрос не отправлен.`, true, true);
}
/** End images are loaded privately by the project-scoped caller, never fetched from client URLs. */
export function validateEndFrameData(job: EndJob, endFrame?: string): EndFrameAsset | undefined {
  if (endFrame === undefined && !job.endFrameAssetId) return;
  assertEndFrameModel(job);
  if (endFrame === undefined) { validateEndFrameAsset(job); return; }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(endFrame);
  if (!match || match[2].length % 4) throw new ProviderError('Конечный кадр должен быть загруженным PNG, JPEG или WebP в формате Data URI. Запрос не отправлен.', true, true);
  const file = { mime: match[1], size: match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0) };
  validateEndFrameAsset(job, file);
  return file;
}
