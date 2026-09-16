import { api, owner, runtime, setKey } from '@/lib/server';
import { PROVIDERS } from '@/lib/models';
import { z } from 'zod';
export const GET = api(async (req) => {
  const user = await owner(req);
  const rows = await runtime.DB.prepare(
    'SELECT provider,updated FROM credentials WHERE owner=?',
  )
    .bind(user)
    .all<{ provider: string; updated: string }>();
  return Response.json({
    vaultReady: !!runtime.VAULT_KEY,
    providers: PROVIDERS.map((p) => ({
      ...p,
      configured: rows.results.some((r) => r.provider === p.id),
    })),
  });
});
export const POST = api(async (req) => {
  const user = await owner(req, true);
  const { provider, key } = z
    .object({
      provider: z.enum(['openai', 'xai', 'minimax', 'bfl', 'elevenlabs', 'sync', 'zencreator']),
      key: z.string().trim().min(10).max(500),
    })
    .parse(await req.json());
  await setKey(user, provider, key);
  return Response.json({ saved: true });
});
export const DELETE = api(async (req) => {
  const user = await owner(req, true);
  const { provider } = z
    .object({ provider: z.string() })
    .parse(await req.json());
  await runtime.DB.prepare(
    'DELETE FROM credentials WHERE owner=? AND provider=?',
  )
    .bind(user, provider)
    .run();
  return Response.json({ removed: true });
});
