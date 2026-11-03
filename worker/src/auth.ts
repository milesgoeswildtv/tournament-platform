import type { Env } from './env';
import { HttpError, readJson, str, json, clientIp, type RouteCtx } from './http';
import { b64url, hashPassword, newId, newTag, now, randomBytes, rateLimit, sha256Hex, timingSafeEqual } from './security';
import { validateInitData } from './telegram';

export interface UserRow {
  id: string;
  tag: string;
  handle: string | null;
  display_name: string;
  password_hash: string | null;
  password_salt: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  is_admin: number;
  created_at: number;
}

export interface AuthUser {
  id: string;
  tag: string;
  handle: string | null;
  name: string;
  isAdmin: boolean;
  telegram: boolean;
  createdAt: number;
}

export const publicUser = (u: UserRow): AuthUser => ({
  id: u.id,
  tag: u.tag,
  handle: u.handle,
  name: u.display_name,
  isAdmin: !!u.is_admin,
  telegram: !!u.telegram_id,
  createdAt: u.created_at,
});

const SESSION_DAYS = 30;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (h?.startsWith('Bearer ')) return h.slice(7).trim() || null;
  return null;
}

export async function userFromToken(env: Env, token: string | null): Promise<UserRow | null> {
  if (!token || token.length > 128) return null;
  const hash = await sha256Hex(token);
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, now())
    .first<UserRow>();
}

export async function requireUser(c: RouteCtx): Promise<UserRow> {
  const u = await userFromToken(c.env, bearer(c.req));
  if (!u) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  return u;
}

export async function optionalUser(c: RouteCtx): Promise<UserRow | null> {
  return userFromToken(c.env, bearer(c.req));
}

async function createSession(env: Env, userId: string, ua: string | null) {
  const token = b64url(randomBytes(32));
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, t, t + SESSION_DAYS * 86_400_000, (ua ?? '').slice(0, 200))
    .run();
  return token;
}

async function uniqueTag(env: Env): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const tag = newTag();
    const hit = await env.DB.prepare('SELECT 1 FROM users WHERE tag = ?').bind(tag).first();
    if (!hit) return tag;
  }
  throw new HttpError(500, 'tag_exhausted');
}

function displayName(v: unknown): string {
  const s = str(v, 'Display name', 2, 24).replace(/\s+/g, ' ');
  if (/[<>]/.test(s)) throw new HttpError(400, 'invalid_input', 'Display name contains invalid characters', { field: 'displayName' });
  return s;
}

export async function register(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `register:${clientIp(c.req)}`, 10, 3600);
  const body = await readJson(c.req);
  const handle = str(body.handle, 'Username', 3, 20).toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new HttpError(400, 'invalid_input', 'Username: 3–20 letters, numbers or underscores', { field: 'handle' });
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'invalid_input', 'Password must be at least 8 characters', { field: 'password' });
  const name = displayName(body.displayName ?? handle);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE handle = ?').bind(handle).first();
  if (exists) throw new HttpError(409, 'handle_taken', 'That username is taken.', { field: 'handle' });
  const { hash, salt } = await hashPassword(password);
  const id = newId('u');
  const t = now();
  const admin = (c.env.ADMIN_HANDLES ?? '').split(',').map((s) => s.trim().toLowerCase()).includes(handle) ? 1 : 0;
  await c.env.DB.prepare(
    'INSERT INTO users (id, tag, handle, display_name, password_hash, password_salt, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, await uniqueTag(c.env), handle, name, hash, salt, admin, t, t)
    .run();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  const token = await createSession(c.env, id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user!) }, 201);
}

export async function login(c: RouteCtx): Promise<Response> {
  const ip = clientIp(c.req);
  await rateLimit(c.env, `login:${ip}`, 20, 600);
  const body = await readJson(c.req);
  const handle = typeof body.handle === 'string' ? body.handle.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  await rateLimit(c.env, `login-user:${handle}`, 10, 600);
  const user = handle ? await c.env.DB.prepare('SELECT * FROM users WHERE handle = ?').bind(handle).first<UserRow>() : null;
  // Always derive a hash so response time doesn't reveal whether the user exists.
  const { hash } = await hashPassword(password, user?.password_salt ?? 'AAAAAAAAAAAAAAAAAAAAAA==');
  if (!user || !user.password_hash || !timingSafeEqual(hash, user.password_hash)) {
    throw new HttpError(401, 'invalid_credentials', 'Wrong username or password.');
  }
  const token = await createSession(c.env, user.id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user) });
}

export async function logout(c: RouteCtx): Promise<Response> {
  const token = bearer(c.req);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

/**
 * Telegram Mini App sign-in. The signed initData is validated with the bot
 * token; nothing the browser claims about the user is trusted on its own.
 * If a signed-in browser session is present, the Telegram account is linked to it.
 */
export async function telegramAuth(c: RouteCtx): Promise<Response> {
  if (!c.env.TELEGRAM_BOT_TOKEN) throw new HttpError(503, 'telegram_not_configured', 'Telegram sign-in is not configured on this server.');
  await rateLimit(c.env, `tg:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req);
  const data = await validateInitData(String(body.initData ?? ''), c.env.TELEGRAM_BOT_TOKEN);
  if (!data) throw new HttpError(401, 'invalid_telegram_auth', 'Telegram sign-in could not be verified.');
  const tgId = String(data.user.id);
  const t = now();
  let user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(tgId).first<UserRow>();
  const current = await optionalUser(c);
  if (!user && current && !current.telegram_id) {
    await c.env.DB.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, updated_at = ? WHERE id = ?')
      .bind(tgId, data.user.username ?? null, t, current.id)
      .run();
    user = { ...current, telegram_id: tgId };
  }
  if (!user) {
    const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ').trim() || data.user.username || `Player ${tgId.slice(-4)}`;
    const id = newId('u');
    await c.env.DB.prepare(
      'INSERT INTO users (id, tag, handle, display_name, telegram_id, telegram_username, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
    )
      .bind(id, await uniqueTag(c.env), name.replace(/[<>]/g, '').slice(0, 24).padEnd(2, '_'), tgId, data.user.username ?? null, t, t)
      .run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  }
  const token = await createSession(c.env, user!.id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user!), startParam: data.startParam });
}

export async function updateMe(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  await rateLimit(c.env, `profile:${u.id}`, 20, 3600);
  const body = await readJson(c.req);
  const name = displayName(body.displayName);
  await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(name, now(), u.id).run();
  return json({ user: publicUser({ ...u, display_name: name }) });
}
