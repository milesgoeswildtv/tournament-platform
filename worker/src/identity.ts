/**
 * Player identity. A person has ONE canonical SHYST player (`users` row).
 * Telegram is a sign-in method attached to that player (`users.telegram_id`),
 * never a second player.
 *
 * Linking needs proof of both sides:
 *   - the SHYST side: a single-use link token issued to the signed-in player
 *     (POST /api/me/telegram/link), or a live session inside the Mini App;
 *   - the Telegram side: the bot webhook's verified sender, or the Mini App's
 *     HMAC-signed initData.
 *
 * If the Telegram account is already attached to another row, it is moved
 * only when that row is an empty Telegram-only duplicate (no login, no
 * tournaments, no prizes). The duplicate is kept and marked merged_into; its
 * sessions are revoked. A duplicate with history is never merged automatically.
 */
import type { Env } from './env';
import type { UserRow } from './auth';
import { b64url, now, randomBytes, sha256Hex } from './security';

export const LINK_TOKEN_TTL_MS = 15 * 60_000;
export const LINK_PREFIX = 'link_';

export type LinkVia = 'bot' | 'miniapp' | 'miniapp-session';
export type LinkOutcome =
  | { ok: true; user: UserRow; already: boolean; reconciled: { id: string; tag: string } | null }
  | { ok: false; status: number; code: string; message: string };

export async function issueLinkToken(env: Env, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = b64url(randomBytes(18)); // 24 chars of [A-Za-z0-9_-]: fits Telegram's 64-char start parameter
  const t = now();
  const expiresAt = t + LINK_TOKEN_TTL_MS;
  await env.DB.prepare('INSERT INTO telegram_link_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, t, expiresAt)
    .run();
  return { token, expiresAt };
}

/** Consumes a link token exactly once. Returns the player it was issued to. */
export async function consumeLinkToken(env: Env, token: string, telegramId: string): Promise<UserRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    'UPDATE telegram_link_tokens SET used_at = ?, used_by_telegram_id = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id',
  )
    .bind(now(), telegramId, await sha256Hex(token), now())
    .first<{ user_id: string }>();
  if (!row) return null;
  return env.DB.prepare('SELECT * FROM users WHERE id = ? AND merged_into IS NULL').bind(row.user_id).first<UserRow>();
}

/** True when a row holds nothing a person could lose: no login, no tournaments, no prizes. */
async function isEmptyTelegramOnly(env: Env, u: UserRow): Promise<boolean> {
  if (u.handle || u.password_hash) return false;
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM participants WHERE user_id = ?1)
          + (SELECT COUNT(*) FROM tournaments WHERE sponsor_id = ?1)
          + (SELECT COUNT(*) FROM standings WHERE user_id = ?1)
          + (SELECT COUNT(*) FROM allocations WHERE user_id = ?1) AS n`,
  )
    .bind(u.id)
    .first<{ n: number }>();
  return (r?.n ?? 0) === 0;
}

function event(env: Env, userId: string, kind: string, tgId: string, via: LinkVia, otherId: string | null, detail: string | null) {
  return env.DB.prepare('INSERT INTO identity_events (user_id, kind, telegram_id, other_user_id, via, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
    userId,
    kind,
    tgId,
    otherId,
    via,
    detail,
    now(),
  );
}

/** Attaches a verified Telegram account to `target`, the canonical player. */
export async function attachTelegram(env: Env, target: UserRow, tg: { id: string; username: string | null }, via: LinkVia): Promise<LinkOutcome> {
  if (target.telegram_id === tg.id) return { ok: true, user: target, already: true, reconciled: null };
  if (target.telegram_id) {
    await event(env, target.id, 'TELEGRAM_LINK_REFUSED', tg.id, via, null, 'player already linked to a different Telegram account').run();
    return { ok: false, status: 409, code: 'telegram_other_linked', message: 'This player is already linked to a different Telegram account.' };
  }
  const t = now();
  const owner = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?').bind(tg.id).first<UserRow>();
  if (!owner) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, updated_at = ? WHERE id = ? AND telegram_id IS NULL').bind(tg.id, tg.username, t, target.id),
      event(env, target.id, 'TELEGRAM_LINKED', tg.id, via, null, null),
    ]);
    return { ok: true, user: { ...target, telegram_id: tg.id, telegram_username: tg.username }, already: false, reconciled: null };
  }
  if (!(await isEmptyTelegramOnly(env, owner))) {
    await event(env, target.id, 'TELEGRAM_LINK_REFUSED', tg.id, via, owner.id, 'Telegram account belongs to a player with history').run();
    return {
      ok: false,
      status: 409,
      code: 'telegram_has_history',
      message: `This Telegram account already belongs to player #${owner.tag}, which has its own tournament history. Nothing was merged; contact the operator to reconcile the two.`,
    };
  }
  // Reconcile: move Telegram off the empty duplicate onto the canonical player, in one transaction.
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET telegram_id = NULL, merged_into = ?, merged_at = ?, updated_at = ? WHERE id = ?').bind(target.id, t, t, owner.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(owner.id),
    env.DB.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, updated_at = ? WHERE id = ? AND telegram_id IS NULL').bind(tg.id, tg.username ?? owner.telegram_username, t, target.id),
    event(env, target.id, 'TELEGRAM_RECONCILED', tg.id, via, owner.id, `empty Telegram-only duplicate #${owner.tag} folded into #${target.tag}`),
  ]);
  return { ok: true, user: { ...target, telegram_id: tg.id, telegram_username: tg.username ?? owner.telegram_username }, already: false, reconciled: { id: owner.id, tag: owner.tag } };
}
