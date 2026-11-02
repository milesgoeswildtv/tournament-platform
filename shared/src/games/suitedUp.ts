import { applySurvival, asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';

export const SUITS = ['spade', 'diamond', 'club', 'heart'] as const;
export type Suit = (typeof SUITS)[number];

/** Each suit beats exactly one other: Spade>Diamond>Club>Heart>Spade. */
const BEATS: Record<Suit, Suit> = { spade: 'diamond', diamond: 'club', club: 'heart', heart: 'spade' };

/** +1 if a beats b, -1 if b beats a, 0 for matching or unrelated suits. */
export function compareSuits(a: Suit, b: Suit): -1 | 0 | 1 {
  if (a === b) return 0;
  if (BEATS[a] === b) return 1;
  if (BEATS[b] === a) return -1;
  return 0;
}

export function suitedScore(player: Suit, dealer: [Suit, Suit]): number {
  return compareSuits(player, dealer[0]) + compareSuits(player, dealer[1]);
}

interface S extends BaseState {
  picks: Record<string, { suit: Suit; at: number }>;
  totals: Record<string, number>;
}

export const suitedUp: GameDefinition<S> = {
  meta: {
    id: 'suited-up',
    name: 'Suited Up',
    tagline: 'Read the dealer’s pair.',
    description: 'Pick a suit. The dealer shows two different suits. Score each matchup; stay at zero or better.',
    instructions: [
      'Spade beats Diamond. Diamond beats Club. Club beats Heart. Heart beats Spade.',
      'Any other pairing, or the same suit, is neutral.',
      'Pick one suit. The dealer then reveals two different suits.',
      'Each matchup: win +1, neutral 0, loss −1. Total 0 or better survives; −1 is out.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 5,
    roundNoun: 'Deal',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'Still tied after 5 deals: highest running score wins; equal scores share the stage.',
  },
  init(players, ctx) {
    return { ...baseInit(players, 5, ctx.rng), picks: {}, totals: Object.fromEntries(players.map((p) => [p, 0])) };
  },
  startRound(s, t) {
    return { ...nextRound(s, t), picks: {} };
  },
  act(s, playerId, action, ctx) {
    const suit = asRecord(action)?.suit;
    if (typeof suit !== 'string' || !(SUITS as readonly string[]).includes(suit)) return { ok: false, error: 'invalid_suit' };
    if (s.picks[playerId]) return { ok: false, error: 'already_submitted' };
    return { ok: true, state: { ...s, picks: { ...s.picks, [playerId]: { suit: suit as Suit, at: ctx.now } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.picks[p]);
  },
  resolveRound(s, ctx) {
    const first = SUITS[ctx.rng.int(0, 3)];
    const rest = SUITS.filter((x) => x !== first);
    const dealer: [Suit, Suit] = [first, rest[ctx.rng.int(0, 2)]];
    const totals = { ...s.totals };
    const scores: Record<string, number | null> = {};
    const verdicts: Record<string, { pass: boolean; reason?: string }> = {};
    for (const p of s.alive) {
      const pick = s.picks[p];
      if (!pick) {
        scores[p] = null;
        verdicts[p] = { pass: false, reason: 'No suit picked' };
        continue;
      }
      const sc = suitedScore(pick.suit, dealer);
      scores[p] = sc;
      totals[p] = (totals[p] ?? 0) + sc;
      verdicts[p] = sc >= 0 ? { pass: true } : { pass: false, reason: `${pick.suit.toUpperCase()} scored −1 against ${dealer[0].toUpperCase()} + ${dealer[1].toUpperCase()}` };
    }
    const picks = Object.fromEntries(s.alive.map((p) => [p, s.picks[p]?.suit ?? null]));
    const r = applySurvival({ ...s, totals }, verdicts, { dealer, picks, scores });
    return r;
  },
  outcome(s) {
    const best = Math.max(...s.alive.map((p) => s.totals[p] ?? 0));
    const winners = s.alive.length > 1 ? s.alive.filter((p) => (s.totals[p] ?? 0) === best) : s.alive.slice();
    return {
      winners,
      ranking: survivalRanking(s, (p) => s.totals[p] ?? 0),
      metrics: Object.fromEntries(s.players.map((p) => [p, { roundsSurvived: s.roundsSurvived[p] ?? 0, suitedTotal: s.totals[p] ?? 0 }])),
      summary: winners.length === 1 ? 'Outlasted the dealer.' : winners.length > 1 ? 'Shared on equal score.' : 'The dealer took everyone.',
    };
  },
  publicView(s) {
    return { submitted: s.alive.filter((p) => s.picks[p]).length, totals: s.totals };
  },
  playerView(s, playerId) {
    return { pick: s.picks[playerId]?.suit ?? null, total: s.totals[playerId] ?? 0 };
  },
};
