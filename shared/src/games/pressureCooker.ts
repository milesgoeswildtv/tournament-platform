import { asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';
import { GAME_META_DATA } from './meta';

/** Multiplier growth per second (e^0.07t): ~2.0x at 10s, ~4.1x at 20s, ~8.2x at 30s. */
export const PRESSURE_GROWTH = 0.07;

/** Multiplier in hundredths, floored, for a given elapsed time. */
export function pressureHundredths(elapsedMs: number): number {
  return Math.floor(100 * Math.exp((PRESSURE_GROWTH * Math.max(0, elapsedMs)) / 1000));
}

interface S extends BaseState {
  breakAt: number;
  broken: boolean;
  cashouts: Record<string, { at: number; hundredths: number }>;
  winner: string | null;
}

export const pressureCooker: GameDefinition<S> = {
  meta: GAME_META_DATA['pressure-cooker'],
  init(players, ctx) {
    return { ...baseInit(players, 3, ctx.rng), breakAt: 0, broken: false, cashouts: {}, winner: null };
  },
  startRound(s, t, ctx) {
    const span = t.endsAt - t.startedAt;
    const breakAt = t.startedAt + ctx.rng.int(Math.floor(span * 0.2), Math.floor(span * 0.95));
    return { ...nextRound(s, t), breakAt, broken: false, cashouts: {} };
  },
  act(s, playerId, action, ctx) {
    if (asRecord(action)?.type !== 'cashout') return { ok: false, error: 'invalid_action' };
    if (s.cashouts[playerId]) return { ok: false, error: 'already_submitted' };
    if (s.broken || ctx.now >= s.breakAt) return { ok: false, error: 'too_late' };
    const hundredths = pressureHundredths(ctx.now - s.startedAt);
    return {
      ok: true,
      state: { ...s, cashouts: { ...s.cashouts, [playerId]: { at: ctx.now, hundredths } } },
      reply: { multiplier: hundredths / 100 },
    };
  },
  roundReady(s) {
    return s.broken || s.alive.every((p) => s.cashouts[p]);
  },
  internalDeadline(s) {
    return s.broken ? null : s.breakAt;
  },
  onInternalDeadline(s) {
    return { ...s, broken: true };
  },
  resolveRound(s) {
    const cashed = s.alive.filter((p) => s.cashouts[p]);
    const breakValue = pressureHundredths(s.breakAt - s.startedAt) / 100;
    const reveal = {
      breakAt: breakValue,
      brokeEarly: !s.alive.every((p) => s.cashouts[p]),
      cashouts: Object.fromEntries(s.alive.map((p) => [p, s.cashouts[p] ? s.cashouts[p].hundredths / 100 : null])),
      voided: false,
      winner: null as string | null,
    };
    if (cashed.length === 0 && s.round < s.maxRounds) {
      reveal.voided = true;
      return { state: { ...s, lastReveal: reveal }, result: { eliminated: [], survivors: s.alive, voided: true, reveal } };
    }
    const order = cashed.slice().sort(
      (a, b) => s.cashouts[b].hundredths - s.cashouts[a].hundredths || s.cashouts[b].at - s.cashouts[a].at || s.tiebreak[a] - s.tiebreak[b],
    );
    const winner = order[0] ?? null;
    reveal.winner = winner;
    const eliminated = s.alive
      .filter((p) => !s.cashouts[p])
      .map((p) => ({ playerId: p, reason: `Pressure broke at ${breakValue.toFixed(2)}× before you cashed out` }));
    const out = { ...s.out };
    for (const e of eliminated) out[e.playerId] = { round: s.round, reason: e.reason };
    const roundsSurvived = { ...s.roundsSurvived };
    for (const p of cashed) roundsSurvived[p] = (roundsSurvived[p] ?? 0) + 1;
    return {
      state: { ...s, alive: order, out, roundsSurvived, winner, done: true, lastReveal: reveal },
      result: { eliminated, survivors: order, voided: false, reveal },
    };
  },
  outcome(s) {
    const metrics: Record<string, Record<string, number>> = {};
    for (const p of s.players) {
      metrics[p] = { roundsSurvived: s.roundsSurvived[p] ?? 0 };
      if (s.cashouts[p] && s.alive.includes(p)) metrics[p].cashout = s.cashouts[p].hundredths / 100;
    }
    return {
      winners: s.winner ? [s.winner] : [],
      ranking: survivalRanking(s, (p) => (s.cashouts[p] ? s.cashouts[p].hundredths * 1e7 + (s.cashouts[p].at - s.startedAt) : 0)),
      metrics,
      summary: s.winner ? `Locked ${(s.cashouts[s.winner].hundredths / 100).toFixed(2)}×.` : 'Everyone got burned.',
    };
  },
  publicView(s) {
    return {
      startedAt: s.startedAt,
      growth: PRESSURE_GROWTH,
      broken: s.broken,
      breakAt: s.broken ? pressureHundredths(s.breakAt - s.startedAt) / 100 : null,
      cashouts: Object.fromEntries(Object.entries(s.cashouts).map(([p, c]) => [p, c.hundredths / 100])),
    };
  },
  playerView(s, playerId) {
    const c = s.cashouts[playerId];
    return { cashout: c ? c.hundredths / 100 : null };
  },
};
