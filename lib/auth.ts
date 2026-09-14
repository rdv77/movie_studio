import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'kadr_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MAX_PASSWORD_BYTES = 1024;
const PASSWORD_PREFIX = 'scrypt:32768:8:1:';
const MAX_LOGIN_BODY_BYTES = 4096;

export type AuthConfig = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  origin: string;
  secure: boolean;
};

export class AuthRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthRequestError';
  }
}

function decodeBase64Url(value: string, bytes?: number): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (bytes !== undefined && decoded.length !== bytes)) return null;
  return decoded;
}

function parsePasswordHash(value: string) {
  if (!value.startsWith(PASSWORD_PREFIX)) return null;
  const parts = value.slice(PASSWORD_PREFIX.length).split(':');
  if (parts.length !== 2) return null;
  const salt = decodeBase64Url(parts[0], 16);
  const digest = decodeBase64Url(parts[1], 64);
  return salt && digest ? { salt, digest } : null;
}

/** Missing or invalid settings always disable authentication. */
export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const username = env.ADMIN_USERNAME;
  const passwordHash = env.ADMIN_PASSWORD_HASH;
  const sessionSecret = env.SESSION_SECRET;
  const origin = env.APP_ORIGIN;
  if (!username || username.trim() !== username || username.length > 128 || /[\x00-\x1f\x7f]/.test(username)) return null;
  if (!passwordHash || !parsePasswordHash(passwordHash)) return null;
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32 || Buffer.byteLength(sessionSecret) > 4096) return null;
  if (!origin || origin.length > 2048) return null;
  try {
    const url = new URL(origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) return null;
    return { username, passwordHash, sessionSecret, origin, secure: url.protocol === 'https:' };
  } catch {
    return null;
  }
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/** Colon delimiters are safe from Next.js .env dollar-sign expansion. */
export async function hashPassword(password: string): Promise<string> {
  if (!password || Buffer.byteLength(password) > MAX_PASSWORD_BYTES) throw new Error('Password must contain 1–1024 UTF-8 bytes.');
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt);
  return `${PASSWORD_PREFIX}${salt.toString('base64url')}:${digest.toString('base64url')}`;
}

export async function verifyCredentials(username: string, password: string, config: AuthConfig): Promise<boolean> {
  if (!password || Buffer.byteLength(password) > MAX_PASSWORD_BYTES || username.length > 128) return false;
  const parsed = parsePasswordHash(config.passwordHash);
  if (!parsed) return false;
  // Derive even for an unknown username, keeping the failure path equivalent.
  const digest = await derivePassword(password, parsed.salt);
  const passwordMatches = timingSafeEqual(digest, parsed.digest);
  const expectedUsername = Buffer.from(config.username);
  const actualUsername = Buffer.from(username);
  const usernameMatches = actualUsername.length === expectedUsername.length && timingSafeEqual(actualUsername, expectedUsername);
  return passwordMatches && usernameMatches;
}

function sessionKey(config: AuthConfig) {
  return createHmac('sha256', config.sessionSecret)
    .update(`kadr-session-v1\0${config.username}\0${config.passwordHash}`)
    .digest();
}

export function createSession(config: AuthConfig, now = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ sub: 'owner', iat: now, exp: now + SESSION_TTL_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  const signed = `v1.${payload}`;
  const signature = createHmac('sha256', sessionKey(config)).update(signed).digest('base64url');
  return `${signed}.${signature}`;
}

export function verifySession(token: string, config: AuthConfig, now = Math.floor(Date.now() / 1000)): 'owner' | null {
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const payload = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2], 32);
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', sessionKey(config)).update(`v1.${parts[1]}`).digest();
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(payload.toString('utf8'));
    if (!session || session.sub !== 'owner' || !Number.isSafeInteger(session.iat) || !Number.isSafeInteger(session.exp)) return null;
    if (session.iat > now + 60 || session.exp <= now || session.exp <= session.iat || session.exp - session.iat > SESSION_TTL_SECONDS) return null;
    if (typeof session.nonce !== 'string' || !decodeBase64Url(session.nonce, 16)) return null;
    return 'owner';
  } catch {
    return null;
  }
}

export function authenticateRequest(req: Request): 'owner' | null {
  const config = getAuthConfig();
  if (!config) return null;
  const cookie = req.headers.get('cookie') || '';
  if (cookie.length > 16384) return null;
  const values = cookie.split(';').map((item) => item.trim()).filter((item) => item.startsWith(`${SESSION_COOKIE}=`));
  // Duplicate cookies are ambiguous and must not select an arbitrary identity.
  if (values.length !== 1) return null;
  return verifySession(values[0].slice(SESSION_COOKIE.length + 1), config);
}

export function assertRequestOrigin(req: Request): void {
  const config = getAuthConfig();
  if (!config) throw new AuthRequestError('Вход не настроен на сервере.', 503);
  if (req.headers.get('origin') !== config.origin) throw new AuthRequestError('Недопустимый источник запроса.', 403);
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new AuthRequestError('Недопустимый источник запроса.', 403);
}

export function sessionCookie(token: string, config: AuthConfig): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${config.secure ? '; Secure' : ''}`;
}

export function expiredSessionCookie(config: AuthConfig): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${config.secure ? '; Secure' : ''}`;
}

/** A fixed-size limiter for a single-owner process; no untrusted IP headers or unbounded maps. */
export class LoginLimiter {
  private start = 0;
  private attempts = 0;
  private active = 0;
  private readonly windowMs = 5 * 60 * 1000;

  acquire(now = Date.now()): { release: () => void } | { retryAfter: number } {
    if (now >= this.start + this.windowMs || now < this.start) {
      this.start = now;
      this.attempts = 0;
    }
    if (this.active >= 2) return { retryAfter: 1 };
    if (this.attempts >= 10) return { retryAfter: Math.max(1, Math.ceil((this.start + this.windowMs - now) / 1000)) };
    this.attempts++;
    this.active++;
    let released = false;
    return { release: () => {
      if (!released) this.active--;
      released = true;
    } };
  }
}

// Share between route module reloads in development without retaining request data.
const authGlobal = globalThis as typeof globalThis & { kadrLoginLimiter?: LoginLimiter };
export const loginLimiter = authGlobal.kadrLoginLimiter ??= new LoginLimiter();

export async function readLoginForm(req: Request): Promise<{ username: string; password: string }> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    throw new AuthRequestError('Ожидается форма входа.', 415);
  }
  const declaredLength = req.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_LOGIN_BODY_BYTES)) throw new AuthRequestError('Форма слишком большая.', 413);
  if (!req.body) throw new AuthRequestError('Заполните имя пользователя и пароль.', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LOGIN_BODY_BYTES) {
        await reader.cancel();
        throw new AuthRequestError('Форма слишком большая.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const usernames = form.getAll('username');
  const passwords = form.getAll('password');
  if (usernames.length !== 1 || passwords.length !== 1 || !usernames[0] || usernames[0].length > 128 || !passwords[0] || Buffer.byteLength(passwords[0]) > MAX_PASSWORD_BYTES) {
    throw new AuthRequestError('Заполните имя пользователя и пароль.', 400);
  }
  return { username: usernames[0], password: passwords[0] };
}
