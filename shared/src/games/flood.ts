import { applySurvival, asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';
import { GAME_META_DATA } from './meta';
import type { Rng } from '../rng';

/**
 * The Flood. Every tide the server draws which platforms flood, before any
 * pick is made, and keeps it secret until the tide closes.
 *
 *   platforms P = players in play, clamped to 4…20
 *   flooded   F = floor(players in play / 2), at least 1, at most floor(P / 2)
 *
 * With up to 20 players that floods half the platforms and on average half the
 * field; above 20 the platform count caps and F stays at half of them, so the
 * expected cut stays near half instead of sweeping almost everyone.
 */
export const FLOOD_MIN_PLATFORMS = 4;
export const FLOOD_MAX_PLATFORMS = 20;

export function floodSizes(alive: number): { platforms: number; flooded: number } {
  const platforms = Math.max(FLOOD_MIN_PLATFORMS, Math.min(FLOOD_MAX_PLATFORMS, alive));
  const flooded = Math.max(1, Math.min(Math.floor(alive / 2), Math.floor(platforms / 2)));
  return { platforms, flooded };
}

/** F distinct platforms, uniformly, via a partial Fisher–Yates shuffle on the stage's secure RNG. */
export function drawFlood(rng: Rng, platforms: number, flooded: number): number[] {
  const all = Array.from({ length: platforms }, (_, i) => i);
  for (let i = 0; i < flooded; i++) {
    const j = rng.int(i, platforms - 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, flooded).sort((a, b) => a - b);
}

interface S extends BaseState {
  platforms: number;
  /** Secret until the tide resolves. */
  flood: number[];
  lastFlood: number[];
  picks: Record<string, { platform: number; at: number }>;
}

export const flood: GameDefinition<S> = {
  meta: GAME_META_DATA.flood,
  init(players, ctx) {
    return { ...baseInit(players, 10, ctx.rng), platforms: 0, flood: [], lastFlood: [], picks: {} };
  },
  startRound(s, t, ctx) {
    const { platforms, flooded } = floodSizes(s.alive.length);
    return { ...nextRound(s, t), platforms, flood: drawFlood(ctx.rng, platforms, flooded), picks: {} };
  },
  act(s, playerId, action, ctx) {
    const p = asRecord(action)?.platform;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= s.platforms) return { ok: false, error: 'invalid_platform' };
    if (s.picks[playerId]) return { ok: false, error: 'already_submitted' };
    return { ok: true, state: { ...s, picks: { ...s.picks, [playerId]: { platform: p, at: ctx.now } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.picks[p]);
  },
  resolveRound(s) {
    const wet = new Set(s.flood);
    const occupancy = Array.from({ length: s.platforms }, () => 0);
    const verdicts: Record<string, { pass: boolean; reason?: string }> = {};
    for (const p of s.alive) {
      const pick = s.picks[p];
      if (pick) occupancy[pick.platform]++;
      verdicts[p] = !pick
        ? { pass: false, reason: 'Didn’t pick a platform' }
        : wet.has(pick.platform)
          ? { pass: false, reason: `Platform ${pick.platform + 1} flooded` }
          : { pass: true };
    }
    const picks = Object.fromEntries(s.alive.map((p) => [p, s.picks[p]?.platform ?? null]));
    const r = applySurvival(s, verdicts, { platforms: s.platforms, flooded: s.flood, occupancy, picks });
    return { state: { ...r.state, lastFlood: s.flood }, result: r.result };
  },
  outcome(s) {
    const winners = s.alive.slice();
    return {
      winners,
      ranking: survivalRanking(s),
      metrics: Object.fromEntries(s.players.map((p) => [p, { roundsSurvived: s.roundsSurvived[p] ?? 0 }])),
      summary: winners.length === 1 ? 'Last one dry.' : winners.length > 1 ? `${winners.length} stayed dry through every tide.` : 'Everyone went under.',
    };
  },
  publicView(s) {
    // The flood itself stays server-side until the tide resolves.
    return { platforms: s.platforms, floods: Math.min(s.flood.length, s.platforms), lastFlood: s.lastFlood, submitted: s.alive.filter((p) => s.picks[p]).length };
  },
  playerView(s, playerId) {
    return { platform: s.picks[playerId]?.platform ?? null };
  },
};
