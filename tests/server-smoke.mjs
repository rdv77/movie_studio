import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate } from '../scripts/migrate.mjs';

// Own the entire server lifecycle and data directory. No developer credentials,
// existing servers, model API calls, or persisted secrets are used by this test.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(existsSync(join(root, '.next', 'BUILD_ID')), 'Build production first with npm run build.');
const tempRoot = join(root, 'work', 'tests');
await mkdir(tempRoot, { recursive: true });
const temp = await mkdtemp(join(tempRoot, 'server-smoke-'));
const dataDir = join(temp, 'data');
const username = 'smoke-owner';
const password = randomBytes(32).toString('base64url');
const salt = randomBytes(16);
const passwordHash = `scrypt:32768:8:1:${salt.toString('base64url')}:${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`;
const sessionSecret = randomBytes(48).toString('base64url');
const vaultKey = randomBytes(32);
const fakeProviderKey = 'sk-smoke-never-send-' + randomBytes(32).toString('base64url');
const secrets = [password, passwordHash, sessionSecret, vaultKey.toString('base64'), fakeProviderKey];
const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
let server;
let serverClosed;
let output = '';
let apiChild;
let cookie;
let origin;
const abort = new AbortController();
const onSignal = () => abort.abort(new Error('Smoke test interrupted.'));
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

async function choosePort() {
  const probe = (port) => new Promise((accept, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => {
      const selected = socket.address().port;
      socket.close((error) => error ? reject(error) : accept(selected));
    });
  });
  try { return await probe(3107); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; return probe(0); }
}

async function stopServer() {
  if (!server) return;
  const child = server;
  const closed = serverClosed;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  let timer;
  try {
    await Promise.race([closed, new Promise((_, reject) => {
      timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Production server did not stop in time.')); }, 8000);
    })]);
  } finally { clearTimeout(timer); server = undefined; }
}

async function startServer(env) {
  abort.signal.throwIfAborted();
  output = '';
  server = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(origin).port], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const child = server;
  let startupError;
  child.once('error', (error) => { startupError = error; });
  serverClosed = new Promise((accept) => child.once('close', accept));
  const collect = (chunk) => { output = (output + redact(chunk.toString())).slice(-32000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    abort.signal.throwIfAborted();
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Production server exited before readiness.');
    try {
      const health = await fetch(origin + '/api/health', { redirect: 'manual', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1500)]) });
      if (health.status === 200 && JSON.stringify(await health.json()) === '{"status":"ok"}') return;
    } catch (error) { if (abort.signal.aborted) throw error; }
    await delay(150, undefined, { signal: abort.signal });
  }
  throw new Error('Production health endpoint did not become ready in 45 seconds.');
}

async function http(path, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
  return fetch(origin + path, {
    method, redirect: 'manual', headers: {
      origin, ...(authenticated && cookie ? { cookie } : {}),
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers,
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
  });
}

async function json(path, options, status = 200) {
  const response = await http(path, options);
  const value = await response.text();
  assert.equal(response.status, status, `${options?.method || 'GET'} ${path}: ${redact(value.slice(0, 500))}`);
  assert(!value.includes(fakeProviderKey), 'API response must never echo a stored provider key.');
  return JSON.parse(value);
}

async function login({ submittedPassword = password, submittedOrigin = origin } = {}) {
  return fetch(origin + '/api/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { origin: submittedOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: submittedPassword, next: 'https://untrusted.example/' }),
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
  });
}

