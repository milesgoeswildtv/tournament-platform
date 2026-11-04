import { GAME_META } from '../../shared/src/index';
import { login, logout, register, setPasswordLogin, startTelegramLink, telegramAuth, updateMe, requireUser, publicUser, type UserRow } from './auth';
import { telegramWebhook } from './bot';
import { discordCallback, discordComplete, discordConfigured, discordExchange, discordStart } from './discord';
import type { Env } from './env';
import { HttpError, Router, corsHeaders, json } from './http';
import { leaderboard, markNotificationsRead, me, notifications, playerProfile } from './players';
import {
  createTournament,
  currentInvite,
  getTournament,
  inviteInfo,
  joinTournament,
  leaveTournament,
  listTournaments,
  regenerateInvite,
  roomSocket,
  tournamentAudit,
  tournamentResults,
  updateConfig,
  adminTournaments,
} from './tournaments';

export { TournamentRoom } from './room';

const router = new Router()
  .get('/api/health', ({ env }) => json({ ok: true, env: env.ENVIRONMENT, time: Date.now(), telegram: !!env.TELEGRAM_BOT_TOKEN }))
  .get('/api/games', () => json({ games: Object.values(GAME_META) }))
  // accounts
  .post('/api/auth/register', register)
  .post('/api/auth/login', login)
  .post('/api/auth/logout', logout)
  .post('/api/auth/telegram', telegramAuth)
  .get('/api/auth/providers', ({ env }) =>
    json({ discord: discordConfigured(env), telegram: { enabled: !!env.TELEGRAM_BOT_TOKEN, bot: env.TELEGRAM_BOT_USERNAME ?? null } }),
  )
  .post('/api/auth/discord/start', discordStart)
  .get('/api/auth/discord/callback', discordCallback)
  .post('/api/auth/discord/exchange', discordExchange)
  .post('/api/auth/discord/complete', discordComplete)
  .get('/api/me', me)
  .patch('/api/me', updateMe)
  .post('/api/me/password', setPasswordLogin)
  .post('/api/me/admin/redeem', async (c) => {
    const user = await requireUser(c);
    const body = await c.req.json().catch(() => ({})) as { key?: unknown };
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (key.length < 12 || key.length > 100) throw new HttpError(400, 'invalid_key', 'Enter a valid SHYST Admin Key.');
    if (!c.env.POKER_ACCESS_URL || !c.env.SHYST_ADMIN_BRIDGE_SECRET) throw new HttpError(503, 'admin_redemption_unavailable', 'Admin-key redemption is not configured yet.');
    const response = await fetch(new URL('/api/access/shyst-admin/redeem', c.env.POKER_ACCESS_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.env.SHYST_ADMIN_BRIDGE_SECRET}` },
      body: JSON.stringify({ key, accountId: user.id }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) throw new HttpError(response.status === 401 ? 503 : response.status, 'key_redemption_failed', result.error || 'That key could not be redeemed.');
    await c.env.DB.prepare('UPDATE users SET is_admin = 1, updated_at = ? WHERE id = ? AND merged_into IS NULL').bind(Date.now(), user.id).run();
    const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<UserRow>();
    if (!updated) throw new HttpError(500, 'admin_grant_failed', 'Could not reload your account.');
    return json({ ok: true, user: publicUser(updated) });
  })
  .post('/api/me/telegram/link', startTelegramLink)
  .get('/api/me/notifications', notifications)
  .post('/api/me/notifications/read', markNotificationsRead)
  .get('/api/players/:tag', playerProfile)
  .get('/api/leaderboard', leaderboard)
  // tournaments
  .get('/api/tournaments', listTournaments)
  .post('/api/tournaments', createTournament)
  .get('/api/tournaments/:id', getTournament)
  .patch('/api/tournaments/:id/config', updateConfig)
  .post('/api/tournaments/:id/leave', leaveTournament)
  .get('/api/tournaments/:id/invite', currentInvite)
  .post('/api/tournaments/:id/invite', regenerateInvite)
  .get('/api/tournaments/:id/ws', roomSocket)
  .get('/api/tournaments/:id/results', tournamentResults)
  .get('/api/tournaments/:id/audit', tournamentAudit)
  .get('/api/invites/:code', inviteInfo)
  .post('/api/join', joinTournament)
  .get('/api/admin/tournaments', adminTournaments)
  // telegram
  .post('/api/telegram/webhook', telegramWebhook);

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'not_found', 'Not found.');
      const res = await m.handler({ req, env, exec, params: m.params, url });
      if (res.status === 101) return res;
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: e.code, message: e.message, details: e.details }, e.status, cors);
      }
      console.error(e);
      return json({ error: 'server_error', message: 'Something went wrong.' }, 500, cors);
    }
  },
};
