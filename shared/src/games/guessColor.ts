import { applySurvival, asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';
import { COLORS, GAME_META_DATA } from './meta';

export { COLORS };
export type Color = (typeof COLORS)[number];

interface S extends BaseState {
  picks: Record<string, { color: Color; at: number }>;
}

export const guessColor: GameDefinition<S> = {
  meta: GAME_META_DATA['guess-color'],
  init(players, ctx) {
    return { ...baseInit(players, 6, ctx.rng), picks: {} };
  },
  startRound(s, t) {
    return { ...nextRound(s, t), picks: {} };
  },
  act(s, playerId, action, ctx) {
    const a = asRecord(action);
    const color = a?.color;
    if (typeof color !== 'string' || !(COLORS as readonly string[]).includes(color)) return { ok: false, error: 'invalid_color' };
    if (s.picks[playerId]) return { ok: false, error: 'already_submitted' };
    return { ok: true, state: { ...s, picks: { ...s.picks, [playerId]: { color: color as Color, at: ctx.now } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.picks[p]);
  },
  resolveRound(s, ctx) {
    const winning = COLORS[ctx.rng.int(0, COLORS.length - 1)];
    const verdicts: Record<string, { pass: boolean; reason?: string }> = {};
    const tally: Record<string, number> = Object.fromEntries(COLORS.map((c) => [c, 0]));
    for (const p of s.alive) {
      const pick = s.picks[p];
      if (pick) tally[pick.color]++;
      verdicts[p] = !pick
        ? { pass: false, reason: 'No color picked' }
        : pick.color === winning
          ? { pass: true }
          : { pass: false, reason: `Picked ${pick.color.toUpperCase()}, drew ${winning.toUpperCase()}` };
    }
    const picks = Object.fromEntries(s.alive.map((p) => [p, s.picks[p]?.color ?? null]));
    return applySurvival(s, verdicts, { winning, tally, picks });
  },
  outcome(s) {
    const winners = s.alive.slice();
    return {
      winners,
      ranking: survivalRanking(s),
      metrics: Object.fromEntries(s.players.map((p) => [p, { roundsSurvived: s.roundsSurvived[p] ?? 0 }])),
      summary: winners.length === 1 ? 'Last one standing.' : winners.length > 1 ? `${winners.length} survived every draw.` : 'Nobody survived.',
    };
  },
  publicView(s) {
    return { submitted: s.alive.filter((p) => s.picks[p]).length, colors: COLORS };
  },
  playerView(s, playerId) {
    return { pick: s.picks[playerId]?.color ?? null };
  },
};