function inspectDatabase(fn) {
  const db = new DatabaseSync(join(dataDir, 'studio.sqlite'), { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

async function runDomainTests(env) {
  await new Promise((accept, reject) => {
    apiChild = spawn(process.execPath, [join(root, 'tests', 'api.mjs')], {
      cwd: root, env: { ...env, TEST_ORIGIN: origin, TEST_USERNAME: username, TEST_PASSWORD: password },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: abort.signal,
    });
    let domainOutput = '';
    const collect = (chunk) => { domainOutput = (domainOutput + redact(chunk.toString())).slice(-16000); };
    apiChild.stdout.on('data', collect); apiChild.stderr.on('data', collect);
    apiChild.once('error', reject);
    const timeout = setTimeout(() => { apiChild?.kill('SIGKILL'); }, 120000);
    apiChild.once('close', (code) => {
      clearTimeout(timeout); apiChild = undefined;
      if (code === 0) { process.stdout.write(domainOutput); accept(); }
      else reject(new Error(`Domain HTTP tests exited ${code}.\n${domainOutput}`));
    });
  });
}

try {
  const port = await choosePort();
  origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DATA_DIR: dataDir,
    HOSTNAME: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, ADMIN_USERNAME: username,
    ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: sessionSecret, VAULT_KEY: vaultKey.toString('base64'),
  };
  migrate(dataDir);
  await startServer(env);
  console.log('Production test server ready; checking authentication and isolated HTTP workflows.');
  assert.equal((await http('/api/projects', { authenticated: false })).status, 401);
  for (const headers of [{ 'x-oai-user-id': 'owner', 'x-oai-user-email': 'owner@example.test' }, { cookie: '__sites_local_auth=1' }, { 'x-forwarded-user': 'owner' }]) {
    assert.equal((await http('/api/projects', { authenticated: false, headers })).status, 401, 'Legacy or spoofed identity must not authenticate.');
  }
  const rootRedirect = await http('/', { authenticated: false });
  assert.equal(rootRedirect.status, 307);
  assert.equal(new URL(rootRedirect.headers.get('location'), origin).pathname, '/login');
  const loginPage = await http('/login', { authenticated: false });
  assert.equal(loginPage.status, 200);
  assert((await loginPage.text()).includes('/api/auth/login'));
  const rejectedOrigin = await login({ submittedOrigin: 'https://untrusted.example' });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.headers.get('set-cookie'), null);
  const incorrect = await login({ submittedPassword: 'incorrect-test-password' });
  assert.equal(incorrect.status, 303);
  assert.equal(incorrect.headers.get('set-cookie'), null);
  assert.equal(incorrect.headers.get('location'), origin + '/login?error=credentials');
  const validLogin = await login();
  assert.equal(validLogin.status, 303);
  assert.equal(validLogin.headers.get('location'), origin + '/', 'Ignore arbitrary next parameter.');
  const setCookie = validLogin.headers.get('set-cookie');
  assert(setCookie?.includes('HttpOnly') && setCookie.includes('SameSite=Strict') && setCookie.includes('Path=/'));
  cookie = setCookie.split(';')[0]; secrets.push(cookie);
  assert.match(cookie, /^kadr_session=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const signatureStart = cookie.lastIndexOf('.') + 1;
  const forgedCookie = cookie.slice(0, signatureStart) + (cookie[signatureStart] === 'a' ? 'b' : 'a') + cookie.slice(signatureStart + 1);
  assert.equal((await http('/api/projects', { headers: { cookie: forgedCookie } })).status, 401);
  assert.equal((await http('/', {})).status, 200);
  assert.equal((await http('/api/projects', { method: 'POST', body: { title: 'Blocked' }, headers: { origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await http('/api/projects', { method: 'POST', body: { title: 'Blocked' }, headers: { origin: '' } })).status, 403);
  assert.equal((await http('/api/auth/logout', { method: 'POST', headers: { origin: 'https://untrusted.example' } })).status, 403);

  // These existing domain cases deliberately run before the dummy credential is saved.
  await runDomainTests(env);
  let project = await json('/api/projects', { method: 'POST', body: { title: 'Production persistence smoke' } }, 201);
  const projectId = project.id;
  const projectPath = '/api/projects/' + projectId;
  const scriptId = project.items[0].id;
  for (let index = 0; index < 8; index++) {
    project = await json(projectPath, { method: 'PATCH', body: {
      revision: project.revision, action: 'addVariant', itemId: scriptId,
      data: { title: 'Large text ' + index, kind: 'text', text: `${index}:` + 'x'.repeat(70000) },
    } });
  }
  assert(Buffer.byteLength(JSON.stringify(project)) > 512000, 'Project exceeds the snapshot storage threshold.');
  const expectedRevision = project.revision;
  const pointer = inspectDatabase((db) => JSON.parse(db.prepare('SELECT state FROM projects WHERE id=? AND owner=?').get(projectId, 'owner').state));
  assert.equal(pointer.$kadrProjectState, 'r2-v1', 'Large project must use a private snapshot.');
  assert(pointer.size > 512000);
  assert.equal((await json(projectPath)).items[0].variants.length, 8);

  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=', 'base64');
  const upload = new FormData();
  upload.set('file', new File([imageBytes], 'production-smoke.png', { type: 'image/png' }));
  const asset = await json('/api/assets', { method: 'POST', body: upload }, 201);
  const assetPath = '/api/assets/' + asset.id;
  const downloaded = await http(assetPath);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.equal(downloaded.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), imageBytes);
  for (const [range, start, end] of [['bytes=0-7', 0, 7], ['bytes=8-', 8, imageBytes.length - 1], ['bytes=-8', imageBytes.length - 8, imageBytes.length - 1]]) {
    const response = await http(assetPath, { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${imageBytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageBytes.subarray(start, end + 1));
  }
  for (const range of [`bytes=${imageBytes.length}-`, 'bytes=8-2', 'bytes=0-1,3-4']) {
    const response = await http(assetPath, { headers: { range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${imageBytes.length}`);
  }
  assert.equal((await http(assetPath, { authenticated: false })).status, 401);
  const assets = await json('/api/assets');
  assert(!assets.some((item) => item.id === pointer.key), 'Private project snapshots must not become media assets.');

  assert.equal((await json('/api/connections')).vaultReady, true);
  assert.deepEqual(await json('/api/connections', { method: 'POST', body: { provider: 'openai', key: fakeProviderKey } }), { saved: true });
  const connections = await json('/api/connections');
  assert.equal(connections.providers.find((item) => item.id === 'openai').configured, true);
  const encrypted = inspectDatabase((db) => db.prepare('SELECT cipher FROM credentials WHERE owner=? AND provider=?').get('owner', 'openai').cipher);
  assert(!encrypted.includes(fakeProviderKey), 'Credential must be encrypted in SQLite.');
  const cipher = JSON.parse(encrypted);
  const cipherBytes = Buffer.from(cipher.data);
  const decipher = createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(cipher.iv));
  decipher.setAAD(Buffer.from('owner:openai'));
  decipher.setAuthTag(cipherBytes.subarray(-16));
  const plain = Buffer.concat([decipher.update(cipherBytes.subarray(0, -16)), decipher.final()]).toString('utf8');
  assert(plain === fakeProviderKey, 'Saved ciphertext must decrypt only with the configured vault key and owner/provider binding.');
  for (const suffix of ['', '-wal']) {
    const filename = join(dataDir, 'studio.sqlite' + suffix);
    if (existsSync(filename)) assert(!(await readFile(filename)).includes(Buffer.from(fakeProviderKey)), 'Database files must not contain the plaintext provider key.');
  }

  await stopServer();
  await startServer(env);
  const restored = await json(projectPath);
  assert.equal(restored.revision, expectedRevision);
  assert.equal(restored.items[0].variants.length, 8);
  assert.equal(restored.items[0].variants[7].text, '7:' + 'x'.repeat(70000));
  assert.deepEqual(Buffer.from(await (await http(assetPath)).arrayBuffer()), imageBytes);
  assert.equal((await json('/api/connections')).providers.find((item) => item.id === 'openai').configured, true);
  assert.deepEqual(await json('/api/connections', { method: 'DELETE', body: { provider: 'openai' } }), { removed: true });
  assert.equal((await json('/api/connections')).providers.find((item) => item.id === 'openai').configured, false);
  const logout = await http('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get('location'), origin + '/login');
  assert(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  cookie = logout.headers.get('set-cookie').split(';')[0];
  assert.equal((await http('/api/projects')).status, 401);
  console.log('PASS production HTTP: owner login/logout, signed sessions, legacy/spoof rejection, CSRF, domain workflows, persisted >512 KB snapshot, media and byte ranges/416, encrypted credentials, and restart persistence. No paid requests.');
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  if (output) console.error('Production server output (redacted):\n' + redact(output));
  process.exitCode = 1;
} finally {
  if (apiChild) apiChild.kill('SIGKILL');
  try { await stopServer(); }
  finally {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    const actualRoot = await realpath(tempRoot);
    const actualTemp = await realpath(temp);
    const within = relative(actualRoot, actualTemp);
    assert(within && !within.startsWith('..') && !isAbsolute(within) && dirname(actualTemp) === actualRoot && within.startsWith('server-smoke-'), 'Refuse cleanup outside the exact temporary test directory.');
    await rm(actualTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
