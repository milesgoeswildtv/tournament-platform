import type { GameId, SpecialAward, TournamentConfig } from './types';

/** What the engine records when a stage finishes. */
export interface StageRecord {
  index: number; // 1-based
  gameId: GameId;
  durationMs: number;
  participants: string[];
  winners: string[];
  ranking: string[];
  metrics: Record<string, Record<string, number>>;
  eliminations: { playerId: string; round: number; reason: string }[];
  rounds: number;
  summary: string;
}

export interface ResultPlayer {
  id: string;
  joinOrder: number;
  eligibleFrom: number; // 1-based stage
}

export interface StandingRow {
  playerId: string;
  rank: number;
  stageWins: number;
  outrightWins: number;
  roundsSurvived: number;
  stagesPlayed: number;
  eliminations: number;
}

export type AllocationStatus = 'COMMITTED_UNPAID' | 'UNAWARDED';

export interface Allocation {
  kind: 'STAGE' | 'FINAL' | 'SPECIAL';
  ref: string;
  label: string;
  playerId: string | null;
  amountCents: number;
  status: AllocationStatus;
  note: string;
}

export interface AwardResult {
  award: SpecialAward;
  winners: string[];
  evidence: Record<string, unknown>;
}

/**
 * Final standings. Ordering, fully deterministic:
 *   1. stage wins (a shared stage win counts as a win for each sharer)
 *   2. outright (unshared) stage wins
 *   3. total game rounds survived
 * Players equal on all three share a rank and share the tournament win.
 * Display order inside a shared rank follows join order.
 */
export function computeStandings(players: ResultPlayer[], stages: StageRecord[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const p of players) {
    rows.set(p.id, { playerId: p.id, rank: 0, stageWins: 0, outrightWins: 0, roundsSurvived: 0, stagesPlayed: 0, eliminations: 0 });
  }
  for (const st of stages) {
    for (const p of st.participants) {
      const r = rows.get(p);
      if (!r) continue;
      r.stagesPlayed++;
      r.roundsSurvived += st.metrics[p]?.roundsSurvived ?? 0;
    }
    for (const w of st.winners) {
      const r = rows.get(w);
      if (!r) continue;
      r.stageWins++;
      if (st.winners.length === 1) r.outrightWins++;
    }
    for (const e of st.eliminations) {
      const r = rows.get(e.playerId);
      if (r) r.eliminations++;
    }
  }
  const order = new Map(players.map((p) => [p.id, p.joinOrder]));
  const key = (r: StandingRow) => [r.stageWins, r.outrightWins, r.roundsSurvived];
  const sorted = [...rows.values()].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return (order.get(a.playerId) ?? 0) - (order.get(b.playerId) ?? 0);
  });
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && key(prev).join() === key(r).join() ? prev.rank : i + 1;
  });
  return sorted;
}

/** Splits cents equally; leftover cents go one each to recipients in the given order. */
export function splitCents(total: number, recipients: string[]): { playerId: string; amountCents: number }[] {
  if (recipients.length === 0) return [];
  const base = Math.floor(total / recipients.length);
  const rem = total - base * recipients.length;
  return recipients.map((p, i) => ({ playerId: p, amountCents: base + (i < rem ? 1 : 0) }));
}

function minOrMaxMetric(stages: StageRecord[], metric: string, mode: 'min' | 'max') {
  let best: number | null = null;
  const holders = new Map<string, number>();
  for (const st of stages) {
    for (const [p, m] of Object.entries(st.metrics)) {
      const v = m[metric];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (best === null || (mode === 'min' ? v < best : v > best)) {
        best = v;
        holders.clear();
        holders.set(p, st.index);
      } else if (v === best && !holders.has(p)) {
        holders.set(p, st.index);
      }
    }
  }
  return { best, holders };
}

