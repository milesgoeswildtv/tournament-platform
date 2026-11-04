import type { Env } from './env';
import { HttpError, readJson, str, json, clientIp, type RouteCtx } from './http';
import { b64url, hashPassword, newId, newTag, now, randomBytes, rateLimit, sha256Hex, timingSafeEqual } from './security';
import { validateInitData } from './telegram';
import { LINK_PREFIX, attachTelegram, consumeLinkToken, issueLinkToken, type LinkOutcome } from './identity';

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
  merged_into?: string | null;
  discord_id?: string | null;
  discord_username?: string | null;
}

export interface AuthUser {
  id: string;
  tag: string;
  handle: string | null;
  name: string;
  isAdmin: boolean;
  telegram: boolean;
  discord: boolean;
  createdAt: number;
}

export const publicUser = (u: UserRow): AuthUser => ({
  id: u.id,
  tag: u.tag,
  handle: u.handle,
  name: u.display_name,
  isAdmin: !!u.is_admin,
  telegram: !!u.telegram_id,
  discord: !!u.discord_id,
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
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.merged_into IS NULL`,
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

export async function createSession(env: Env, userId: string, ua: string | null) {
  const token = b64url(randomBytes(32));
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, t, t + SESSION_DAYS * 86_400_000, (ua ?? '').slice(0, 200))
    .run();
  return token;
}

export async function uniqueTag(env: Env): Promise<string> {
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
  // Generous per-IP cap: venues and mobile carriers put many players behind one address.
  await rateLimit(c.env, `register:${clientIp(c.req)}`, 40, 3600);
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
  const admin = 0; // Privileged access is never assigned during public registration.
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
  await rateLimit(c.env, `login:${ip}`, 60, 600);
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
 *
 * Resolution, in order (see identity.ts):
 *  1. start_param link_<token>: the token names the SHYST player who asked to
 *     link; Telegram is attached to that player and the Mini App signs in as it.
 *  2. a player already linked to this Telegram account signs in.
 *  3. a SHYST session already open inside the Mini App gets Telegram attached.
 *     A different signed-in player is never swapped out silently.
 *  4. otherwise this is a new person: a Telegram-only player is created.
 */
export async function telegramAuth(c: RouteCtx): Promise<Response> {
  if (!c.env.TELEGRAM_BOT_TOKEN) throw new HttpError(503, 'telegram_not_configured', 'Telegram sign-in is not configured on this server.');
  await rateLimit(c.env, `tg:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req);
  const data = await validateInitData(String(body.initData ?? ''), c.env.TELEGRAM_BOT_TOKEN);
  if (!data) throw new HttpError(401, 'invalid_telegram_auth', 'Telegram sign-in could not be verified.');
  const tg = { id: String(data.user.id), username: data.user.username ?? null };
  const t = now();
  const current = await optionalUser(c);
  let startParam = data.startParam;
  let link: { ok: boolean; message: string; reconciled?: string } | null = null;
  let user: UserRow | null = null;

  const report = (o: LinkOutcome, verb: string) => {
    link = o.ok ? { ok: true, message: o.already ? 'Telegram was already linked to this player.' : verb, reconciled: o.reconciled?.tag } : { ok: false, message: o.message };
    return o.ok ? o.user : null;
  };

  if (startParam?.startsWith(LINK_PREFIX)) {
    const target = await consumeLinkToken(c.env, startParam.slice(LINK_PREFIX.length), tg.id);
    startParam = null;
    if (target) user = report(await attachTelegram(c.env, target, tg, 'miniapp'), 'Telegram linked.');
    else link = { ok: false, message: 'That link has expired or was already used. Start again from Settings.' };
  }
  if (!user) user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id = ? AND merged_into IS NULL').bind(tg.id).first<UserRow>();
  if (!link && current && !current.telegram_id && current.id !== user?.id) {
    const linked = report(await attachTelegram(c.env, current, tg, 'miniapp-session'), 'Telegram linked.');
    // Keep the player who is signed in here, even when the link was refused.
    user = linked ?? current;
  }
  if (!user) {
    const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ').trim() || data.user.username || `Player ${tg.id.slice(-4)}`;
    const id = newId('u');
    await c.env.DB.prepare(
      'INSERT INTO users (id, tag, handle, display_name, telegram_id, telegram_username, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
    )
      .bind(id, await uniqueTag(c.env), name.replace(/[<>]/g, '').slice(0, 24).padEnd(2, '_'), tg.id, tg.username, t, t)
      .run();
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  }
  const token = await createSession(c.env, user!.id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user!), startParam, link });
}

/**
 * Starts linking Telegram to the signed-in player: issues a single-use token
 * and returns the Telegram links that carry it (bot chat and, if registered,
 * the Mini App).
 */
export async function startTelegramLink(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  const bot = c.env.TELEGRAM_BOT_USERNAME;
  if (!c.env.TELEGRAM_BOT_TOKEN || !bot) throw new HttpError(503, 'telegram_not_configured', 'Telegram isn’t set up on this server.');
  if (u.telegram_id) return json({ linked: true, telegramUsername: u.telegram_username });
  await rateLimit(c.env, `tglink:${u.id}`, 10, 3600);
  const { token, expiresAt } = await issueLinkToken(c.env, u.id);
  const param = `${LINK_PREFIX}${token}`;
  return json({
    linked: false,
    expiresAt,
    botUrl: `https://t.me/${bot}?start=${param}`,
    miniAppUrl: c.env.TELEGRAM_MINIAPP_SHORTNAME ? `https://t.me/${bot}/${c.env.TELEGRAM_MINIAPP_SHORTNAME}?startapp=${param}` : null,
  });
}

/** Add username/password sign-in to an existing provider-created player, or change its credentials. */
export async function setPasswordLogin(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  await rateLimit(c.env, `password-link:${u.id}`, 8, 3600);
  const body = await readJson(c.req);
  const handle = (typeof body.handle === 'string' ? body.handle : u.handle ?? '').trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) throw new HttpError(400, 'invalid_input', 'Username: 3–20 letters, numbers or underscores', { field: 'handle' });
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'invalid_input', 'Password must be 8–128 characters', { field: 'password' });
  if (u.password_hash) {
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const check = await hashPassword(current, u.password_salt ?? 'AAAAAAAAAAAAAAAAAAAAAA==');
    if (!timingSafeEqual(check.hash, u.password_hash)) throw new HttpError(401, 'invalid_current_password', 'Enter your current password to change it.', { field: 'currentPassword' });
  }
  const taken = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ? AND id <> ? AND merged_into IS NULL').bind(handle, u.id).first<{ id: string }>();
  if (taken) throw new HttpError(409, 'handle_taken', 'That username is already in use.', { field: 'handle' });
  const credentials = await hashPassword(password);
  const t = now();
  await c.env.DB.prepare('UPDATE users SET handle = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .bind(handle, credentials.hash, credentials.salt, t, u.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<UserRow>();
  return json({ user: publicUser(updated!) });
}

export async function updateMe(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  await rateLimit(c.env, `profile:${u.id}`, 20, 3600);
  const body = await readJson(c.req);
  const name = displayName(body.displayName);
  await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(name, now(), u.id).run();
  return json({ user: publicUser({ ...u, display_name: name }) });
}
