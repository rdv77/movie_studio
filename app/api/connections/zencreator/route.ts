import { api, owner, getKey } from '@/lib/server';
import { checkZenConnection } from '@/lib/zencreator-provider';

// Read-only authentication/catalog/balance check. Never starts a generation.
export const GET = api(async req=>{
  const user=await owner(req);
  return Response.json(await checkZenConnection(await getKey(user,'zencreator')),
    {headers:{'Cache-Control':'private, no-store'}});
});
