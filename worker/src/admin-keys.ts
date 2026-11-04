import { publicUser, requireUser, type UserRow } from './auth';
import { HttpError, json, readJson, type RouteCtx } from './http';
import { hex, randomBytes, rateLimit, sha256Hex, timingSafeEqual } from './security';

const KEY_TTL = 90 * 24 * 60 * 60 * 1000;
const normalize = (v: unknown) => typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
function generateKey(): string {
  const raw = hex(randomBytes(24).buffer).toUpperCase();
  return 'SHYST-' + raw.match(/.{1,4}/g)!.join('-');
}

export async function issueAdminKey(c: RouteCtx): Promise<Response> {
  const issuer = await requireUser(c);
  await rateLimit(c.env, `shyst-key-issue:${issuer.id}`, 5, 3600);
  const body = await readJson<{ issuerSecret?: unknown }>(c.req);
  const expected = c.env.SHYST_KEY_ISSUER_SECRET ?? '';
  const supplied = typeof body.issuerSecret === 'string' ? body.issuerSecret : '';
  if (!expected || !timingSafeEqual(supplied, expected)) {
    throw new HttpError(403, 'issuer_unauthorized', 'Key creation is not authorized.');
  }
  const key = generateKey();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO admin_keys (id, key_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(`sak_${hex(randomBytes(12).buffer)}`, await sha256Hex(normalize(key)), issuer.id, now, now + KEY_TTL).run();
  return json({ ok: true, key, expiresAt: now + KEY_TTL }, 201);
}

export async function redeemAdminKey(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  await rateLimit(c.env, `shyst-key-redeem:${user.id}`, 10, 3600);
  const body = await readJson<{ key?: unknown }>(c.req);
  const key = normalize(body.key);
  if (!/^SHYST[0-9A-F]{48}$/.test(key)) {
    throw new HttpError(400, 'invalid_key', 'Enter a valid SHYST Admin Key.');
  }
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `UPDATE admin_keys SET redeemed_by = COALESCE(redeemed_by, ?), redeemed_at = COALESCE(redeemed_at, ?)
     WHERE key_hash = ? AND revoked_at IS NULL AND expires_at > ?
       AND (redeemed_at IS NULL OR redeemed_by = ?)
     RETURNING id`,
  ).bind(user.id, now, await sha256Hex(key), now, user.id).first<{ id: string }>();
  if (!row) throw new HttpError(403, 'key_unavailable', 'That SHYST Admin Key is invalid, expired, revoked, or already used.');
  await c.env.DB.prepare('UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ?').bind(now, user.id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
  if (!updated) throw new HttpError(500, 'admin_grant_failed', 'Could not reload your SHYST account.');
  return json({ ok: true, user: publicUser(updated) });
}
