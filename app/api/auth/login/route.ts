import { AuthRequestError, assertRequestOrigin, createSession, getAuthConfig, loginLimiter, readLoginForm, sessionCookie, verifyCredentials } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let release: (() => void) | undefined;
  try {
    assertRequestOrigin(req);
    const config = getAuthConfig()!;
    const permit = loginLimiter.acquire();
    if ('retryAfter' in permit) {
      return Response.json({ error: 'Слишком много попыток входа. Повторите позже.' }, { status: 429, headers: { 'Retry-After': String(permit.retryAfter), 'Cache-Control': 'no-store' } });
    }
    release = permit.release;
    const { username, password } = await readLoginForm(req);
    if (!(await verifyCredentials(username, password, config))) {
      return new Response(null, { status: 303, headers: { Location: `${config.origin}/login?error=credentials`, 'Cache-Control': 'no-store' } });
    }
    return new Response(null, {
      status: 303,
      headers: { Location: `${config.origin}/`, 'Set-Cookie': sessionCookie(createSession(config), config), 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 500;
    const message = error instanceof AuthRequestError ? error.message : 'Не удалось выполнить вход. Повторите позже.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  } finally {
    release?.();
  }
}
