import { api, owner, getKey } from '@/lib/server';
import { voiceCatalog } from '@/lib/voices';
import { z } from 'zod';
export const GET = api(async req => {
  const user=await owner(req);
  const url=new URL(req.url);
  const provider=z.enum(['minimax','elevenlabs']).parse(url.searchParams.get('provider'));
  const cursor=z.string().max(2000).parse(url.searchParams.get('cursor') ?? '');
  const scope=z.enum(['russian','all']).parse(url.searchParams.get('scope') ?? 'russian');
  const key=await getKey(user,provider);
  return Response.json(await voiceCatalog(provider,key,cursor,scope), {headers:{'Cache-Control':'private, no-store'}});
});
