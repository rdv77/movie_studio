import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// CI builds movie-studio:test before invoking this script. Never start Docker
// Desktop, pull an image, or touch an existing container/volume here.
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(root, 'work', 'tests');
await mkdir(testRoot, { recursive: true });
const temporary = await mkdtemp(join(testRoot, 'container-smoke-'));
const envFile = join(temporary, 'container.env');
const volumeName = 'movie-studio-smoke-' + randomUUID();
const username = 'container-smoke-owner';
const password = randomBytes(32).toString('base64url');
const salt = randomBytes(16);
const passwordHash = `scrypt:32768:8:1:${salt.toString('base64url')}:${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`;
const sessionSecret = randomBytes(48).toString('base64url');
const vaultKey = randomBytes(32).toString('base64');
const secrets = [password, passwordHash, sessionSecret, vaultKey];
const redact = (value) => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
let containerId;
let createdVolume = false;
let origin;
let cookie;
const abort = new AbortController();
const onSignal = () => abort.abort(new Error('Container smoke test interrupted.'));
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

async function docker(args, timeout = 45000) {
  const result = await run('docker', args, { cwd: root, windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  return result.stdout.trim();
}

async function ephemeralPort() {
  return new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : accept(port));
    });
  });
}

async function http(path, options = {}) {
  abort.signal.throwIfAborted();
  return fetch(origin + path, {
    redirect: 'manual', ...options,
    headers: { origin, ...(cookie ? { cookie } : {}), ...options.headers },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    abort.signal.throwIfAborted();
    try {
      const response = await http('/api/health', { headers: { cookie: '' } });
      if (response.status === 200 && JSON.stringify(await response.json()) === '{"status":"ok"}') return;
    } catch (error) { if (abort.signal.aborted) throw error; }
    await delay(250, undefined, { signal: abort.signal });
  }
  throw new Error('Container /api/health did not become ready in 60 seconds.');
}

try {
  // Read-only checks fail promptly if Docker is unavailable or CI did not build.
  await docker(['info', '--format', '{{.ServerVersion}}'], 15000);
  await docker(['image', 'inspect', 'movie-studio:test', '--format', '{{.Id}}'], 15000);
  const port = await ephemeralPort();
  origin = `http://127.0.0.1:${port}`;
  const settings = {
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '0.0.0.0', PORT: '3000', DATA_DIR: '/app/data',
    APP_ORIGIN: origin, ADMIN_USERNAME: username, ADMIN_PASSWORD_HASH: passwordHash,
    SESSION_SECRET: sessionSecret, VAULT_KEY: vaultKey,
  };
  // Docker --env-file uses literal values; shell/dotenv quotes must not be added.
  await writeFile(envFile, Object.entries(settings).map(([name, value]) => `${name}=${value}\n`).join(''), { mode: 0o600, flag: 'wx' });
  await chmod(envFile, 0o600);
  if (process.platform !== 'win32') assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  assert.equal(await docker(['volume', 'create', volumeName]), volumeName);
  createdVolume = true;
  const createdId = await docker([
    'create', '--pull=never', '--env-file', envFile,
    '--publish', `127.0.0.1:${port}:3000`, '--mount', `type=volume,src=${volumeName},dst=/app/data`,
    'movie-studio:test',
  ]);
  assert.match(createdId, /^[a-f0-9]{64}$/, 'Docker must return the exact created container ID.');
  containerId = createdId;
  await docker(['start', containerId]);
  await waitForHealth();
  assert.equal((await http('/api/projects', { headers: { cookie: '' } })).status, 401);
  const login = await http('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  assert.equal(login.status, 303, 'Container owner login must succeed.');
  assert.equal(login.headers.get('location'), origin + '/');
  const setCookie = login.headers.get('set-cookie');
  assert(setCookie?.includes('HttpOnly') && setCookie.includes('SameSite=Strict'));
  cookie = setCookie.split(';')[0];
  secrets.push(cookie);
  assert.match(cookie, /^kadr_session=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const title = 'Container persistence ' + randomUUID();
  const created = await http('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  assert.equal(created.status, 201, 'Create project through the published container API.');
  const project = await created.json();
  assert.equal(project.title, title);
  assert.match(project.id, /^[a-f0-9-]{36}$/);
  await docker(['restart', '--time', '10', containerId]);
  await waitForHealth();
  assert.equal((await http('/api/projects', { headers: { cookie: '' } })).status, 401);
  const reread = await http('/api/projects/' + project.id);
  assert.equal(reread.status, 200, 'Signed session and project must survive container restart.');
  const persisted = await reread.json();
  assert.equal(persisted.id, project.id);
  assert.equal(persisted.title, title);
  assert.equal(persisted.revision, project.revision);
  const listed = await http('/api/projects');
  assert.equal(listed.status, 200);
  assert((await listed.json()).some((item) => item.id === project.id));
  console.log('PASS container HTTP: isolated named volume, startup migrations, public health, protected API, real owner login, and project/session persistence after restart. No provider requests.');
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  if (containerId) {
    try { console.error('Container logs (redacted):\n' + redact(await docker(['logs', '--tail', '80', containerId], 15000))); }
    catch { /* Preserve the original test failure if Docker became unavailable. */ }
  }
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  if (containerId) {
    assert.match(containerId, /^[a-f0-9]{64}$/);
    try { await docker(['rm', '--force', containerId], 30000); }
    catch (error) { console.error('Could not remove the created test container: ' + redact(error.message)); process.exitCode = 1; }
  }
  if (createdVolume) {
    assert.match(volumeName, /^movie-studio-smoke-[a-f0-9-]{36}$/);
    try { await docker(['volume', 'rm', volumeName], 15000); }
    catch (error) { console.error('Could not remove the created test volume: ' + redact(error.message)); process.exitCode = 1; }
  }
  const actualRoot = await realpath(testRoot);
  const actualTemporary = await realpath(temporary);
  const within = relative(actualRoot, actualTemporary);
  assert(within && !within.startsWith('..') && !isAbsolute(within) && dirname(actualTemporary) === actualRoot && within.startsWith('container-smoke-'), 'Refuse cleanup outside the exact temporary test directory.');
  await rm(actualTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
