import { api, owner, runtime } from '@/lib/server';
import { newProject, now } from '@/lib/domain';
import { z } from 'zod';
export const GET = api(async (req) => {
  const user = await owner(req);
  const r = await runtime.DB.prepare(
    'SELECT id,title,revision,updated FROM projects WHERE owner=? ORDER BY updated DESC',
  )
    .bind(user)
    .all();
  return Response.json(r.results);
});
export const POST = api(async (req) => {
  const user = await owner(req, true);
  const { title } = z
    .object({ title: z.string().trim().min(1).max(100) })
    .parse(await req.json());
  const p = newProject(title);
  await runtime.DB.prepare(
    'INSERT INTO projects (id,owner,title,state,revision,updated) VALUES (?,?,?,?,?,?)',
  )
    .bind(p.id, user, title, JSON.stringify(p), 0, now())
    .run();
  return Response.json(p, { status: 201 });
});
