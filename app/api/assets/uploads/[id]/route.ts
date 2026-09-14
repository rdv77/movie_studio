import { api, owner, runtime, HttpError } from '@/lib/server';
import { existingUpload, findUpload, finishUpload } from '@/lib/asset-uploads-server';
import { ASSET_PART_BYTES } from '@/lib/asset-upload';
import { z } from 'zod';

export const PUT = api(async (req, ctx) => {
  const user = await owner(req, true);
  const row = await findUpload(user, (await ctx.params).id);
  const part = Number(new URL(req.url).searchParams.get('part'));
  const count = Math.ceil(row.size / ASSET_PART_BYTES);
  if (!Number.isInteger(part) || part < 1 || part > count) throw new HttpError('Неверный номер части.');
  const expected = Math.min(ASSET_PART_BYTES, row.size - (part - 1) * ASSET_PART_BYTES);
  if (Number(req.headers.get('content-length') || 0) > expected) throw new HttpError('Часть файла слишком большая.', 413);
  if (!req.body) throw new HttpError('Часть файла отсутствует.');
  // Bound memory even if a client omits Content-Length or sends an endless body.
  const reader = req.body.getReader();
  const bytes = new Uint8Array(expected); let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (offset + value.byteLength > expected) { await reader.cancel(); throw new HttpError('Часть файла слишком большая.', 413); }
      bytes.set(value, offset); offset += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (offset !== expected) throw new HttpError('Часть файла передана не полностью.');
  const result = await runtime.FILES.resumeMultipartUpload(row.id, row.upload_id).uploadPart(part, bytes);
  return Response.json(result);
});

const completion = z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) })).min(1).max(128) });
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true), id = (await ctx.params).id;
  const existing = await existingUpload(user, id);
  if (existing) return Response.json(existing);
  const row = await findUpload(user, id);
  // Recovery after R2 completed but the database write / response was interrupted.
  let object = await runtime.FILES.head(id);
  if (!object) {
    const { parts } = completion.parse(await req.json());
    if (parts.length !== Math.ceil(row.size / ASSET_PART_BYTES) || parts.some((p, n) => p.partNumber !== n + 1))
      throw new HttpError('Переданы не все части файла или нарушен их порядок.');
    object = await runtime.FILES.resumeMultipartUpload(id, row.upload_id).complete(parts);
  }
  return Response.json(await finishUpload(row, object));
});

export const DELETE = api(async (req, ctx) => {
  const user = await owner(req, true), id = (await ctx.params).id;
  if (await existingUpload(user, id)) return new Response(null, { status: 204 });
  const row = await findUpload(user, id);
  const object = await runtime.FILES.head(id);
  if (object) await finishUpload(row, object);
  else {
    await runtime.FILES.resumeMultipartUpload(id, row.upload_id).abort();
    await runtime.DB.prepare('DELETE FROM asset_uploads WHERE id=? AND owner=?').bind(id, user).run();
  }
  return new Response(null, { status: 204 });
});
