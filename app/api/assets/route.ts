import { api, owner, runtime, storeAsset } from '@/lib/server';
import { id } from '@/lib/domain';
export const GET = api(async (req) => {
  const user = await owner(req);
  const r = await runtime.DB.prepare(
    'SELECT id,name,mime,size,created FROM assets WHERE owner=? ORDER BY created DESC',
  )
    .bind(user)
    .all();
  return Response.json(r.results);
});
export const POST = api(async (req) => {
  const user = await owner(req, true);
  if (Number(req.headers.get('content-length') ?? 0) > 51 * 1024 * 1024)
    throw new Error('Файл больше 50 МБ.');
  const form = await req.formData();
  const f = form.get('file');
  if (!(f instanceof File)) throw new Error('Выберите файл.');
  if (
    ![
      'image/png',
      'image/jpeg',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/ogg',
      'video/mp4',
      'video/webm',
    ].includes(f.type)
  )
    throw new Error(
      'Поддерживаются PNG, JPEG, WebP, MP3, WAV, M4A, OGG, MP4 и WebM.',
    );
  if (f.size > 50 * 1024 * 1024) throw new Error('Файл больше 50 МБ.');
  const key = id();
  await storeAsset(
    user,
    key,
    f.name.slice(0, 160),
    f.type,
    await f.arrayBuffer(),
  );
  return Response.json(
    { id: key, name: f.name, mime: f.type, size: f.size },
    { status: 201 },
  );
});
