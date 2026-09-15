import { api, owner, runtime, storeAsset, loadProject } from '@/lib/server';
import { id } from '@/lib/domain';
import { projectAssetIds } from '@/lib/project-assets';
import { z } from 'zod';
export const GET = api(async (req) => {
  const user = await owner(req);
  const projectId = z.string().uuid().parse(new URL(req.url).searchParams.get('projectId'));
  const project = await loadProject(user, projectId);
  const referenced = projectAssetIds(project);
  const r = await runtime.DB.prepare(
    'SELECT id,name,mime,size,created,project_id FROM assets WHERE owner=? ORDER BY created DESC',
  )
    .bind(user)
    .all<{id:string;project_id:string|null}>();
  return Response.json(r.results.filter(a => a.project_id === project.id || referenced.has(a.id)));
});
export const POST = api(async (req) => {
  const user = await owner(req, true);
  if (Number(req.headers.get('content-length') ?? 0) > 51 * 1024 * 1024)
    throw new Error('Файл больше 50 МБ.');
  const form = await req.formData();
  const projectId = z.string().uuid().parse(form.get('projectId'));
  await loadProject(user, projectId);
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
    projectId,
  );
  return Response.json(
    { id: key, name: f.name, mime: f.type, size: f.size },
    { status: 201 },
  );
});
