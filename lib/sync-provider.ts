import type { Job } from './domain';
import { ProviderError, type Result } from './providers';
import { SYNC_FILE_LIMIT, SYNC_PAIR_LIMIT } from './lipsync';

async function syncCall(key: string, path: string, body?: FormData) {
  let response: Response;
  try {
    response = await fetch('https://api.sync.so/v2/' + path, {
      method: body ? 'POST' : 'GET', headers: { 'x-api-key': key }, body,
      redirect: 'manual', signal: AbortSignal.timeout(body ? 180000 : 30000),
    });
  } catch { throw new ProviderError('Связь с sync.so прервалась. Исход запроса неизвестен; автоматического повтора не будет.'); }
  if (!response.ok) {
    const advice = response.status === 401 || response.status === 403 ? 'Проверьте API-ключ и доступ к модели.'
      : response.status === 402 ? 'Проверьте баланс sync.so.'
      : response.status === 429 ? 'Достигнут лимит sync.so. Повторите позднее вручную.'
      : 'Проверьте формат файлов, наличие видимого лица и параметры в кабинете sync.so.';
    throw new ProviderError(`sync.so: HTTP ${response.status}. ${advice}`, response.status < 500);
  }
  return await response.json() as any;
}
export function syncResult(data: any, job: Job): Result {
  const requestId = typeof data.id === 'string' ? data.id : undefined;
  if (['FAILED', 'REJECTED', 'CANCELED', 'CANCELLED'].includes(data.status)) {
    const code = typeof data.errorCode === 'string' ? data.errorCode.replace(/[^a-zA-Z0-9_-]/g, '').slice(0,100) : '';
    return { requestId, error: `sync.so не завершил синхронизацию${code ? ' (' + code + ')' : ''}. Проверьте лицо в кадре, файлы и расход в кабинете провайдера.` };
  }
  if (data.status === 'COMPLETED') {
    if (!data.outputUrl || typeof data.outputUrl !== 'string') return { requestId, error: 'sync.so завершил запрос без ссылки на результат. Проверьте его в кабинете провайдера.' };
    // Different output frame rates can round the duration by one frame. The
    // renderer pads that bounded tail while keeping the complete original speech.
    if (Number.isFinite(data.outputDuration) && data.outputDuration + 1 / 24 + 0.001 < job.lipsync!.seconds)
      return { requestId, usage: { outputDuration: data.outputDuration }, error: `sync.so вернул слишком короткое видео: ${data.outputDuration.toFixed(3)} сек вместо ${job.lipsync!.seconds.toFixed(3)} сек. Оно не добавлено к плану, чтобы не обрезать реплику. Проверьте результат и расход в кабинете провайдера.` };
    return { requestId, url: data.outputUrl, mime: 'video/mp4', actual: null, usage: { outputDuration: data.outputDuration } };
  }
  if (!['PENDING', 'PROCESSING', 'QUEUED', 'RUNNING'].includes(data.status))
    throw new ProviderError('Неизвестный статус sync.so. Проверьте запрос в кабинете; повтор не отправлен.');
  return { requestId, pending: true, actual: null };
}
export async function generateSync(job: Job, key: string, visual: Blob, audio: Blob): Promise<Result> {
  if (!job.lipsync || visual.size > SYNC_FILE_LIMIT || audio.size > SYNC_FILE_LIMIT || visual.size + audio.size > SYNC_PAIR_LIMIT)
    throw new ProviderError('Файлы слишком большие для sync.so. Запрос не отправлен.', true, true);
  const body = new FormData();
  body.set('model', job.model); body.set('audio', audio, 'speech.wav');
  if (job.lipsync.inputType === 'image') {
    if (job.model !== 'sync-3' || visual.type !== 'image/png') throw new ProviderError('Изображение поддерживается только в sync-3. Запрос не отправлен.',true,true);
    const {speaker,imageWidth,imageHeight,prompt} = job.lipsync;
    body.set('image',visual,'frame.png');
    body.set('options',JSON.stringify({i2v_prompt:prompt,active_speaker_detection:{auto_detect:false,frame_number:0,
      coordinates:[Math.min(imageWidth-1,Math.floor(speaker.x*imageWidth)),Math.min(imageHeight-1,Math.floor(speaker.y*imageHeight))]}}));
  } else {
    body.set('video', visual, 'video.mp4');
    body.set('options', JSON.stringify({ sync_mode: 'silence' }));
  }
  body.set('outputFileName', 'kadr-' + job.id);
  return syncResult(await syncCall(key, 'generate', body), job);
}
export async function pollSync(job: Job, key: string) {
  return syncResult(await syncCall(key, 'generate/' + encodeURIComponent(job.requestId!)), job);
}