export function evaluateAwards(
  awards: SpecialAward[],
  stages: StageRecord[],
  standings: StandingRow[],
  players: ResultPlayer[],
): AwardResult[] {
  const order = new Map(players.map((p) => [p.id, p.joinOrder]));
  const byJoin = (ids: string[]) => ids.slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const stageWinners = (n: number) => stages.find((s) => s.index === n)?.winners ?? [];
  return awards.map((award) => {
    switch (award.type) {
      case 'FIRST_STAGE':
        return { award, winners: stageWinners(1), evidence: { stage: 1 } };
      case 'FINAL_STAGE': {
        const last = Math.max(0, ...stages.map((s) => s.index));
        return { award, winners: stageWinners(last), evidence: { stage: last } };
      }
      case 'STAGE_N':
        return { award, winners: stageWinners(award.stage ?? 0), evidence: { stage: award.stage } };
      case 'MOST_ROUNDS_SURVIVED': {
        const best = Math.max(0, ...standings.map((s) => s.roundsSurvived));
        const winners = best > 0 ? byJoin(standings.filter((s) => s.roundsSurvived === best).map((s) => s.playerId)) : [];
        return { award, winners, evidence: { roundsSurvived: best } };
      }
      case 'HIGHEST_CASHOUT': {
        const { best, holders } = minOrMaxMetric(stages, 'cashout', 'max');
        return { award, winners: byJoin([...holders.keys()]), evidence: { multiplier: best, stages: Object.fromEntries(holders) } };
      }
      case 'CLOSEST_ZERO_HOUR': {
        const { best, holders } = minOrMaxMetric(stages, 'zeroHourDistance', 'min');
        return { award, winners: byJoin([...holders.keys()]), evidence: { distance: best, stages: Object.fromEntries(holders) } };
      }
      case 'FASTEST_CORRECT': {
        const { best, holders } = minOrMaxMetric(stages, 'fastestCorrectMs', 'min');
        return { award, winners: byJoin([...holders.keys()]), evidence: { ms: best, stages: Object.fromEntries(holders) } };
      }
      default:
        return { award, winners: [], evidence: { error: 'unknown award type' } };
    }
  });
}

/**
 * Prize allocations. These are sponsor commitments, never payments: every
 * awarded line is COMMITTED_UNPAID until settled outside this system.
 * Late entrants are only allocated stage awards for stages they were eligible for.
 */
export function computeAllocations(
  config: TournamentConfig,
  players: ResultPlayer[],
  stages: StageRecord[],
  standings: StandingRow[],
  awards: AwardResult[],
): Allocation[] {
  const out: Allocation[] = [];
  const eligible = new Map(players.map((p) => [p.id, p.eligibleFrom]));
  const { structure, stageAwardCents, finalAwardCents } = config.payout;

  if (structure === 'PER_STAGE' || structure === 'HYBRID') {
    for (let i = 1; i <= config.stages; i++) {
      const st = stages.find((s) => s.index === i);
      const ref = `stage-${i}`;
      const label = `Stage ${i} winner`;
      const winners = (st?.winners ?? []).filter((w) => (eligible.get(w) ?? Infinity) <= i);
      if (winners.length === 0) {
        out.push({ kind: 'STAGE', ref, label, playerId: null, amountCents: stageAwardCents, status: 'UNAWARDED', note: st ? 'No stage winner' : 'Stage not played' });
        continue;
      }
      for (const s of splitCents(stageAwardCents, winners)) {
        out.push({ kind: 'STAGE', ref, label, playerId: s.playerId, amountCents: s.amountCents, status: 'COMMITTED_UNPAID', note: winners.length > 1 ? `Split ${winners.length} ways` : '' });
      }
    }
  }

  if (structure === 'MOST_WINS' || structure === 'HYBRID') {
    const top = standings.filter((r) => r.rank === 1 && r.stageWins > 0).map((r) => r.playerId);
    if (top.length === 0) {
      out.push({ kind: 'FINAL', ref: 'final', label: 'Most stage wins', playerId: null, amountCents: finalAwardCents, status: 'UNAWARDED', note: 'No stage wins recorded' });
    } else {
      for (const s of splitCents(finalAwardCents, top)) {
        out.push({ kind: 'FINAL', ref: 'final', label: 'Most stage wins', playerId: s.playerId, amountCents: s.amountCents, status: 'COMMITTED_UNPAID', note: top.length > 1 ? `Split ${top.length} ways` : '' });
      }
    }
  }

  for (const a of awards) {
    if (a.winners.length === 0) {
      out.push({ kind: 'SPECIAL', ref: a.award.id, label: a.award.label, playerId: null, amountCents: a.award.amountCents, status: 'UNAWARDED', note: 'Criteria not met' });
      continue;
    }
    for (const s of splitCents(a.award.amountCents, a.winners)) {
      out.push({ kind: 'SPECIAL', ref: a.award.id, label: a.award.label, playerId: s.playerId, amountCents: s.amountCents, status: 'COMMITTED_UNPAID', note: a.winners.length > 1 ? `Split ${a.winners.length} ways` : '' });
    }
  }
  return out;
}
