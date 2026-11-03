import { GAME_META } from '../../shared/src/index';
import { login, logout, register, telegramAuth, updateMe } from './auth';
import { telegramWebhook } from './bot';
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
  .get('/api/me', me)
  .patch('/api/me', updateMe)
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
