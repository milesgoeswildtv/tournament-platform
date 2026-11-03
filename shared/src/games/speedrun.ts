import type { Rng } from '../rng';
import { asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';
import { GAME_META_DATA } from './meta';
import { evaluateTask, generateTask, type Task } from './speedrunTasks';

/**
 * Elimination schedule: for rounds in [from, to], remove between min and max
 * players. Wrong or missing answers always go; if they don't fill the quota,
 * the slowest correct answers make up the difference. At least one player
 * always survives a round.
 */
export interface EliminationBand {
  from: number;
  to: number | null;
  min: number;
  max: number;
}

export const DEFAULT_SPEEDRUN_SCHEDULE: EliminationBand[] = [
  { from: 1, to: 5, min: 1, max: 1 },
  { from: 6, to: 10, min: 1, max: 2 },
  { from: 11, to: null, min: 1, max: 3 },
];

export function speedrunQuota(round: number, schedule: EliminationBand[], rng: Rng): number {
  const band = schedule.find((b) => round >= b.from && (b.to === null || round <= b.to));
  if (!band) return 1;
  return rng.int(band.min, band.max);
}

/** Who is cut this round. Pure so it can be tested on its own. */
export function speedrunCuts(
  alive: string[],
  correctByTime: string[],
  quota: number,
): { failed: string[]; slow: string[]; survivors: string[]; voided: boolean } {
  const failed = alive.filter((p) => !correctByTime.includes(p));
  if (correctByTime.length === 0) return { failed: [], slow: [], survivors: alive.slice(), voided: true };
  const extra = Math.min(Math.max(0, quota - failed.length), correctByTime.length - 1);
  const slow = extra > 0 ? correctByTime.slice(correctByTime.length - extra) : [];
  const survivors = correctByTime.slice(0, correctByTime.length - extra);
  return { failed, slow, survivors, voided: false };
}

interface S extends BaseState {
  task: Task | null;
  answers: Record<string, { text: string; at: number; correct: boolean }>;
  totalMs: Record<string, number>;
  fastestMs: Record<string, number>;
  schedule: EliminationBand[];
  lastQuota: number;
}

const MAX_ROUNDS = 12;

export const speedrun: GameDefinition<S> = {
  meta: GAME_META_DATA['speedrun'],
  init(players, ctx) {
    const zero = Object.fromEntries(players.map((p) => [p, 0]));
    return {
      ...baseInit(players, MAX_ROUNDS, ctx.rng),
      task: null,
      answers: {},
      totalMs: { ...zero },
      fastestMs: {},
      schedule: DEFAULT_SPEEDRUN_SCHEDULE,
      lastQuota: 0,
    };
  },
  startRound(s, t, ctx) {
    return { ...nextRound(s, t), task: generateTask(ctx.rng, s.task?.kind), answers: {} };
  },
  act(s, playerId, action, ctx) {
    const raw = asRecord(action)?.answer;
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 80) return { ok: false, error: 'invalid_answer' };
    if (!s.task) return { ok: false, error: 'no_task' };
    if (s.answers[playerId]) return { ok: false, error: 'already_submitted' };
    const correct = evaluateTask(s.task, raw);
    return { ok: true, state: { ...s, answers: { ...s.answers, [playerId]: { text: raw.trim(), at: ctx.now, correct } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.answers[p]);
  },
  resolveRound(s, ctx) {
    const correctByTime = s.alive
      .filter((p) => s.answers[p]?.correct)
      .sort((a, b) => s.answers[a].at - s.answers[b].at || s.tiebreak[a] - s.tiebreak[b]);
    const quota = speedrunQuota(s.round, s.schedule, ctx.rng);
    const cut = speedrunCuts(s.alive, correctByTime, quota);
    const totalMs = { ...s.totalMs };
    const fastestMs = { ...s.fastestMs };
    for (const p of correctByTime) {
      const ms = s.answers[p].at - s.startedAt;
      totalMs[p] = (totalMs[p] ?? 0) + ms;
      fastestMs[p] = Math.min(fastestMs[p] ?? Infinity, ms);
    }
    const eliminated = cut.voided
      ? []
      : [
          ...cut.failed.map((p) => ({ playerId: p, reason: s.answers[p] ? `Wrong answer (“${s.answers[p].text}”)` : 'No answer' })),
          ...cut.slow.map((p) => ({ playerId: p, reason: 'Correct, but among the slowest this round' })),
        ];
    const out = { ...s.out };
    for (const e of eliminated) out[e.playerId] = { round: s.round, reason: e.reason };
    const roundsSurvived = { ...s.roundsSurvived };
    if (!cut.voided) for (const p of cut.survivors) roundsSurvived[p] = (roundsSurvived[p] ?? 0) + 1;
    const alive = cut.survivors;
    const done = alive.length <= 1 || s.round >= s.maxRounds;
    const reveal = {
      answer: s.task?.answer ?? null,
      quota,
      voided: cut.voided,
      answers: Object.fromEntries(
        s.alive.map((p) => [p, s.answers[p] ? { text: s.answers[p].text, correct: s.answers[p].correct, ms: s.answers[p].at - s.startedAt } : null]),
      ),
    };
    return {
      state: { ...s, alive, out, roundsSurvived, totalMs, fastestMs, done, lastQuota: quota, lastReveal: reveal },
      result: { eliminated, survivors: alive, voided: cut.voided, reveal },
    };
  },
  outcome(s) {
    const byTime = s.alive.slice().sort((a, b) => (s.totalMs[a] ?? 0) - (s.totalMs[b] ?? 0) || s.tiebreak[a] - s.tiebreak[b]);
    const winners = byTime.slice(0, 1);
    const metrics: Record<string, Record<string, number>> = {};
    for (const p of s.players) {
      metrics[p] = { roundsSurvived: s.roundsSurvived[p] ?? 0 };
      if (Number.isFinite(s.fastestMs[p])) metrics[p].fastestCorrectMs = s.fastestMs[p];
    }
    const rank = survivalRanking(s, (p) => -(s.totalMs[p] ?? 0));
    return {
      winners,
      ranking: [...byTime, ...rank.filter((p) => !byTime.includes(p))],
      metrics,
      summary: winners.length ? (s.alive.length > 1 ? 'Fastest total time after 12 tasks.' : 'Last runner standing.') : 'Nobody finished.',
    };
  },
  publicView(s) {
    if (!s.task) return null;
    const { answer: _a, accept: _b, evaluation, ...visible } = s.task;
    return { task: { ...visible, evaluation }, submitted: s.alive.filter((p) => s.answers[p]).length };
  },
  playerView(s, playerId) {
    return { answer: s.answers[playerId]?.text ?? null };
  },
};
