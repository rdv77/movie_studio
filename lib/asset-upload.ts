// Large files cross the Worker boundary in bounded parts, without re-encoding.
export const ASSET_PART_BYTES = 8 * 1024 * 1024;
export const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
export const ASSET_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg',
  'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'video/mp4', 'video/webm'];
export type UploadedAsset = { id: string; name: string; mime: string; size: number };

async function response<T>(r: Response): Promise<T> {
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Не удалось сохранить файл.');
  return data;
}
export async function uploadAsset(file: File, projectId: string, progress?: (text: string) => void, signal?: AbortSignal): Promise<UploadedAsset> {
  if (file.size > MAX_ASSET_BYTES) throw new Error('Загрузка в студию поддерживает файлы до 1 ГБ.');
  if (file.size <= ASSET_PART_BYTES) {
    const form = new FormData(); form.set('file', file); form.set('projectId', projectId);
    return response<UploadedAsset>(await fetch('/api/assets', { method: 'POST', body: form, signal }));
  }
  const session = await response<{id: string}>(await fetch('/api/assets/uploads', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ name: file.name.slice(0, 160), mime: file.type, size: file.size, projectId }),
  }));
  const url = '/api/assets/uploads/' + encodeURIComponent(session.id);
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    for (let start = 0; start < file.size; start += ASSET_PART_BYTES) {
      const partNumber = parts.length + 1;
      progress?.(`Сохраняем файл без дополнительного сжатия: ${Math.round(start / file.size * 100)}%…`);
      // The same part number safely replaces a part after a transient failure.
      let part: {partNumber: number; etag: string} | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(url + '?part=' + partNumber, { method: 'PUT',
            body: file.slice(start, start + ASSET_PART_BYTES), signal });
          part = await response<{partNumber: number; etag: string}>(r); break;
        } catch (e) { if (attempt === 2 || signal?.aborted) throw e; }
      }
      if (!part) throw new Error('Часть файла не сохранена.');
      parts.push(part);
    }
    progress?.('Завершаем сохранение файла…');
    for (let attempt = 0; ; attempt++) {
      try {
        return await response<UploadedAsset>(await fetch(url, { method: 'POST', signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts }) }));
      } catch (e) { if (attempt === 2 || signal?.aborted) throw e; }
    }
  } catch (e) {
    // Completed objects are never deleted by abort, including a lost completion response.
    await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
    throw e;
  }
}
