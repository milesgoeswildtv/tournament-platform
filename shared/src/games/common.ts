import type { Rng } from '../rng';
import type { GameId } from '../types';

/**
 * The contract between the tournament engine and an individual game.
 *
 * Games are pure: they receive state and return new state. The engine owns
 * time, phases, eligibility, persistence and networking; a game never sees a
 * socket or a clock other than the `now` it is handed. Everything a game
 * returns from `publicView` is broadcast to all players, so secrets (the
 * winning color, the break point, other players' numbers) must only appear
 * there after the round is resolved.
 */
export interface GameCtx {
  rng: Rng;
  now: number;
  settings: { zeroHourPercent: number };
}

export interface RoundTiming {
  startedAt: number;
  endsAt: number;
}

export interface Elimination {
  playerId: string;
  reason: string;
}

export interface RoundResult {
  eliminated: Elimination[];
  survivors: string[];
  /** Everyone failed, so nobody was removed and the round is replayed. */
  voided: boolean;
  /** Public reveal shown to every player after the round closes. */
  reveal: unknown;
}

export interface StageOutcome {
  /** Empty when nobody earned the stage. More than one means a shared win. */
  winners: string[];
  /** Every stage participant, best first. */
  ranking: string[];
  /** Per-player numbers that special awards read (e.g. cashout, distance). */
  metrics: Record<string, Record<string, number>>;
  summary: string;
}

/**
 * `partial` marks an accepted action that does not finish the player's turn
 * (High/Low's reroll): it is logged, but the player still shows as undecided.
 */
export type ActResult<S> = { ok: true; state: S; reply?: unknown; partial?: boolean } | { ok: false; error: string };

export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  instructions: string[];
  minPlayers: number;
  maxPlayers: number;
  maxRounds: number;
  /** What one internal round is called in this game. */
  roundNoun: string;
  /** How the stage winner is decided, in one line. */
  winRule: string;
  /** Tie handling, stated explicitly. */
  tieRule: string;
}

export interface BaseState {
  players: string[];
  alive: string[];
  round: number;
  maxRounds: number;
  startedAt: number;
  endsAt: number;
  done: boolean;
  /** Per-stage secure random order, used only as the last tie-breaker. */
  tiebreak: Record<string, number>;
  roundsSurvived: Record<string, number>;
  out: Record<string, { round: number; reason: string }>;
  lastReveal: unknown;
}

export interface GameDefinition<S extends BaseState = BaseState> {
  meta: GameMeta;
  init(players: string[], ctx: GameCtx): S;
  startRound(s: S, timing: RoundTiming, ctx: GameCtx): S;
  act(s: S, playerId: string, action: unknown, ctx: GameCtx): ActResult<S>;
  /** All alive players have done everything they can; close early. */
  roundReady(s: S): boolean;
  /** Optional deadline inside a round (Pressure Cooker's break point). */
  internalDeadline?(s: S): number | null;
  onInternalDeadline?(s: S, ctx: GameCtx): S;
  resolveRound(s: S, ctx: GameCtx): { state: S; result: RoundResult };
  outcome(s: S): StageOutcome;
  publicView(s: S): unknown;
  playerView(s: S, playerId: string): unknown;
}

export function baseInit(players: string[], maxRounds: number, rng: Rng): BaseState {
  const tiebreak: Record<string, number> = {};
  const roundsSurvived: Record<string, number> = {};
  for (const p of players) {
    tiebreak[p] = rng.int(0, 0x7fffffff);
    roundsSurvived[p] = 0;
  }
  return {
    players: players.slice(),
    alive: players.slice(),
    round: 0,
    maxRounds,
    startedAt: 0,
    endsAt: 0,
    done: players.length === 0,
    tiebreak,
    roundsSurvived,
    out: {},
    lastReveal: null,
  };
}

export function nextRound<S extends BaseState>(s: S, t: RoundTiming): S {
  return { ...s, round: s.round + 1, startedAt: t.startedAt, endsAt: t.endsAt };
}

/**
 * Shared survival rule used by elimination games:
 * - players with a passing verdict survive, everyone else is out;
 * - if nobody passes, the round is void and all alive players stay in;
 * - the game ends when one player is left or the round cap is reached.
 */
export function applySurvival<S extends BaseState>(
  s: S,
  verdicts: Record<string, { pass: boolean; reason?: string }>,
  reveal: unknown,
): { state: S; result: RoundResult } {
  const passed = s.alive.filter((p) => verdicts[p]?.pass);
  const voided = passed.length === 0;
  const survivors = voided ? s.alive.slice() : passed;
  const eliminated: Elimination[] = voided
    ? []
    : s.alive.filter((p) => !verdicts[p]?.pass).map((p) => ({ playerId: p, reason: verdicts[p]?.reason ?? 'Failed the round' }));
  const roundsSurvived = { ...s.roundsSurvived };
  if (!voided) for (const p of survivors) roundsSurvived[p] = (roundsSurvived[p] ?? 0) + 1;
  const out = { ...s.out };
  for (const e of eliminated) out[e.playerId] = { round: s.round, reason: e.reason };
  const done = survivors.length <= 1 || s.round >= s.maxRounds;
  const fullReveal = { ...(reveal as object), voided };
  return {
    state: { ...s, alive: survivors, roundsSurvived, out, done, lastReveal: fullReveal },
    result: { eliminated, survivors, voided, reveal: fullReveal },
  };
}

/** Survivors first (by optional score), then later eliminations ahead of earlier ones. */
export function survivalRanking(s: BaseState, score?: (p: string) => number): string[] {
  const tb = (p: string) => s.tiebreak[p] ?? 0;
  const alive = s.alive.slice().sort((a, b) => (score ? score(b) - score(a) : 0) || tb(a) - tb(b));
  const gone = s.players
    .filter((p) => !s.alive.includes(p))
    .sort((a, b) => (s.out[b]?.round ?? 0) - (s.out[a]?.round ?? 0) || (s.roundsSurvived[b] ?? 0) - (s.roundsSurvived[a] ?? 0) || tb(a) - tb(b));
  return [...alive, ...gone];
}

/** Answer normalisation for text games: case, accents, punctuation, spacing. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
