import type { StoredObject } from './storage-types';
import { runtime, HttpError } from './server';
import { now } from './domain';
import type { UploadedAsset } from './asset-upload';
export type AssetUpload = UploadedAsset & { owner: string; upload_id: string; created: string; project_id: string | null };
export async function findUpload(user: string, id: string) {
  const row = await runtime.DB.prepare('SELECT * FROM asset_uploads WHERE id=? AND owner=?')
    .bind(id, user).first<AssetUpload>();
  if (!row) throw new HttpError('Загрузка не найдена.', 404);
  return row;
}
export async function existingUpload(user: string, id: string) {
  return runtime.DB.prepare('SELECT id,name,mime,size FROM assets WHERE id=? AND owner=?')
    .bind(id, user).first<UploadedAsset>();
}
export async function finishUpload(row: AssetUpload, object: StoredObject) {
  if (object.size !== row.size) throw new HttpError('Размер загруженного файла не совпадает. Повторите загрузку.');
  await runtime.DB.batch([
    runtime.DB.prepare('INSERT OR IGNORE INTO assets (id,owner,name,mime,size,created,project_id) VALUES (?,?,?,?,?,?,?)')
      .bind(row.id, row.owner, row.name, row.mime, row.size, now(), row.project_id),
    runtime.DB.prepare('DELETE FROM asset_uploads WHERE id=? AND owner=?').bind(row.id, row.owner),
  ]);
  return { id: row.id, name: row.name, mime: row.mime, size: row.size };
}
export async function expireUploads(user: string) {
  const rows = await runtime.DB.prepare('SELECT * FROM asset_uploads WHERE owner=? AND created<? ORDER BY created LIMIT 5')
    .bind(user, new Date(Date.now() - 86400000).toISOString()).all<AssetUpload>();
  for (const row of rows.results) {
    const object = await runtime.FILES.head(row.id);
    if (object) { await finishUpload(row, object); continue; }
    await runtime.FILES.resumeMultipartUpload(row.id, row.upload_id).abort();
    await runtime.DB.prepare('DELETE FROM asset_uploads WHERE id=? AND owner=?').bind(row.id, user).run();
  }
}
