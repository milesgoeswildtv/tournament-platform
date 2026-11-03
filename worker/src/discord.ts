/**
 * Discord sign-in (OAuth2 authorization-code flow).
 *
 * The SHYST player is the identity; Discord is a provider attached to it by
 * its user id (a snowflake), never by username. Access tokens are used once
 * to read the user id and then revoked; nothing from Discord but the id and a
 * display username is stored.
 *
 *   POST /api/auth/discord/start     { mode: 'login' | 'link', next? }  → { url }
 *        (link mode needs the player's session; the state row remembers who)
 *   GET  /api/auth/discord/callback  Discord redirects here with code + state
 *        → known Discord id: one-time session ticket   → APP/auth/discord#ticket=…
 *        → unknown Discord id: pending identity        → APP/auth/discord#pending=…
 *        → link mode: attached (or refused)            → APP/settings?discord=…
 *   POST /api/auth/discord/exchange  { ticket }   → session
 *   POST /api/auth/discord/complete  { pending, action: 'create' | 'link' } → session
 *        'link' attaches the pending Discord identity to the signed-in player
 *
 * Never: auto-creating a player for an unknown Discord id, merging two players,
 * or replacing a Telegram or Discord identity already on a player.
 */
import type { Env } from './env';
import { HttpError, json, readJson, clientIp, type RouteCtx } from './http';
import { b64url, newId, now, randomBytes, rateLimit, sha256Hex } from './security';
import { createSession, optionalUser, publicUser, requireUser, uniqueTag, type UserRow } from './auth';

const STATE_TTL = 10 * 60_000;
const PENDING_TTL = 15 * 60_000;
const TICKET_TTL = 2 * 60_000;
const SNOWFLAKE = /^\d{5,25}$/;

export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
}

export const discordConfigured = (env: Env) => !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
const apiBase = (env: Env) => (env.ENVIRONMENT !== 'production' && env.DISCORD_API_BASE) || 'https://discord.com/api';
const authorizeUrl = (env: Env) => (env.ENVIRONMENT !== 'production' && env.DISCORD_AUTHORIZE_URL) || 'https://discord.com/oauth2/authorize';
const redirectUri = (env: Env, req: Request) => env.DISCORD_REDIRECT_URI || new URL('/api/auth/discord/callback', req.url).toString();

