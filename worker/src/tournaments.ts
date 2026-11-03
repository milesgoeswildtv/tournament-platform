import {
  buildSequence,
  canonicalJson,
  createRoomState,
  normalizeConfig,
  secureRng,
  totalCommitmentCents,
  validateConfig,
  DEFAULT_TIMING,
  type TournamentConfig,
} from '../../shared/src/index';
import { ERROR_TEXT } from '../../shared/src/protocol';
import { requireUser, optionalUser, userFromToken, type UserRow } from './auth';
import { timeScale, type Env } from './env';
import { HttpError, json, readJson, type RouteCtx } from './http';
import { newId, newInviteCode, now, rateLimit, sha256Hex } from './security';
import { miniAppLink } from './telegram';

interface TournamentRow {
  id: string;
  sponsor_id: string;
  title: string;
  status: string;
  visibility: string;
  config_json: string;
  config_hash: string;
  sequence_json: string;
  stage_count: number;
  current_stage: number;
  player_count: number;
  commitment_cents: number;
  currency: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

const CLOSED = ['FINISHED', 'CANCELED', 'ABANDONED'];

export function room(env: Env, id: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(id));
}

async function roomCall<T>(env: Env, id: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await room(env, id).fetch(`https://room${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return { status: res.status, data: (await res.json()) as T };
}

async function getRow(env: Env, id: string): Promise<TournamentRow> {
  const t = await env.DB.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>();
  if (!t) throw new HttpError(404, 'not_found', 'Tournament not found.');
  return t;
}

async function membership(env: Env, tid: string, uid: string) {
  return env.DB.prepare('SELECT role, competes, eligible_from, left_at FROM participants WHERE tournament_id = ? AND user_id = ?')
    .bind(tid, uid)
    .first<{ role: string; competes: number; eligible_from: number; left_at: number | null }>();
}

function summary(t: TournamentRow & { sponsor_name?: string; sponsor_tag?: string; my_role?: string | null; my_rank?: number | null; my_left?: number | null }) {
  const cfg = JSON.parse(t.config_json) as TournamentConfig;
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    visibility: t.visibility,
    stages: t.stage_count,
    currentStage: t.current_stage,
    players: t.player_count,
    maxPlayers: cfg.entry.maxPlayers,
    commitmentCents: t.commitment_cents,
    currency: t.currency,
    structure: cfg.payout.structure,
    stageAwardCents: cfg.payout.stageAwardCents,
    finalAwardCents: cfg.payout.finalAwardCents,
    lateEntry: cfg.entry.lateEntry,
    selection: cfg.games.selection,
    timer: cfg.timer,
    sponsor: { id: t.sponsor_id, name: t.sponsor_name ?? null, tag: t.sponsor_tag ?? null },
    createdAt: t.created_at,
    startedAt: t.started_at,
    finishedAt: t.finished_at,
    myRole: t.my_role ?? null,
    myRank: t.my_rank ?? null,
    left: !!t.my_left,
  };
}

function parseConfig(input: unknown): TournamentConfig {
  let cfg: TournamentConfig;
  try {
    cfg = normalizeConfig(input as TournamentConfig);
  } catch {
    throw new HttpError(400, 'invalid_config', 'Tournament settings are incomplete.');
  }
  const errors = validateConfig(cfg);
  if (errors.length) throw new HttpError(400, 'invalid_config', errors[0].message, { errors });
  return cfg;
}

async function issueInvite(env: Env, tid: string, by: string, cfg: TournamentConfig) {
  const t = now();
  for (let i = 0; i < 5; i++) {
    const code = newInviteCode();
    try {
      await env.DB.prepare('INSERT INTO invites (code, tournament_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(code, tid, by, t, t + cfg.invite.expiresInHours * 3600_000, cfg.invite.maxUses)
        .run();
      return inviteOut(env, { code, expires_at: t + cfg.invite.expiresInHours * 3600_000, max_uses: cfg.invite.maxUses, uses: 0, revoked_at: null, created_at: t });
    } catch {
      /* code collision: try another */
    }
  }
  throw new HttpError(500, 'invite_failed');
}

function inviteOut(env: Env, i: { code: string; expires_at: number; max_uses: number; uses: number; revoked_at: number | null; created_at: number }) {
  return {
    code: i.code,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    maxUses: i.max_uses,
    uses: i.uses,
    revoked: !!i.revoked_at,
    link: `${env.APP_URL}/j/${i.code}`,
    telegramLink: env.TELEGRAM_BOT_USERNAME ? miniAppLink(env, i.code) : null,
  };
}

// ------------------------------------------------------------------ handlers

export async function createTournament(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  await rateLimit(c.env, `create:${user.id}`, 12, 3600);
  const body = await readJson(c.req, 16_384);
  const cfg = parseConfig(body.config);
  const id = newId('t');
  const t = now();
  const sequence = buildSequence(cfg, secureRng);
  const hash = await sha256Hex(canonicalJson(cfg));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tournaments (id, sponsor_id, title, status, visibility, config_json, config_hash, sequence_json, stage_count, commitment_cents, currency, created_at, updated_at)
       VALUES (?, ?, ?, 'LOBBY', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, cfg.title, cfg.entry.visibility, JSON.stringify(cfg), hash, JSON.stringify(sequence), cfg.stages, totalCommitmentCents(cfg), cfg.currency, t, t),
    c.env.DB.prepare('INSERT INTO config_history (tournament_id, actor_id, config_json, config_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      user.id,
      JSON.stringify(cfg),
      hash,
      'created',
      t,
    ),
  ]);
  const invite = await issueInvite(c.env, id, user.id, cfg);
  const state = createRoomState({
    id,
    sponsor: { id: user.id, name: user.display_name, tag: user.tag },
    config: cfg,
    configHash: hash,
    sequence,
    now: t,
    timing: { ...DEFAULT_TIMING, scale: timeScale(c.env) },
  });
  const r = await roomCall(c.env, id, '/init', { state });
  if (r.status !== 200) throw new HttpError(500, 'room_init_failed');
  return json({ id, invite, configHash: hash, sequence: cfg.games.selection === 'MANUAL' ? sequence : null }, 201);
}

export async function listTournaments(c: RouteCtx): Promise<Response> {
  const scope = c.url.searchParams.get('scope') ?? 'mine';
  const base = `SELECT t.*, u.display_name AS sponsor_name, u.tag AS sponsor_tag FROM tournaments t JOIN users u ON u.id = t.sponsor_id`;
  if (scope === 'public') {
    const rows = await c.env.DB.prepare(`${base} WHERE t.visibility = 'PUBLIC' AND t.status IN ('LOBBY','COUNTDOWN','RUNNING') ORDER BY t.created_at DESC LIMIT 30`).all<TournamentRow>();
    return json({ tournaments: rows.results.map(summary) });
  }
  const user = await requireUser(c);
  if (scope === 'sponsored') {
    const rows = await c.env.DB.prepare(`${base} WHERE t.sponsor_id = ? ORDER BY t.created_at DESC LIMIT 50`).bind(user.id).all<TournamentRow>();
    return json({ tournaments: rows.results.map((r) => summary({ ...r, my_role: 'HOST' })) });
  }
  const rows = await c.env.DB.prepare(
    `SELECT t.*, u.display_name AS sponsor_name, u.tag AS sponsor_tag, p.role AS my_role, p.left_at AS my_left, s.rank AS my_rank
     FROM participants p JOIN tournaments t ON t.id = p.tournament_id JOIN users u ON u.id = t.sponsor_id
     LEFT JOIN standings s ON s.tournament_id = t.id AND s.user_id = p.user_id
     WHERE p.user_id = ? ORDER BY t.updated_at DESC LIMIT 60`,
  )
    .bind(user.id)
    .all<TournamentRow>();
  return json({ tournaments: rows.results.map(summary) });
}

export async function getTournament(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  const t = await c.env.DB.prepare(
    `SELECT t.*, u.display_name AS sponsor_name, u.tag AS sponsor_tag FROM tournaments t JOIN users u ON u.id = t.sponsor_id WHERE t.id = ?`,
  )
    .bind(c.params.id)
    .first<TournamentRow>();
  if (!t) throw new HttpError(404, 'not_found', 'Tournament not found.');
  const m = await membership(c.env, t.id, user.id);
  if (!m && t.visibility !== 'PUBLIC' && !user.is_admin) throw new HttpError(403, 'forbidden', 'This tournament is private. Use an invite link.');
  const out = summary({ ...t, my_role: m?.role ?? null, my_left: m?.left_at ?? null });
  return json({ tournament: out, config: JSON.parse(t.config_json), member: !!m && !m.left_at, isSponsor: t.sponsor_id === user.id });
}

export async function inviteInfo(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `invite-peek:${c.req.headers.get('cf-connecting-ip') ?? 'x'}`, 120, 600);
  const code = c.params.code.toUpperCase();
  const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<{ code: string; tournament_id: string; expires_at: number; max_uses: number; uses: number; revoked_at: number | null; created_at: number }>();
  if (!inv) throw new HttpError(404, 'invite_not_found', 'That invite code does not exist.');
  const t = await c.env.DB.prepare(`SELECT t.*, u.display_name AS sponsor_name, u.tag AS sponsor_tag FROM tournaments t JOIN users u ON u.id = t.sponsor_id WHERE t.id = ?`)
    .bind(inv.tournament_id)
    .first<TournamentRow>();
  const reason = inv.revoked_at ? 'invite_revoked' : inv.expires_at <= now() ? 'invite_expired' : inv.uses >= inv.max_uses ? 'invite_used_up' : t && CLOSED.includes(t.status) ? 'tournament_closed' : null;
  return json({ valid: !reason, reason, invite: { code: inv.code, expiresAt: inv.expires_at, remaining: Math.max(0, inv.max_uses - inv.uses) }, tournament: t ? summary(t) : null });
}

/**
 * Join with an invite code (or directly for public tournaments).
 * The invite use is reserved atomically in D1 first; the room then decides
 * eligibility (phase, late-entry cutoff, cap). If the room refuses, the use
 * is returned.
 */
export async function joinTournament(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  await rateLimit(c.env, `join:${user.id}`, 30, 600);
  const body = await readJson(c.req);
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  let tid = typeof body.tournamentId === 'string' ? body.tournamentId : '';
  let via: string | null = null;
  const t0 = now();

  if (code) {
    const inv = await c.env.DB.prepare('SELECT tournament_id FROM invites WHERE code = ?').bind(code).first<{ tournament_id: string }>();
    if (!inv) throw new HttpError(404, 'invite_not_found', 'That invite code does not exist.');
    tid = inv.tournament_id;
    via = code;
  }
  if (!tid) throw new HttpError(400, 'invalid_input', 'Enter an invite code.');
  const t = await getRow(c.env, tid);
  const existing = await membership(c.env, tid, user.id);
  if (existing && !existing.left_at) return json({ ok: true, tournamentId: tid, eligibleFrom: existing.eligible_from, already: true });
  if (!code && t.visibility !== 'PUBLIC') throw new HttpError(403, 'invite_required', 'This tournament needs an invite code.');

  const pre = await roomCall<{ ok: boolean; error?: string; already?: boolean }>(c.env, tid, `/can-join?userId=${encodeURIComponent(user.id)}`);
  if (!pre.data.ok) throw new HttpError(409, pre.data.error ?? 'cannot_join', ERROR_TEXT[pre.data.error ?? ''] ?? 'You cannot join this tournament.');

  if (code) {
    const res = await c.env.DB.prepare(
      'UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses',
    )
      .bind(code, t0)
      .run();
    if (res.meta.changes !== 1) {
      const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<{ revoked_at: number | null; expires_at: number }>();
      const why = inv?.revoked_at ? ['invite_revoked', 'This invite was replaced by a new one.'] : inv && inv.expires_at <= t0 ? ['invite_expired', 'This invite has expired.'] : ['invite_used_up', 'This invite has no uses left.'];
      throw new HttpError(410, why[0], why[1]);
    }
  }
  const r = await roomCall<{ ok: boolean; error?: string; eligibleFrom?: number; already?: boolean }>(c.env, tid, '/join', {
    user: { id: user.id, name: user.display_name, tag: user.tag },
    via,
  });
  if (!r.data.ok || r.data.already) {
    if (code) await c.env.DB.prepare('UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0').bind(code).run();
    if (!r.data.ok) throw new HttpError(409, r.data.error ?? 'cannot_join', ERROR_TEXT[r.data.error ?? ''] ?? 'You cannot join this tournament.');
  } else if (code) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO invite_redemptions (code, user_id, tournament_id, redeemed_at) VALUES (?, ?, ?, ?)').bind(code, user.id, tid, t0).run();
  }
  return json({ ok: true, tournamentId: tid, eligibleFrom: r.data.eligibleFrom ?? 1, already: !!r.data.already });
}

export async function leaveTournament(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  await getRow(c.env, c.params.id);
  const r = await roomCall<{ ok: boolean; error?: string }>(c.env, c.params.id, '/leave', { userId: user.id });
  if (!r.data.ok) throw new HttpError(409, r.data.error ?? 'cannot_leave', ERROR_TEXT[r.data.error ?? ''] ?? 'Cannot leave.');
  return json({ ok: true });
}

async function requireSponsor(c: RouteCtx): Promise<{ user: UserRow; t: TournamentRow }> {
  const user = await requireUser(c);
  const t = await getRow(c.env, c.params.id);
  if (t.sponsor_id !== user.id) throw new HttpError(403, 'not_sponsor', 'Only the sponsor can do that.');
  return { user, t };
}

export async function currentInvite(c: RouteCtx): Promise<Response> {
  const { t } = await requireSponsor(c);
  const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE tournament_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .bind(t.id)
    .first<{ code: string; expires_at: number; max_uses: number; uses: number; revoked_at: number | null; created_at: number }>();
  return json({ invite: inv ? inviteOut(c.env, inv) : null });
}

export async function regenerateInvite(c: RouteCtx): Promise<Response> {
  const { user, t } = await requireSponsor(c);
  await rateLimit(c.env, `invite-regen:${t.id}`, 20, 3600);
  if (CLOSED.includes(t.status)) throw new HttpError(409, 'tournament_closed', 'This tournament is over.');
  const cfg = JSON.parse(t.config_json) as TournamentConfig;
  await c.env.DB.prepare('UPDATE invites SET revoked_at = ? WHERE tournament_id = ? AND revoked_at IS NULL').bind(now(), t.id).run();
  return json({ invite: await issueInvite(c.env, t.id, user.id, cfg) });
}

export async function updateConfig(c: RouteCtx): Promise<Response> {
  const { user, t } = await requireSponsor(c);
  await rateLimit(c.env, `config:${t.id}`, 30, 3600);
  if (t.status !== 'LOBBY') throw new HttpError(409, 'locked', 'Settings and award criteria are locked once the tournament starts.');
  const body = await readJson(c.req, 16_384);
  const cfg = parseConfig(body.config);
  const hash = await sha256Hex(canonicalJson(cfg));
  const sequence = buildSequence(cfg, secureRng);
  const r = await roomCall<{ ok: boolean; error?: string }>(c.env, t.id, '/config', { userId: user.id, config: cfg, configHash: hash, sequence });
  if (!r.data.ok) {
    const msg = r.data.error === 'cap_below_players' ? 'The player cap is below the number of players already in the lobby.' : 'Settings are locked once the countdown starts.';
    throw new HttpError(409, r.data.error ?? 'locked', msg);
  }
  const ts = now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tournaments SET title = ?, visibility = ?, config_json = ?, config_hash = ?, sequence_json = ?, stage_count = ?, commitment_cents = ?, currency = ?, updated_at = ? WHERE id = ?').bind(
      cfg.title,
      cfg.entry.visibility,
      JSON.stringify(cfg),
      hash,
      JSON.stringify(sequence),
      cfg.stages,
      totalCommitmentCents(cfg),
      cfg.currency,
      ts,
      t.id,
    ),
    c.env.DB.prepare('INSERT INTO config_history (tournament_id, actor_id, config_json, config_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(t.id, user.id, JSON.stringify(cfg), hash, 'edited in lobby', ts),
  ]);
  return json({ ok: true, configHash: hash });
}

/** Live room socket. The bearer token travels as a websocket subprotocol, never in the URL. */
export async function roomSocket(c: RouteCtx): Promise<Response> {
  if (c.req.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'expected_websocket');
  const protocols = (c.req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const token = protocols[0] === 'bearer' ? protocols[1] : null;
  const user = await userFromToken(c.env, token ?? null);
  if (!user) return new Response('unauthorized', { status: 401 });
  const t = await c.env.DB.prepare('SELECT id FROM tournaments WHERE id = ?').bind(c.params.id).first();
  if (!t) return new Response('not found', { status: 404 });
  const headers = new Headers(c.req.headers);
  headers.set('x-user-id', user.id);
  headers.set('sec-websocket-protocol', 'bearer');
  return room(c.env, c.params.id).fetch(new Request('https://room/ws', { headers }));
}

export async function tournamentResults(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  const t = await getRow(c.env, c.params.id);
  const m = await membership(c.env, t.id, user.id);
  if (!m && t.visibility !== 'PUBLIC' && !user.is_admin) throw new HttpError(403, 'forbidden', 'Only participants can view these results.');
  const db = c.env.DB;
  const [standings, allocations, awards, stages, players] = await Promise.all([
    db.prepare(`SELECT s.*, u.display_name AS name, u.tag FROM standings s JOIN users u ON u.id = s.user_id WHERE s.tournament_id = ? ORDER BY s.rank, s.user_id`).bind(t.id).all(),
    db.prepare(`SELECT a.*, u.display_name AS name, u.tag FROM allocations a LEFT JOIN users u ON u.id = a.user_id WHERE a.tournament_id = ? ORDER BY a.line`).bind(t.id).all(),
    db.prepare('SELECT * FROM award_results WHERE tournament_id = ?').bind(t.id).all(),
    db.prepare('SELECT stage, game_id, duration_ms, rounds, winners_json, record_json, finished_at FROM stage_results WHERE tournament_id = ? ORDER BY stage').bind(t.id).all(),
    db.prepare('SELECT p.user_id, p.role, p.eligible_from, p.left_at, u.display_name AS name, u.tag FROM participants p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = ?').bind(t.id).all(),
  ]);
  return json({
    tournament: summary(t),
    config: JSON.parse(t.config_json),
    configHash: t.config_hash,
    standings: standings.results,
    allocations: allocations.results,
    awards: awards.results.map((a: Record<string, unknown>) => ({ ...a, criteria: JSON.parse(String(a.criteria_json)), winners: JSON.parse(String(a.winners_json)), evidence: JSON.parse(String(a.evidence_json)) })),
    stages: stages.results.map((s: Record<string, unknown>) => ({ ...JSON.parse(String(s.record_json)), finishedAt: s.finished_at })),
    players: players.results,
  });
}

export async function tournamentAudit(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  const t = await getRow(c.env, c.params.id);
  if (t.sponsor_id !== user.id && !user.is_admin) throw new HttpError(403, 'forbidden', 'Only the sponsor or an admin can view the audit log.');
  const after = Number(c.url.searchParams.get('after') ?? '0') || 0;
  const db = c.env.DB;
  const [events, submissions, eliminations, participants, configHistory] = await Promise.all([
    db.prepare('SELECT seq, type, actor_id, payload_json, created_at FROM tournament_events WHERE tournament_id = ? AND seq > ? ORDER BY seq LIMIT 1000').bind(t.id, after).all(),
    db.prepare(`SELECT s.stage, s.round, s.user_id, u.display_name AS name, s.action_json, s.accepted, s.reject_reason, s.received_at FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.tournament_id = ? ORDER BY s.id LIMIT 2000`).bind(t.id).all(),
    db.prepare(`SELECT e.stage, e.round, e.user_id, u.display_name AS name, e.reason, e.created_at FROM eliminations e JOIN users u ON u.id = e.user_id WHERE e.tournament_id = ? ORDER BY e.id`).bind(t.id).all(),
    db.prepare(`SELECT p.*, u.display_name AS name, u.tag FROM participants p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = ? ORDER BY p.join_order`).bind(t.id).all(),
    db.prepare('SELECT id, actor_id, config_hash, reason, created_at, config_json FROM config_history WHERE tournament_id = ? ORDER BY id').bind(t.id).all(),
  ]);
  return json({
    tournament: summary(t),
    sequence: JSON.parse(t.sequence_json),
    events: events.results.map((e: Record<string, unknown>) => ({ ...e, payload: JSON.parse(String(e.payload_json)), payload_json: undefined })),
    submissions: submissions.results,
    eliminations: eliminations.results,
    participants: participants.results,
    configHistory: configHistory.results,
    disconnections: events.results.filter((e: Record<string, unknown>) => e.type === 'PLAYER_DISCONNECTED' || e.type === 'PLAYER_CONNECTED').map((e: Record<string, unknown>) => ({ type: e.type, actor_id: e.actor_id, created_at: e.created_at, payload: JSON.parse(String(e.payload_json)) })),
  });
}

export { optionalUser };
