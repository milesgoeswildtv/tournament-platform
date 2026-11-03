import { applySurvival, asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';

interface Hand {
  first: number;
  final: number;
  rerolled: boolean;
  call: 'high' | 'low' | null;
  at: number;
}

interface S extends BaseState {
  hands: Record<string, Hand>;
}

export function highLowVerdict(final: number, call: 'high' | 'low' | null, comparison: number): { pass: boolean; reason?: string } {
  if (!call) return { pass: false, reason: 'No call made' };
  if (final === comparison) return { pass: false, reason: `Tied the house at ${comparison}` };
  if (call === 'high') return final > comparison ? { pass: true } : { pass: false, reason: `Called HIGH on ${final}, house drew ${comparison}` };
  return final < comparison ? { pass: true } : { pass: false, reason: `Called LOW on ${final}, house drew ${comparison}` };
}

export const highLow: GameDefinition<S> = {
  meta: {
    id: 'high-low',
    name: 'Trust Yourself',
    tagline: 'Keep it or burn it. Then call it.',
    description: 'You get a secret number from 1–100. Keep it or reroll once, then call HIGH or LOW against the house number.',
    instructions: [
      'You are dealt a private number from 1 to 100.',
      'Keep it, or reroll once. A reroll is final — you play the new number.',
      'Call HIGH if you think yours beats the house number, LOW if it falls under.',
      'Ties with the house are eliminated. No call before time is up means you are out.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 5,
    roundNoun: 'Hand',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'If more than one player survives 5 hands, they share the stage win.',
  },
  init(players, ctx) {
    return { ...baseInit(players, 5, ctx.rng), hands: {} };
  },
  startRound(s, t, ctx) {
    const hands: Record<string, Hand> = {};
    for (const p of s.alive) {
      const n = ctx.rng.int(1, 100);
      hands[p] = { first: n, final: n, rerolled: false, call: null, at: 0 };
    }
    return { ...nextRound(s, t), hands };
  },
  act(s, playerId, action, ctx) {
    const a = asRecord(action);
    const hand = s.hands[playerId];
    if (!hand) return { ok: false, error: 'no_hand' };
    if (hand.call) return { ok: false, error: 'already_submitted' };
    if (a?.type === 'reroll') {
      if (hand.rerolled) return { ok: false, error: 'already_rerolled' };
      const n = ctx.rng.int(1, 100);
      return { ok: true, state: { ...s, hands: { ...s.hands, [playerId]: { ...hand, final: n, rerolled: true } } }, reply: { number: n }, partial: true };
    }
    if (a?.type === 'call' && (a.side === 'high' || a.side === 'low')) {
      return { ok: true, state: { ...s, hands: { ...s.hands, [playerId]: { ...hand, call: a.side, at: ctx.now } } } };
    }
    return { ok: false, error: 'invalid_action' };
  },
  roundReady(s) {
    return s.alive.every((p) => s.hands[p]?.call);
  },
  resolveRound(s, ctx) {
    const comparison = ctx.rng.int(1, 100);
    const verdicts: Record<string, { pass: boolean; reason?: string }> = {};
    for (const p of s.alive) {
      const h = s.hands[p];
      verdicts[p] = h ? highLowVerdict(h.final, h.call, comparison) : { pass: false, reason: 'No hand' };
    }
    const hands = Object.fromEntries(
      s.alive.map((p) => [p, { number: s.hands[p]?.final ?? null, call: s.hands[p]?.call ?? null, rerolled: s.hands[p]?.rerolled ?? false }]),
    );
    return applySurvival(s, verdicts, { comparison, hands });
  },
  outcome(s) {
    return {
      winners: s.alive.slice(),
      ranking: survivalRanking(s),
      metrics: Object.fromEntries(s.players.map((p) => [p, { roundsSurvived: s.roundsSurvived[p] ?? 0 }])),
      summary: s.alive.length === 1 ? 'Read the house better than anyone.' : s.alive.length > 1 ? 'Shared the stage after 5 hands.' : 'Nobody survived.',
    };
  },
  publicView(s) {
    return { submitted: s.alive.filter((p) => s.hands[p]?.call).length };
  },
  playerView(s, playerId) {
    const h = s.hands[playerId];
    return h ? { number: h.final, first: h.first, rerolled: h.rerolled, call: h.call } : null;
  },
};
