import { projectAssetIds } from './project-assets';
import { runtime, StorageError } from './storage';
import { authenticateRequest, assertRequestOrigin, AuthRequestError } from './auth';
import type { Project } from './domain';
import { now, repairLegacyTransportFailures } from './domain';
import { z } from 'zod';
import { encodeProjectState, decodeProjectState, ProjectStorageError } from './project-state';
export { runtime };
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function owner(req: Request, write = false) {
  const user = authenticateRequest(req);
  if (!user) throw new HttpError('Войдите в студию.', 401);
  if (write) assertRequestOrigin(req);
  return user;
}
export function api(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof z.ZodError
              ? 'Проверьте заполненные поля.'
              : e instanceof Error
                ? e.message
                : 'Не удалось выполнить действие.',
        },
        { status: e instanceof HttpError || e instanceof AuthRequestError || e instanceof StorageError ? e.status : e instanceof ProjectStorageError ? 503 : 400,
          headers:e instanceof StorageError&&e.contentRange?{'content-range':e.contentRange}:undefined },
      );
    }
  };
}
export async function loadProject(user: string, id: string): Promise<Project> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await runtime.DB.prepare(
      'SELECT state, revision FROM projects WHERE id=? AND owner=?',
    )
      .bind(id, user)
      .first<{ state: string; revision: number }>();
    if (!row) throw new HttpError('Проект не найден.', 404);
    const p = await decodeProjectState(runtime.FILES,user,id,row.state,row.revision);
    if (!repairLegacyTransportFailures(p)) return p;
    try { return await saveProject(user, p, row.revision); }
    catch (e) {
      if (!(e instanceof HttpError && e.status === 409) || attempt === 4) throw e;
    }
  }
  throw new HttpError('Обновите проект и повторите действие.', 409);
}
export async function saveProject(user: string, p: Project, expected: number) {
  // Authorize and reject stale callers before creating a blob. The UPDATE below
  // still performs CAS because another request may save during the R2 write.
  const current=await runtime.DB.prepare('SELECT revision FROM projects WHERE id=? AND owner=?').bind(p.id,user).first<{revision:number}>();
  if(!current)throw new HttpError('Проект не найден.',404);
  if(current.revision!==expected)throw new HttpError('Проект изменился в другом окне. Обновите данные и повторите действие.',409);
  const next={...p,revision:expected+1};
  const encoded=await encodeProjectState(runtime.FILES,user,next);
  const r = await runtime.DB.prepare(
    'UPDATE projects SET state=?, title=?, revision=?, updated=? WHERE id=? AND owner=? AND revision=?',
  )
    .bind(encoded.state, p.title, next.revision, now(), p.id, user, expected)
    .run();
  if (!r.meta.changes)
    throw new HttpError(
      'Проект изменился в другом окне. Обновите данные и повторите действие.',
      409,
    );
  // Immutable snapshots are retained: an earlier reader may still need the
  // preceding one, and an ambiguous D1 response may have committed this one.
  // They are never registered as assets or exposed by the media endpoints.
  p.revision=next.revision;
  return p;
}
export async function mutate(
  user: string,
  id: string,
  fn: (p: Project) => void,
) {
  for (let n = 0; n < 5; n++) {
    const p = await loadProject(user, id);
    const rev = p.revision;
    fn(p);
    try {
      return await saveProject(user, p, rev);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 409) || n === 4) throw e;
    }
  }
  throw new Error('Не удалось сохранить результат.');
}
export async function asset(user: string, id: string, project?: Project) {
  const a = await runtime.DB.prepare(
    'SELECT * FROM assets WHERE id=? AND owner=?',
  )
    .bind(id, user)
    .first<{ id: string; name: string; mime: string; size: number; project_id: string | null }>();
  if (!a) throw new HttpError('Файл не найден.', 404);
  if (project && a.project_id !== project.id && !projectAssetIds(project).has(id))
    throw new HttpError('Файл не принадлежит этому проекту. Для переноса используйте библиотеку утверждённых материалов.', 404);
  return a;
}
export async function storeAsset(
  user: string,
  id: string,
  name: string,
  mime: string,
  data: ArrayBuffer | Uint8Array,
  projectId: string,
) {
  if (data.byteLength > 50 * 1024 * 1024) throw new Error('Файл больше 50 МБ.');
  await runtime.FILES.put(id, data, { httpMetadata: { contentType: mime } });
  await runtime.DB.prepare(
    'INSERT OR IGNORE INTO assets (id,owner,name,mime,size,created,project_id) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(id, user, name, mime, data.byteLength, now(), projectId)
    .run();
  return id;
}
export async function imageData(user: string, id: string, project: Project) {
  const a = await asset(user, id, project);
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(a.mime) ||
    a.size > 10 * 1024 * 1024
  )
    throw new Error('Референс: PNG, JPEG или WebP до 10 МБ.');
  const o = await runtime.FILES.get(id);
  if (!o) throw new Error('Файл недоступен.');
  const bytes = new Uint8Array(await o.arrayBuffer());
  let binary = '';
  for (let n = 0; n < bytes.length; n += 8192)
    binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return `data:${a.mime};base64,${btoa(binary)}`;
}
async function vaultKey() {
  if (!runtime.VAULT_KEY)
    throw new Error('Хранилище API-ключей еще не настроено.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(runtime.VAULT_KEY), (c) => c.charCodeAt(0)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function setKey(user: string, provider: string, value: string) {
  const key = await vaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(user + ':' + provider),
    },
    key,
    new TextEncoder().encode(value),
  );
  const cipher = JSON.stringify({
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(data)),
  });
  await runtime.DB.prepare(
    'INSERT INTO credentials (owner,provider,cipher,updated) VALUES (?,?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET cipher=excluded.cipher,updated=excluded.updated',
  )
    .bind(user, provider, cipher, now())
    .run();
}
export async function getKey(user: string, provider: string) {
  const row = await runtime.DB.prepare(
    'SELECT cipher FROM credentials WHERE owner=? AND provider=?',
  )
    .bind(user, provider)
    .first<{ cipher: string }>();
  if (!row) throw new Error('Добавьте API-ключ провайдера в Подключениях.');
  const c = JSON.parse(row.cipher);
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(c.iv),
      additionalData: new TextEncoder().encode(user + ':' + provider),
    },
    await vaultKey(),
    new Uint8Array(c.data),
  );
  return new TextDecoder().decode(plain);
}
