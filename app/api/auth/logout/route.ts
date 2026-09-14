import { AuthRequestError, assertRequestOrigin, expiredSessionCookie, getAuthConfig } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    assertRequestOrigin(req);
    const config = getAuthConfig()!;
    return new Response(null, {
      status: 303,
      headers: { Location: `${config.origin}/login`, 'Set-Cookie': expiredSessionCookie(config), 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof AuthRequestError ? error.message : 'Не удалось выйти.' }, {
      status: error instanceof AuthRequestError ? error.status : 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
