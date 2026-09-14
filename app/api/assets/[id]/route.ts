import { api, owner, runtime, asset } from '@/lib/server';
export const GET = api(async (req, ctx) => {
  const user = await owner(req);
  const a = await asset(user, (await ctx.params).id);
  const range = req.headers.get('range');
  const o = await runtime.FILES.get(
    a.id,
    range ? { range: req.headers } : undefined,
  );
  if (!o) throw new Error('Файл недоступен.');
  const headers = new Headers({
    'content-type': a.mime,
    'cache-control': 'private, max-age=3600',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  });
  let status = 200;
  if (range && o.range && 'offset' in o.range && 'length' in o.range) {
    status = 206;
    headers.set(
      'content-range',
      `bytes ${o.range.offset}-${o.range.offset! + o.range.length! - 1}/${o.size}`,
    );
    headers.set('content-length', String(o.range.length));
  } else headers.set('content-length', String(o.size));
  return new Response(o.body, { status, headers });
});
