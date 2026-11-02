import { asRecord, baseInit, nextRound, type BaseState, type GameDefinition } from './common';

interface S extends BaseState {
  percent: number;
  subs: Record<string, { value: number; at: number }>;
  result: null | {
    sum: number;
    count: number;
    /** target = percent/100 * sum/count, kept as an exact fraction. */
    targetNum: number;
    targetDen: number;
    winners: string[];
    order: string[];
    distances: Record<string, number>;
  };
}

/**
 * Exact distance |value - target| scaled by 100*count so ties are compared
 * with integers, never floating point.
 */
export function zeroHourScaledDistance(value: number, sum: number, count: number, percent: number): number {
  return Math.abs(100 * count * value - percent * sum);
}

export const zeroHour: GameDefinition<S> = {
  meta: {
    id: 'zero-hour',
    name: 'Zero Hour',
    tagline: 'Out-think the room.',
    description: 'Everyone picks 0–100 in secret. The target is a set percentage of the average. Closest wins.',
    instructions: [
      'Enter a whole number from 0 to 100. It stays hidden until the round closes.',
      'The target is the configured percentage of everyone’s average.',
      'Closest to the target wins the stage. One submission, no changes.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 1,
    roundNoun: 'Call',
    winRule: 'Closest number to the target wins.',
    tieRule: 'Equal distance: the earlier submission (server time) wins; identical times fall to a server-drawn order.',
  },
  init(players, ctx) {
    return { ...baseInit(players, 1, ctx.rng), percent: ctx.settings.zeroHourPercent, subs: {}, result: null };
  },
  startRound(s, t) {
    return { ...nextRound(s, t), subs: {} };
  },
  act(s, playerId, action, ctx) {
    const v = asRecord(action)?.value;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) return { ok: false, error: 'invalid_number' };
    if (s.subs[playerId]) return { ok: false, error: 'already_submitted' };
    return { ok: true, state: { ...s, subs: { ...s.subs, [playerId]: { value: v, at: ctx.now } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.subs[p]);
  },
  resolveRound(s) {
    const subs = s.alive.filter((p) => s.subs[p]);
    const sum = subs.reduce((t, p) => t + s.subs[p].value, 0);
    const count = subs.length;
    const distances: Record<string, number> = {};
    for (const p of subs) distances[p] = zeroHourScaledDistance(s.subs[p].value, sum, count, s.percent);
    const order = subs.slice().sort(
      (a, b) => distances[a] - distances[b] || s.subs[a].at - s.subs[b].at || s.tiebreak[a] - s.tiebreak[b],
    );
    const winner = order[0];
    const eliminated = s.alive
      .filter((p) => p !== winner)
      .map((p) => ({
        playerId: p,
        reason: !s.subs[p]
          ? 'No number submitted'
          : distances[p] === distances[winner]
            ? 'Tied on distance, submitted later'
            : 'Not the closest',
      }));
    const out = { ...s.out };
    for (const e of eliminated) out[e.playerId] = { round: s.round, reason: e.reason };
    const roundsSurvived = { ...s.roundsSurvived };
    if (winner) roundsSurvived[winner] = (roundsSurvived[winner] ?? 0) + 1;
    const result = { sum, count, targetNum: s.percent * sum, targetDen: 100 * Math.max(count, 1), winners: winner ? [winner] : [], order, distances };
    const reveal = {
      values: Object.fromEntries(subs.map((p) => [p, s.subs[p].value])),
      average: count ? sum / count : null,
      target: count ? (s.percent * sum) / (100 * count) : null,
      percent: s.percent,
      winner: winner ?? null,
      voided: false,
    };
    return {
      state: { ...s, alive: winner ? [winner] : [], out, roundsSurvived, result, done: true, lastReveal: reveal },
      result: { eliminated, survivors: winner ? [winner] : [], voided: false, reveal },
    };
  },
  outcome(s) {
    const r = s.result;
    const ranked = r ? r.order : [];
    const rest = s.players.filter((p) => !ranked.includes(p)).sort((a, b) => s.tiebreak[a] - s.tiebreak[b]);
    const metrics: Record<string, Record<string, number>> = {};
    for (const p of s.players) {
      metrics[p] = { roundsSurvived: s.roundsSurvived[p] ?? 0 };
      if (r && r.distances[p] !== undefined) metrics[p].zeroHourDistance = r.distances[p] / r.targetDen;
    }
    return {
      winners: r?.winners ?? [],
      ranking: [...ranked, ...rest],
      metrics,
      summary: r?.winners.length ? 'Closest to the target.' : 'No numbers submitted.',
    };
  },
  publicView(s) {
    return { submitted: s.alive.filter((p) => s.subs[p]).length, percent: s.percent };
  },
  playerView(s, playerId) {
    return { value: s.subs[playerId]?.value ?? null };
  },
};
