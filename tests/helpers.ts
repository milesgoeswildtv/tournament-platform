import {
  RoomCore,
  createRoomState,
  defaultConfig,
  normalizeConfig,
  buildSequence,
  seededRng,
  type GameId,
  type Rng,
  type TournamentConfig,
  type RoomTiming,
} from '../shared/src/index';
import { DECODE_PUZZLES } from '../shared/src/games/decodeLibrary';

export const T0 = 1_700_000_000_000;

export const FAST: RoomTiming = {
  countdownMs: 60_000,
  introMs: 6000,
  revealMs: 5000,
  resultMs: 6000,
  lobbyLifetimeMs: 72 * 3600_000,
  scale: 1,
};

export function config(over: Partial<TournamentConfig> & { manual?: GameId[] } = {}): TournamentConfig {
  const c = defaultConfig();
  c.title = 'Test Night';
  if (over.manual) {
    c.games = { selection: 'MANUAL', manual: over.manual, pool: [] };
    c.stages = over.manual.length;
  }
  const { manual: _m, ...rest } = over;
  return normalizeConfig({ ...c, ...rest });
}

export function makeRoom(cfg: TournamentConfig, rng: Rng = seededRng(7), now = T0) {
  const state = createRoomState({
    id: 't_test',
    sponsor: { id: 'host', name: 'Host', tag: 'HOST01' },
    config: cfg,
    configHash: 'hash',
    sequence: buildSequence(cfg, rng),
    now,
    timing: FAST,
  });
  return new RoomCore(state, rng);
}

/** A bot's move for whatever game is live, peeking at state only to vary correctness. */
export function botAction(room: RoomCore, playerId: string, rng: Rng, skill = 0.6): unknown | null {
  const st = room.s.stage!;
  const g = st.game as any;
  switch (st.gameId) {
    case 'guess-color':
      return { color: ['red', 'yellow', 'green', 'blue', 'white'][rng.int(0, 4)] };
    case 'zero-hour':
      return { value: rng.int(0, 100) };
    case 'high-low': {
      const n = g.hands[playerId]?.final ?? 50;
      return { type: 'call', side: n >= 50 ? 'high' : 'low' };
    }
    case 'decode':
      return { guess: rng.float() < skill * 0.5 ? DECODE_PUZZLES[g.puzzleIndex].answer : 'wrong guess' };
    case 'suited-up':
      return { suit: ['spade', 'diamond', 'club', 'heart'][rng.int(0, 3)] };
    case 'pressure-cooker':
      return { type: 'cashout' };
    case 'speedrun':
      return { answer: rng.float() < skill ? g.task.answer : 'nope' };
    case 'flood':
      return { platform: rng.int(0, g.platforms - 1) };
  }
  return null;
}

/**
 * Plays a whole tournament with bots. Each round every alive player acts at a
 * random moment (some skip), then time jumps to the next server deadline.
 */
export function playOut(room: RoomCore, rng: Rng, opts: { skipRate?: number; maxSteps?: number } = {}) {
  let now = room.s.phaseStartedAt;
  const skipRate = opts.skipRate ?? 0.1;
  for (let step = 0; step < (opts.maxSteps ?? 20_000); step++) {
    const s = room.s;
    if (s.phase === 'FINISHED' || s.phase === 'CANCELED' || s.phase === 'ABANDONED') return now;
    if (s.phase === 'ROUND' && s.stage) {
      const st = s.stage;
      const round = st.game.round;
      const roundEnd = s.phaseEndsAt!;
      const order = st.game.alive.slice();
      for (const p of order) {
        if (room.s.phase !== 'ROUND' || room.s.stage?.game.round !== round) break;
        if (rng.float() < skipRate) continue;
        const t = Math.min(roundEnd - 1, now + rng.int(100, Math.max(200, Math.floor((roundEnd - now) * 0.5))));
        if (st.gameId === 'pressure-cooker') {
          // Advance to the cash-out moment first so the break may happen.
          room.advance(t);
          if (room.s.phase !== 'ROUND') break;
        }
        const a = botAction(room, p, rng);
        room.act(p, { stage: st.index, round, action: a }, t);
      }
    }
    const d = room.nextDeadline();
    if (d === null) return now;
    now = Math.max(now, d);
    room.advance(now);
  }
  throw new Error('tournament did not finish');
}