function safeNext(v: unknown): string {
  return typeof v === 'string' && /^\/(?!\/)[\w\-/?=&.%#]*$/.test(v) && v.length < 200 ? v : '/';
}

async function putFlow(env: Env, kind: string, userId: string | null, payload: unknown, ttl: number): Promise<string> {
  const token = b64url(randomBytes(24));
  const t = now();
  await env.DB.prepare('INSERT INTO auth_flows (token_hash, kind, user_id, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), kind, userId, JSON.stringify(payload ?? null), t, t + ttl)
    .run();
  return token;
}

/** Single use: the row is claimed atomically or not at all. */
async function takeFlow(env: Env, kind: string, token: unknown): Promise<{ userId: string | null; payload: any } | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await env.DB.prepare('UPDATE auth_flows SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id, payload')
    .bind(now(), await sha256Hex(token), kind, now())
    .first<{ user_id: string | null; payload: string }>();
  return row ? { userId: row.user_id, payload: JSON.parse(row.payload ?? 'null') } : null;
}

function logEvent(env: Env, userId: string, kind: string, discordId: string, detail: string | null, otherId: string | null = null) {
  return env.DB.prepare('INSERT INTO identity_events (user_id, kind, telegram_id, other_user_id, via, detail, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)')
    .bind(userId, kind, otherId, 'discord', JSON.stringify({ discordId, detail }), now())
    .run();
}

export type DiscordLink = { ok: true; user: UserRow; already: boolean } | { ok: false; code: 'discord_taken' | 'discord_other_linked'; message: string };

/** Attaches a verified Discord id to `target`. Strict: never moves it off another player, never replaces one. */
export async function attachDiscord(env: Env, target: UserRow, d: DiscordProfile): Promise<DiscordLink> {
  if (target.discord_id === d.id) return { ok: true, user: target, already: true };
  if (target.discord_id) {
    await logEvent(env, target.id, 'DISCORD_LINK_REFUSED', d.id, 'player already linked to a different Discord account');
    return { ok: false, code: 'discord_other_linked', message: 'This player is already linked to a different Discord account.' };
  }
  const owner = await env.DB.prepare('SELECT id, tag FROM users WHERE discord_id = ?').bind(d.id).first<{ id: string; tag: string }>();
  if (owner) {
    await logEvent(env, target.id, 'DISCORD_LINK_REFUSED', d.id, `Discord account belongs to #${owner.tag}`, owner.id);
    return { ok: false, code: 'discord_taken', message: `That Discord account already signs in as player #${owner.tag}. Nothing was changed.` };
  }
  const r = await env.DB.prepare('UPDATE users SET discord_id = ?, discord_username = ?, updated_at = ? WHERE id = ? AND discord_id IS NULL')
    .bind(d.id, d.username, now(), target.id)
    .run();
  if (!r.meta?.changes) return { ok: false, code: 'discord_other_linked', message: 'This player changed while linking. Try again.' };
  await logEvent(env, target.id, 'DISCORD_LINKED', d.id, null);
  return { ok: true, user: { ...target, discord_id: d.id, discord_username: d.username }, already: false };
}

/** Exchanges the authorization code and reads the Discord user. Throws on any failure. */
async function fetchProfile(env: Env, req: Request, code: string): Promise<DiscordProfile> {
  const base = apiBase(env);
  const tok = await fetch(`${base}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID!, client_secret: env.DISCORD_CLIENT_SECRET!, grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, req) }),
  });
  if (!tok.ok) throw new Error(`token exchange ${tok.status}`);
  const t = (await tok.json()) as { access_token?: string; token_type?: string };
  if (!t.access_token) throw new Error('no access token');
  const me = await fetch(`${base}/users/@me`, { headers: { authorization: `Bearer ${t.access_token}` } });
  // Done with the token either way: revoke it so SHYST holds no Discord access.
  const revoke = fetch(`${base}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID!, client_secret: env.DISCORD_CLIENT_SECRET!, token: t.access_token, token_type_hint: 'access_token' }),
  }).catch(() => null);
  if (!me.ok) throw new Error(`users/@me ${me.status}`);
  const u = (await me.json()) as { id?: unknown; username?: unknown; global_name?: unknown };
  await revoke;
  if (typeof u.id !== 'string' || !SNOWFLAKE.test(u.id)) throw new Error('bad discord id');
  return { id: u.id, username: typeof u.username === 'string' ? u.username.slice(0, 40) : 'discord', globalName: typeof u.global_name === 'string' ? u.global_name.slice(0, 40) : null };
}

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });

