import { discordConfigured } from './discord';
import { publicUser, requireUser, type UserRow } from './auth';
import { HttpError, json, type RouteCtx } from './http';

const STATS_SQL = `
  SELECT
    COUNT(DISTINCT p.tournament_id) AS joined,
    COUNT(DISTINCT CASE WHEN t.status = 'FINISHED' AND p.competes = 1 THEN p.tournament_id END) AS played,
    COALESCE(SUM(s.stage_wins), 0) AS stage_wins,
    COALESCE(SUM(s.rounds_survived), 0) AS rounds_survived,
    COALESCE(SUM(s.stages_played), 0) AS stages_played,
    COUNT(CASE WHEN s.rank = 1 AND s.stage_wins > 0 THEN 1 END) AS titles,
    MIN(s.rank) AS best_rank
  FROM participants p
  JOIN tournaments t ON t.id = p.tournament_id
  LEFT JOIN standings s ON s.tournament_id = p.tournament_id AND s.user_id = p.user_id
  WHERE p.user_id = ?`;

async function stats(c: RouteCtx, userId: string) {
  const [row, sponsored, prizes] = await Promise.all([
    c.env.DB.prepare(STATS_SQL).bind(userId).first<Record<string, number>>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(commitment_cents),0) AS committed FROM tournaments WHERE sponsor_id = ? AND status NOT IN ('CANCELED','ABANDONED')`).bind(userId).first<{ n: number; committed: number }>(),
    c.env.DB.prepare(`SELECT currency, SUM(amount_cents) AS cents FROM allocations WHERE user_id = ? AND status = 'COMMITTED_UNPAID' GROUP BY currency`).bind(userId).all<{ currency: string; cents: number }>(),
  ]);
  const played = row?.played ?? 0;
  return {
    tournamentsJoined: row?.joined ?? 0,
    tournamentsPlayed: played,
    titles: row?.titles ?? 0,
    stageWins: row?.stage_wins ?? 0,
    stagesPlayed: row?.stages_played ?? 0,
    roundsSurvived: row?.rounds_survived ?? 0,
    bestFinish: row?.best_rank ?? null,
    stageWinRate: row?.stages_played ? (row.stage_wins ?? 0) / row.stages_played : 0,
    sponsored: sponsored?.n ?? 0,
    sponsoredCommitmentCents: sponsored?.committed ?? 0,
    prizeAllocations: prizes.results,
  };
}

export async function me(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  const unread = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(u.id).first<{ n: number }>();
  return json({
    user: publicUser(u),
    stats: await stats(c, u.id),
    unread: unread?.n ?? 0,
    telegram: { configured: !!c.env.TELEGRAM_BOT_TOKEN, bot: c.env.TELEGRAM_BOT_USERNAME ?? null, linked: !!u.telegram_id, username: u.telegram_username ?? null },
    discord: { configured: discordConfigured(c.env), linked: !!u.discord_id, username: u.discord_username ?? null },
    password: { configured: !!u.password_hash, handle: u.handle },
  });
}

export async function playerProfile(c: RouteCtx): Promise<Response> {
  await requireUser(c);
  const tag = c.params.tag.toUpperCase();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE tag = ?').bind(tag).first<UserRow>();
  if (!u) throw new HttpError(404, 'not_found', 'Player not found.');
  const history = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.stage_count, t.finished_at, s.rank, s.stage_wins
     FROM participants p JOIN tournaments t ON t.id = p.tournament_id
     LEFT JOIN standings s ON s.tournament_id = t.id AND s.user_id = p.user_id
     WHERE p.user_id = ? AND t.status = 'FINISHED' ORDER BY t.finished_at DESC LIMIT 20`,
  )
    .bind(u.id)
    .all();
  const { id: _id, handle: _h, isAdmin: _a, telegram: _t, discord: _d, ...pub } = publicUser(u);
  return json({ player: pub, stats: await stats(c, u.id), history: history.results });
}

export async function leaderboard(c: RouteCtx): Promise<Response> {
  await requireUser(c);
  const metric = c.url.searchParams.get('metric') ?? 'stage_wins';
  const period = c.url.searchParams.get('period') ?? 'all';
  const since = period === '30d' ? Date.now() - 30 * 86_400_000 : period === '7d' ? Date.now() - 7 * 86_400_000 : 0;
  const order: Record<string, string> = {
    stage_wins: 'stage_wins DESC, titles DESC, rounds_survived DESC',
    titles: 'titles DESC, stage_wins DESC, rounds_survived DESC',
    survival: 'rounds_survived DESC, stage_wins DESC',
    played: 'played DESC, stage_wins DESC',
  };
  if (!order[metric]) throw new HttpError(400, 'invalid_input', 'Unknown leaderboard.');
  const rows = await c.env.DB.prepare(
    `SELECT u.tag, u.display_name AS name,
       SUM(s.stage_wins) AS stage_wins,
       SUM(CASE WHEN s.rank = 1 AND s.stage_wins > 0 THEN 1 ELSE 0 END) AS titles,
       SUM(s.rounds_survived) AS rounds_survived,
       COUNT(*) AS played,
       MIN(s.rank) AS best
     FROM standings s JOIN tournaments t ON t.id = s.tournament_id JOIN users u ON u.id = s.user_id
     WHERE t.status = 'FINISHED' AND COALESCE(t.finished_at, 0) >= ?
     GROUP BY s.user_id ORDER BY ${order[metric]}, u.tag LIMIT 100`,
  )
    .bind(since)
    .all();
  return json({ metric, period, rows: rows.results });
}

export async function notifications(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  const rows = await c.env.DB.prepare('SELECT id, kind, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40').bind(u.id).all();
  return json({ notifications: rows.results });
}

export async function markNotificationsRead(c: RouteCtx): Promise<Response> {
  const u = await requireUser(c);
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(Date.now(), u.id).run();
  return json({ ok: true });
}
