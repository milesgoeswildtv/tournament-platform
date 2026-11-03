import { applySurvival, asRecord, baseInit, nextRound, survivalRanking, type BaseState, type GameDefinition } from './common';
import { GAME_META_DATA } from './meta';
import type { Rng } from '../rng';

/** Route names, in the order they appear at a junction. The fifth opens only in the endgame. */
export const ROUTES = ['left', 'up', 'right', 'down', 'through'] as const;
export type Route = (typeof ROUTES)[number];

/**
 * How many routes the junction has, and how many are safe, from the share of
 * the stage's starting field still in:
 *   above 50%  → 3 of 4 safe
 *   ≤ 50%      → 2 of 4
 *   ≤ 25%      → 1 of 4
 *   ≤ 10%      → 1 of 5
 */
export function wrongWayShape(alive: number, start: number): { routes: number; safe: number } {
  const share = start > 0 ? alive / start : 1;
  if (share <= 0.1) return { routes: 5, safe: 1 };
  if (share <= 0.25) return { routes: 4, safe: 1 };
  if (share <= 0.5) return { routes: 4, safe: 2 };
  return { routes: 4, safe: 3 };
}

function drawSafe(rng: Rng, routes: number, safe: number): Route[] {
  const idx = Array.from({ length: routes }, (_, i) => i);
  for (let i = 0; i < safe; i++) {
    const j = rng.int(i, routes - 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, safe).sort((a, b) => a - b).map((i) => ROUTES[i]);
}

interface S extends BaseState {
  start: number;
  routes: number;
  /** Fixed at the junction's opening, secret until it resolves. */
  safe: Route[];
  picks: Record<string, { route: Route; at: number }>;
}

export const wrongWay: GameDefinition<S> = {
  meta: GAME_META_DATA['wrong-way'],
  init(players, ctx) {
    return { ...baseInit(players, 12, ctx.rng), start: players.length, routes: 4, safe: [], picks: {} };
  },
  startRound(s, t, ctx) {
    const { routes, safe } = wrongWayShape(s.alive.length, s.start);
    return { ...nextRound(s, t), routes, safe: drawSafe(ctx.rng, routes, safe), picks: {} };
  },
  act(s, playerId, action, ctx) {
    const r = asRecord(action)?.route;
    const open = ROUTES.slice(0, s.routes) as readonly string[];
    if (typeof r !== 'string' || !open.includes(r)) return { ok: false, error: 'invalid_route' };
    if (s.picks[playerId]) return { ok: false, error: 'already_submitted' };
    return { ok: true, state: { ...s, picks: { ...s.picks, [playerId]: { route: r as Route, at: ctx.now } } } };
  },
  roundReady(s) {
    return s.alive.every((p) => s.picks[p]);
  },
  resolveRound(s) {
    const safe = new Set<Route>(s.safe);
    const tally: Record<string, number> = Object.fromEntries(ROUTES.slice(0, s.routes).map((r) => [r, 0]));
    const verdicts: Record<string, { pass: boolean; reason?: string }> = {};
    for (const p of s.alive) {
      const pick = s.picks[p];
      if (pick) tally[pick.route]++;
      verdicts[p] = !pick ? { pass: false, reason: 'Didn’t pick a route' } : safe.has(pick.route) ? { pass: true } : { pass: false, reason: `Dead end ${pick.route.toUpperCase()}` };
    }
    const picks = Object.fromEntries(s.alive.map((p) => [p, s.picks[p]?.route ?? null]));
    return applySurvival(s, verdicts, { routes: s.routes, safe: s.safe, tally, picks });
  },
  outcome(s) {
    const winners = s.alive.slice();
    return {
      winners,
      ranking: survivalRanking(s),
      metrics: Object.fromEntries(s.players.map((p) => [p, { roundsSurvived: s.roundsSurvived[p] ?? 0 }])),
      summary: winners.length === 1 ? 'Found the way out.' : winners.length > 1 ? `${winners.length} made it through every junction.` : 'Nobody got out.',
    };
  },
  publicView(s) {
    return { routes: s.routes, safeCount: s.safe.length, start: s.start, alive: s.alive.length, submitted: s.alive.filter((p) => s.picks[p]).length };
  },
  playerView(s, playerId) {
    return { route: s.picks[playerId]?.route ?? null };
  },
};
