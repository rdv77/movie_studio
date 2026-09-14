import { api, owner, runtime } from '@/lib/server';
import { id, now } from '@/lib/domain';
import { ASSET_MIMES, MAX_ASSET_BYTES } from '@/lib/asset-upload';
import { expireUploads } from '@/lib/asset-uploads-server';
import { z } from 'zod';
const schema = z.object({ name: z.string().trim().min(1).max(160),
  mime: z.string().refine(m => ASSET_MIMES.includes(m)), size: z.number().int().positive().max(MAX_ASSET_BYTES) });
export const POST = api(async req => {
  const user = await owner(req, true);
  const data = schema.parse(await req.json());
  // Cleanup of abandoned sessions must not block a new upload on a transient R2 error.
  await expireUploads(user).catch(() => {});
  const key = id();
  const upload = await runtime.FILES.createMultipartUpload(key, { httpMetadata: { contentType: data.mime } });
  try {
    await runtime.DB.prepare('INSERT INTO asset_uploads (id,owner,name,mime,size,upload_id,created) VALUES (?,?,?,?,?,?,?)')
      .bind(key, user, data.name, data.mime, data.size, upload.uploadId, now()).run();
  } catch (e) { await upload.abort(); throw e; }
  return Response.json({ id: key }, { status: 201 });
});
