import { asRecord, baseInit, nextRound, normalizeAnswer, type BaseState, type GameDefinition } from './common';
import { DECODE_PUZZLES, type DecodePuzzle } from './decodeLibrary';

interface Guess {
  text: string;
  at: number;
  correct: boolean;
}

interface S extends BaseState {
  puzzleIndex: number;
  guesses: Record<string, Guess>; // current round
  history: Record<string, Guess[]>;
  solvers: { playerId: string; round: number; ms: number; at: number }[];
  winner: string | null;
}

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/** Masked board for a round: round 1 shows first letters, round 3 adds vowels. */
export function decodeBoard(answer: string, round: number): string {
  return answer
    .split(' ')
    .map((word) =>
      word
        .split('')
        .map((ch, i) => {
          if (!/[A-Z]/.test(ch)) return ch;
          if (i === 0) return ch;
          if (round >= 3 && VOWELS.has(ch)) return ch;
          return '_';
        })
        .join(''),
    )
    .join(' ');
}

export function decodeMatches(p: DecodePuzzle, guess: string): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  return [p.answer, ...(p.accept ?? [])].some((a) => normalizeAnswer(a) === g);
}

const puzzleOf = (s: S) => DECODE_PUZZLES[s.puzzleIndex];

export const decode: GameDefinition<S> = {
  meta: {
    id: 'decode',
    name: 'Decode',
    tagline: 'Same board. Who cracks it first?',
    description: 'Everyone gets the same hidden phrase. One guess per round; each round reveals more.',
    instructions: [
      'Everyone sees the same masked phrase and its category.',
      'You get one private guess per round. Spelling and spacing are forgiven; letters are not.',
      'Round 2 adds a clue. Round 3 adds a second clue and reveals the vowels.',
      'The first correct guess (by server time) wins the stage. Unsolved after 3 rounds: no winner.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 3,
    roundNoun: 'Round',
    winRule: 'Earliest correct guess wins.',
    tieRule: 'Guesses are ordered by server receive time; identical times fall to a server-drawn order.',
  },
  init(players, ctx) {
    return {
      ...baseInit(players, 3, ctx.rng),
      puzzleIndex: ctx.rng.int(0, DECODE_PUZZLES.length - 1),
      guesses: {},
      history: {},
      solvers: [],
      winner: null,
    };
  },
  startRound(s, t) {
    return { ...nextRound(s, t), guesses: {} };
  },
  act(s, playerId, action, ctx) {
    const raw = asRecord(action)?.guess;
    if (typeof raw !== 'string') return { ok: false, error: 'invalid_guess' };
    const text = raw.trim().slice(0, 80);
    if (!text) return { ok: false, error: 'invalid_guess' };
    if (s.guesses[playerId]) return { ok: false, error: 'already_submitted' };
    const g: Guess = { text, at: ctx.now, correct: decodeMatches(puzzleOf(s), text) };
    return {
      ok: true,
      state: {
        ...s,
        guesses: { ...s.guesses, [playerId]: g },
        history: { ...s.history, [playerId]: [...(s.history[playerId] ?? []), g] },
      },
    };
  },
  roundReady(s) {
    return s.alive.every((p) => s.guesses[p]);
  },
  resolveRound(s) {
    const correct = s.alive
      .filter((p) => s.guesses[p]?.correct)
      .sort((a, b) => s.guesses[a].at - s.guesses[b].at || s.tiebreak[a] - s.tiebreak[b]);
    const solvers = [...s.solvers, ...correct.map((p) => ({ playerId: p, round: s.round, at: s.guesses[p].at, ms: s.guesses[p].at - s.startedAt }))];
    const last = s.round >= s.maxRounds;
    const roundsSurvived = { ...s.roundsSurvived };
    const out = { ...s.out };
    let alive = s.alive;
    let eliminated: { playerId: string; reason: string }[] = [];
    let done = false;
    let winner: string | null = null;
    if (correct.length > 0) {
      done = true;
      winner = correct[0];
      eliminated = s.alive.filter((p) => !correct.includes(p)).map((p) => ({ playerId: p, reason: 'Did not decode in time' }));
      alive = correct;
    } else if (last) {
      done = true;
      eliminated = s.alive.map((p) => ({ playerId: p, reason: 'Unsolved after 3 rounds' }));
      alive = [];
    }
    for (const p of alive) roundsSurvived[p] = (roundsSurvived[p] ?? 0) + 1;
    for (const e of eliminated) out[e.playerId] = { round: s.round, reason: e.reason };
    const reveal = {
      answer: done ? puzzleOf(s).answer : null,
      solved: correct,
      winner,
      guesses: done ? Object.fromEntries(s.alive.map((p) => [p, s.guesses[p]?.text ?? null])) : null,
      wrong: s.alive.filter((p) => s.guesses[p] && !s.guesses[p].correct).length,
      voided: false,
    };
    return {
      state: { ...s, alive, out, roundsSurvived, solvers, winner, done, lastReveal: reveal },
      result: { eliminated, survivors: alive, voided: false, reveal },
    };
  },
  outcome(s) {
    const solvedOrder = s.solvers.map((x) => x.playerId);
    const rest = s.players.filter((p) => !solvedOrder.includes(p)).sort((a, b) => s.tiebreak[a] - s.tiebreak[b]);
    const metrics: Record<string, Record<string, number>> = {};
    for (const p of s.players) metrics[p] = { roundsSurvived: s.roundsSurvived[p] ?? 0 };
    for (const x of s.solvers) metrics[x.playerId].fastestCorrectMs = x.ms;
    return {
      winners: s.winner ? [s.winner] : [],
      ranking: [...solvedOrder, ...rest],
      metrics,
      summary: s.winner ? `Cracked “${puzzleOf(s).answer}”.` : `Nobody cracked “${puzzleOf(s).answer}”.`,
    };
  },
  publicView(s) {
    const p = puzzleOf(s);
    return {
      category: p.category,
      board: decodeBoard(p.answer, s.round),
      clues: p.clues.slice(0, Math.max(0, s.round - 1)),
      submitted: s.alive.filter((x) => s.guesses[x]).length,
    };
  },
  playerView(s, playerId) {
    return {
      guess: s.guesses[playerId]?.text ?? null,
      history: (s.history[playerId] ?? []).map((g) => g.text),
    };
  },
};
