import type { RoomEvent, RoomState, StageRecord, FinalResults } from '../../shared/src/index';
import type { Env } from './env';

export interface SeqEvent {
  seq: number;
  event: RoomEvent;
}

/**
 * Turns room events into D1 writes. Every insert is idempotent (keyed by the
 * event sequence number) so a retried flush never duplicates rows. Audit
 * tables are append-only; the triggers in migrations/0001 enforce it.
 */
export function statementsFor(env: Env, s: RoomState, { seq, event }: SeqEvent): D1PreparedStatement[] {
  const DB = env.DB;
  const tid = s.id;
  const { type, actorId, at, data } = event;
  const out: D1PreparedStatement[] = [
    DB.prepare('INSERT OR IGNORE INTO tournament_events (tournament_id, seq, type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      tid,
      seq,
      type,
      actorId,
      JSON.stringify(data),
      at,
    ),
  ];
  const status = (st: string, extra = '') => DB.prepare(`UPDATE tournaments SET status = ?, updated_at = ?${extra} WHERE id = ?`);
  const playerCount = () =>
    DB.prepare(
      `UPDATE tournaments SET player_count = (SELECT COUNT(*) FROM participants WHERE tournament_id = ? AND left_at IS NULL AND competes = 1), updated_at = ? WHERE id = ?`,
    ).bind(tid, at, tid);

  switch (type) {
    case 'PLAYER_JOINED': {
      const pid = String(data.playerId);
      const p = s.players[pid];
      out.push(
        DB.prepare(
          `INSERT INTO participants (tournament_id, user_id, role, competes, eligible_from, join_order, via_invite, joined_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tournament_id, user_id) DO UPDATE SET left_at = NULL, eligible_from = excluded.eligible_from, joined_at = excluded.joined_at, join_order = excluded.join_order`,
        ).bind(tid, pid, p?.role ?? 'PLAYER', p?.competes ? 1 : 0, Number(data.eligibleFrom ?? 1), p?.joinOrder ?? 0, (data.via as string) ?? null, at),
        playerCount(),
      );
      break;
    }
    case 'PLAYER_LEFT':
      out.push(DB.prepare('UPDATE participants SET left_at = ? WHERE tournament_id = ? AND user_id = ?').bind(at, tid, String(data.playerId)), playerCount());
      break;
    case 'CONFIG_UPDATED':
      out.push(DB.prepare('UPDATE participants SET competes = ? WHERE tournament_id = ? AND role = ?').bind(s.config.entry.hostCompetes ? 1 : 0, tid, 'HOST'), playerCount());
      break;
    case 'COUNTDOWN_STARTED':
      out.push(status('COUNTDOWN').bind('COUNTDOWN', at, tid));
      break;
    case 'COUNTDOWN_ABORTED':
      out.push(status('LOBBY').bind('LOBBY', at, tid));
      break;
    case 'TOURNAMENT_STARTED':
      out.push(status('RUNNING', ', started_at = ?').bind('RUNNING', at, at, tid));
      break;
    case 'STAGE_STARTED':
      out.push(DB.prepare('UPDATE tournaments SET current_stage = ?, updated_at = ? WHERE id = ?').bind(Number(data.stage), at, tid));
      break;
    case 'SUBMISSION':
      out.push(
        DB.prepare(
          `INSERT OR IGNORE INTO submissions (tournament_id, stage, round, user_id, action_json, accepted, reject_reason, received_at, event_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(tid, Number(data.stage), Number(data.round), String(data.playerId), JSON.stringify(data.action ?? null).slice(0, 2000), data.accepted ? 1 : 0, (data.error as string) ?? null, at, seq),
      );
      break;
    case 'ROUND_RESOLVED':
      for (const e of (data.eliminated as { playerId: string; reason: string }[]) ?? []) {
        out.push(
          DB.prepare('INSERT OR IGNORE INTO eliminations (tournament_id, stage, round, user_id, reason, created_at, event_seq) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
            tid,
            Number(data.stage),
            Number(data.round),
            e.playerId,
            e.reason,
            at,
            seq,
          ),
        );
      }
      break;
    case 'STAGE_FINISHED': {
      const r = data as unknown as StageRecord;
      out.push(
        DB.prepare(
          'INSERT OR IGNORE INTO stage_results (tournament_id, stage, game_id, duration_ms, rounds, winners_json, record_json, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(tid, r.index, r.gameId, r.durationMs, r.rounds, JSON.stringify(r.winners), JSON.stringify(r), at),
      );
      break;
    }
    case 'TOURNAMENT_FINISHED': {
      const f = data as unknown as FinalResults;
      out.push(status('FINISHED', ', finished_at = ?').bind('FINISHED', at, at, tid));
      for (const r of f.standings) {
        out.push(
          DB.prepare(
            'INSERT OR IGNORE INTO standings (tournament_id, user_id, rank, stage_wins, outright_wins, rounds_survived, stages_played, eliminations) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).bind(tid, r.playerId, r.rank, r.stageWins, r.outrightWins, r.roundsSurvived, r.stagesPlayed, r.eliminations),
        );
      }
      f.allocations.forEach((a, i) => {
        out.push(
          DB.prepare(
            'INSERT OR IGNORE INTO allocations (tournament_id, kind, ref, label, user_id, amount_cents, currency, status, note, line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).bind(tid, a.kind, a.ref, a.label, a.playerId, a.amountCents, s.config.currency, a.status, a.note, i + 1, at),
        );
      });
      for (const a of f.awards) {
        out.push(
          DB.prepare('INSERT OR IGNORE INTO award_results (tournament_id, award_id, criteria_json, winners_json, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
            tid,
            a.award.id,
            JSON.stringify(a.award),
            JSON.stringify(a.winners),
            JSON.stringify(a.evidence),
            at,
          ),
        );
      }
      break;
    }
    case 'TOURNAMENT_CANCELED':
      out.push(status('CANCELED', ', finished_at = ?').bind('CANCELED', at, at, tid));
      break;
    case 'TOURNAMENT_ABANDONED':
      out.push(status('ABANDONED', ', finished_at = ?').bind('ABANDONED', at, at, tid));
      break;
  }
  return out;
}

export async function persistEvents(env: Env, s: RoomState, events: SeqEvent[]): Promise<void> {
  const stmts = events.flatMap((e) => statementsFor(env, s, e));
  if (stmts.length) await env.DB.batch(stmts);
}
