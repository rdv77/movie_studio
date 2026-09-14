import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';

await build({
  stdin: { contents: "export * from './lib/auth'; export { POST as login } from './app/api/auth/login/route'; export { POST as logout } from './app/api/auth/logout/route';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/auth.mjs',
});
const auth = await import('../work/tests/auth.mjs');
const envNames = ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'APP_ORIGIN'];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const password = 'Тестовый пароль — with spaces';
const now = Math.floor(Date.now() / 1000);

function request(body, options = {}) {
  return new Request(options.url || 'https://untrusted-host.invalid/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://studio.example', 'content-type': 'application/x-www-form-urlencoded', ...options.headers },
    body: typeof body === 'string' ? body : new URLSearchParams(body),
  });
}

try {
  const passwordHash = await auth.hashPassword(password);
  assert.match(passwordHash, /^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/);
  assert.notEqual(await auth.hashPassword(password), passwordHash, 'Each password hash must have a fresh salt.');
  await assert.rejects(auth.hashPassword(''));
  await assert.rejects(auth.hashPassword('я'.repeat(513)));
  Object.assign(process.env, { ADMIN_USERNAME: 'director', ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: 'a'.repeat(64), APP_ORIGIN: 'https://studio.example' });
  const config = auth.getAuthConfig();
  assert(config);
  for (const name of envNames) {
    assert.equal(auth.getAuthConfig({ ...process.env, [name]: '' }), null, `${name} is required.`);
  }
  for (const origin of ['https://studio.example/', 'https://studio.example/path', 'https://studio.example?x=1', 'https://user:pass@studio.example', 'http://studio.example', 'null', 'file:///tmp']) {
    assert.equal(auth.getAuthConfig({ ...process.env, APP_ORIGIN: origin }), null, `Reject invalid origin ${origin}.`);
  }
  assert.equal(auth.getAuthConfig({ ...process.env, SESSION_SECRET: 'short' }), null);
  assert.equal(auth.getAuthConfig({ ...process.env, ADMIN_PASSWORD_HASH: passwordHash.replace('32768', '1048576') }), null);
  assert.equal(auth.getAuthConfig({ ...process.env, ADMIN_PASSWORD_HASH: `${passwordHash}=` }), null);
  assert.equal(auth.getAuthConfig({ ...process.env, ADMIN_USERNAME: ' director ' }), null);
  const localConfig = auth.getAuthConfig({ ...process.env, APP_ORIGIN: 'http://localhost:3000' });
  assert(localConfig);
  assert.equal(localConfig.secure, false);
  assert.equal(await auth.verifyCredentials('director', password, config), true);
  assert.equal(await auth.verifyCredentials('someone', password, config), false);
  assert.equal(await auth.verifyCredentials('director', 'wrong', config), false);
  assert.equal(await auth.verifyCredentials('director', 'я'.repeat(513), config), false);

  const token = auth.createSession(config, now);
  assert.equal(auth.verifySession(token, config, now), 'owner');
  assert.equal(auth.verifySession(token, config, now + auth.SESSION_TTL_SECONDS - 1), 'owner');
  assert.equal(auth.verifySession(token, config, now + auth.SESSION_TTL_SECONDS), null);
  assert.equal(auth.verifySession(token, config, now - 61), null);
  assert.equal(auth.verifySession(token, { ...config, sessionSecret: 'b'.repeat(64) }, now), null);
  assert.equal(auth.verifySession(token, { ...config, username: 'new-owner' }, now), null);
  assert.equal(auth.verifySession(token, { ...config, passwordHash: await auth.hashPassword('changed-password') }, now), null);
  const parts = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'someone-else', iat: now, exp: now + 100, nonce: 'a'.repeat(22) })).toString('base64url');
  assert.equal(auth.verifySession(`v1.${forgedPayload}.${parts[2]}`, config, now), null);
  for (const malformed of ['', `${token}.extra`, `v2.${parts[1]}.${parts[2]}`, `v1.${parts[1]}=.${parts[2]}`, `v1.${parts[1]}.abc`, 'x'.repeat(2048)]) {
    assert.equal(auth.verifySession(malformed, config, now), null);
  }
  function signPayload(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const key = createHmac('sha256', config.sessionSecret).update(`kadr-session-v1\0${config.username}\0${config.passwordHash}`).digest();
    return `v1.${encoded}.${createHmac('sha256', key).update(`v1.${encoded}`).digest('base64url')}`;
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  for (const changes of [{ sub: 'attacker' }, { exp: now + auth.SESSION_TTL_SECONDS + 1 }, { iat: now + 61 }, { exp: '9999999999' }, { nonce: 'not-valid' }]) {
    assert.equal(auth.verifySession(signPayload({ ...payload, ...changes }), config, now), null);
  }
  assert.equal(auth.authenticateRequest(new Request('https://studio.example', { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } })), 'owner');
  assert.equal(auth.authenticateRequest(new Request('https://studio.example', { headers: { 'x-oai-user-id': 'owner', 'x-forwarded-user': 'owner' } })), null);
  assert.equal(auth.authenticateRequest(new Request('https://studio.example', { headers: { cookie: `${auth.SESSION_COOKIE}=${token}; ${auth.SESSION_COOKIE}=anything` } })), null);
  assert.equal(auth.authenticateRequest(new Request('https://studio.example', { headers: { cookie: `${auth.SESSION_COOKIE}=${token}; extra=${'a'.repeat(17000)}` } })), null);
  const cookie = auth.sessionCookie(token, config);
  assert(cookie.includes('; HttpOnly; SameSite=Strict;'));
  assert(cookie.includes('; Path=/;'));
  assert(cookie.endsWith('; Secure'));
  assert(!auth.sessionCookie(token, localConfig).includes('; Secure'));
  assert(auth.expiredSessionCookie(config).includes('Max-Age=0'));

  auth.assertRequestOrigin(request({}));
  for (const origin of ['', 'null', 'https://attacker.example', 'https://studio.example.evil', 'https://studio.example/']) {
    assert.throws(() => auth.assertRequestOrigin(request({}, { headers: { origin, 'x-forwarded-host': 'studio.example' } })), (error) => error.status === 403);
  }
  assert.throws(() => auth.assertRequestOrigin(request({}, { headers: { 'sec-fetch-site': 'cross-site' } })), (error) => error.status === 403);
  assert.deepEqual(await auth.readLoginForm(request({ username: 'director', password })), { username: 'director', password });
  await assert.rejects(auth.readLoginForm(request({ username: 'director', password: 'x'.repeat(1025) })), (error) => error.status === 400);
  await assert.rejects(auth.readLoginForm(request('username=a&username=b&password=c')), (error) => error.status === 400);
  await assert.rejects(auth.readLoginForm(request('a'.repeat(4097))), (error) => error.status === 413);
  await assert.rejects(auth.readLoginForm(request('x', { headers: { 'content-length': '4097' } })), (error) => error.status === 413);
  await assert.rejects(auth.readLoginForm(request('{}', { headers: { 'content-type': 'application/json' } })), (error) => error.status === 415);

  const limiter = new auth.LoginLimiter();
  const first = limiter.acquire(1_000_000);
  const second = limiter.acquire(1_000_000);
  assert('release' in first && 'release' in second);
  assert.deepEqual(limiter.acquire(1_000_000), { retryAfter: 1 });
  first.release(); first.release(); // Releasing twice must not create extra slots.
  const third = limiter.acquire(1_000_000);
  assert('release' in third);
  assert.deepEqual(limiter.acquire(1_000_000), { retryAfter: 1 });
  third.release(); second.release();
  for (let i = 0; i < 7; i++) {
    const permit = limiter.acquire(1_000_000);
    assert('release' in permit);
    permit.release();
  }
  assert.deepEqual(limiter.acquire(1_000_000), { retryAfter: 300 });
  const propertyCount = Object.keys(limiter).length;
  for (let i = 0; i < 10000; i++) assert('retryAfter' in limiter.acquire(1_000_001));
  assert.equal(Object.keys(limiter).length, propertyCount, 'Rejected attempts retain no request data.');
  const renewed = limiter.acquire(1_300_000);
  assert('release' in renewed);
  renewed.release();

  const blockedLogin = await auth.login(request({ username: 'director', password }, { headers: { origin: 'https://evil.example' } }));
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.headers.get('set-cookie'), null);
  const failedLogin = await auth.login(request({ username: 'director', password: 'wrong' }));
  assert.equal(failedLogin.status, 303);
  assert.equal(failedLogin.headers.get('location'), `${config.origin}/login?error=credentials`);
  assert.equal(failedLogin.headers.get('set-cookie'), null);
  const success = await auth.login(request({ username: 'director', password, next: 'https://evil.example' }));
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), `${config.origin}/`, 'Redirect must ignore request host and next parameter.');
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(auth.authenticateRequest(new Request(config.origin, { headers: { cookie: success.headers.get('set-cookie').split(';')[0] } })), 'owner');
  const blockedLogout = await auth.logout(request({}, { headers: { origin: '' } }));
  assert.equal(blockedLogout.status, 403);
  assert.equal(blockedLogout.headers.get('set-cookie'), null);
  const logout = await auth.logout(request({}));
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get('location'), `${config.origin}/login`);
  assert(logout.headers.get('set-cookie').includes('Max-Age=0'));
  for (let i = 0; i < 8; i++) assert.equal((await auth.login(request('invalid'))).status, 400);
  const throttled = await auth.login(request({ username: 'director', password }));
  assert.equal(throttled.status, 429);
  assert(Number(throttled.headers.get('retry-after')) > 0);
  delete process.env.SESSION_SECRET;
  assert.equal(auth.authenticateRequest(new Request(config.origin, { headers: { cookie: `${auth.SESSION_COOKIE}=${token}` } })), null);
  assert.equal((await auth.login(request({ username: 'director', password }))).status, 503);
  assert.equal((await auth.logout(request({}))).status, 503);
  console.log('PASS auth: scrypt credentials, signed expiring sessions, rotation, fail-closed configuration, CSRF, safe cookies/redirects, bounded form parsing, and fixed-memory throttling. No external requests.');
} finally {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