export async function discordStart(c: RouteCtx): Promise<Response> {
  if (!discordConfigured(c.env)) throw new HttpError(503, 'discord_not_configured', 'Discord sign-in isn’t set up on this server yet.');
  await rateLimit(c.env, `dstart:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req);
  const mode = body.mode === 'link' ? 'link' : 'login';
  const user = mode === 'link' ? await requireUser(c) : null;
  if (user?.discord_id) return json({ linked: true });
  const state = await putFlow(c.env, 'discord_state', user?.id ?? null, { mode, next: safeNext(body.next) }, STATE_TTL);
  const q = new URLSearchParams({ client_id: c.env.DISCORD_CLIENT_ID!, response_type: 'code', redirect_uri: redirectUri(c.env, c.req), scope: 'identify', state, prompt: 'consent' });
  return json({ url: `${authorizeUrl(c.env)}?${q}` });
}

export async function discordCallback(c: RouteCtx): Promise<Response> {
  const app = c.env.APP_URL.replace(/\/$/, '');
  const q = new URL(c.req.url).searchParams;
  const flow = await takeFlow(c.env, 'discord_state', q.get('state'));
  if (!flow) return redirect(`${app}/auth?discord=expired`);
  const back = flow.payload?.mode === 'link' ? `${app}/settings` : `${app}/auth`;
  if (q.get('error')) return redirect(`${back}?discord=${q.get('error') === 'access_denied' ? 'denied' : 'failed'}`);
  const code = q.get('code');
  if (!code || !discordConfigured(c.env)) return redirect(`${back}?discord=failed`);
  let profile: DiscordProfile;
  try {
    profile = await fetchProfile(c.env, c.req, code);
  } catch (e) {
    console.error('discord callback failed', String(e));
    return redirect(`${back}?discord=failed`);
  }

  if (flow.payload?.mode === 'link') {
    const target = flow.userId ? await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND merged_into IS NULL').bind(flow.userId).first<UserRow>() : null;
    if (!target) return redirect(`${back}?discord=failed`);
    const r = await attachDiscord(c.env, target, profile);
    return redirect(`${back}?discord=${r.ok ? 'linked' : r.code === 'discord_taken' ? 'taken' : 'other'}`);
  }

  const known = await c.env.DB.prepare('SELECT * FROM users WHERE discord_id = ? AND merged_into IS NULL').bind(profile.id).first<UserRow>();
  const next = encodeURIComponent(flow.payload?.next ?? '/');
  if (known) {
    const ticket = await putFlow(c.env, 'session_ticket', known.id, null, TICKET_TTL);
    return redirect(`${app}/auth/discord#ticket=${ticket}&next=${next}`);
  }
  const pending = await putFlow(c.env, 'discord_pending', null, profile, PENDING_TTL);
  return redirect(`${app}/auth/discord#pending=${pending}&name=${encodeURIComponent(profile.globalName ?? profile.username)}&next=${next}`);
}

export async function discordExchange(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `dx:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req);
  const flow = await takeFlow(c.env, 'session_ticket', body.ticket);
  const user = flow?.userId ? await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND merged_into IS NULL').bind(flow.userId).first<UserRow>() : null;
  if (!user) throw new HttpError(410, 'ticket_expired', 'That Discord sign-in expired. Try again.');
  const token = await createSession(c.env, user.id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user) });
}

export async function discordComplete(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `dc:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req);
  const action = body.action === 'link' ? 'link' : 'create';
  const current = action === 'link' ? await requireUser(c) : await optionalUser(c);
  const flow = await takeFlow(c.env, 'discord_pending', body.pending);
  if (!flow) throw new HttpError(410, 'pending_expired', 'That Discord sign-in expired. Start again with Continue with Discord.');
  const d = flow.payload as DiscordProfile;
  // Someone may have linked this Discord account since the callback.
  const known = await c.env.DB.prepare('SELECT * FROM users WHERE discord_id = ? AND merged_into IS NULL').bind(d.id).first<UserRow>();

  if (action === 'link') {
    const r = await attachDiscord(c.env, current!, d);
    if (!r.ok) throw new HttpError(409, r.code, r.message);
    return json({ user: publicUser(r.user), linked: true });
  }
  if (known) {
    const token = await createSession(c.env, known.id, c.req.headers.get('user-agent'));
    return json({ token, user: publicUser(known), linked: true });
  }
  const id = newId('u');
  const t = now();
  const name = (d.globalName || d.username).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24).padEnd(2, '_');
  await c.env.DB.prepare('INSERT INTO users (id, tag, handle, display_name, discord_id, discord_username, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
    .bind(id, await uniqueTag(c.env), name, d.id, d.username, t, t)
    .run();
  await logEvent(c.env, id, 'DISCORD_SIGNUP', d.id, null);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  const token = await createSession(c.env, id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user!) }, 201);
}
