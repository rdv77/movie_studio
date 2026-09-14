// Read media metadata only; no playback, provider calls or changes to the project.
export function audioDuration(assetId: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = new Audio();
    const finish = (error?: Error) => {
      const seconds = media.duration;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      if (error) reject(error);
      else if (!Number.isFinite(seconds) || seconds <= 0) reject(new Error('Не удалось прочитать длительность записи.'));
      else resolve(seconds);
    };
    const abort = () => finish(new Error('Проверка длительности отменена.'));
    const timer = setTimeout(() => finish(new Error('Проверка длительности заняла слишком много времени.')), 20000);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) { abort(); return; }
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish();
    media.onerror = () => finish(new Error('Не удалось загрузить озвучку для проверки длительности.'));
    media.src = '/api/assets/' + assetId;
  });
}
