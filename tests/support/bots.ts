import type { RoomView } from '../../shared/src/index';
import { DECODE_PUZZLES } from '../../shared/src/games/decodeLibrary';
import type { Client } from './client';

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const COLORS = ['red', 'yellow', 'green', 'blue', 'white'];
const SUITS = ['spade', 'diamond', 'club', 'heart'];

export interface BotOptions {
  /** Server-side room state, for bots that "know" Decode/Speedrun answers. Tests only. */
  peek?: () => any;
  skill?: number;
  skipRate?: number;
}

/**
 * Plays whatever game is live, through the same websocket messages the UI
 * sends. Returns a stop function.
 */
export function autoplay(c: Client, opts: BotOptions = {}): () => void {
  const acted = new Set<string>();
  const skill = opts.skill ?? 0.5;
  const skip = opts.skipRate ?? 0;
  const act = (v: RoomView, action: unknown) => c.send({ t: 'act', stage: v.stage!.index, round: v.stage!.round, action });

  const onUpdate = () => {
    const v = c.view;
    if (!v || v.phase !== 'ROUND' || !v.stage || !v.me || v.me.status !== 'alive') return;
    const key = `${v.stage.index}:${v.stage.round}`;
    const priv = v.me.private as any;
    if (v.stage.gameId === 'high-low' && priv && !priv.call && !priv.rerolled && priv.number >= 35 && priv.number <= 65 && !acted.has(`${key}:r`)) {
      acted.add(`${key}:r`);
      act(v, { type: 'reroll' });
      return;
    }
    if (v.me.submitted || acted.has(key)) return;
    if (v.stage.gameId === 'high-low' && priv && !priv.rerolled && priv.number >= 35 && priv.number <= 65) return; // waiting on reroll
    acted.add(key);
    if (Math.random() < skip) return;
    const windowMs = Math.max(60, v.stage.roundEndsAt - v.serverNow);
    const delay = rnd(5, Math.floor(windowMs * (v.stage.gameId === 'pressure-cooker' ? 0.7 : 0.35)));
    setTimeout(() => {
      const cur = c.view;
      if (!cur || cur.phase !== 'ROUND' || cur.stage?.index !== v.stage!.index || cur.stage.round !== v.stage!.round) return;
      const smart = Math.random() < skill;
      const room = opts.peek?.();
      switch (v.stage!.gameId) {
        case 'guess-color':
          return act(v, { color: COLORS[rnd(0, 4)] });
        case 'zero-hour':
          return act(v, { value: rnd(0, 100) });
        case 'high-low': {
          const p = (cur.me?.private as any) ?? { number: 50 };
          return act(v, { type: 'call', side: p.number >= 50 ? 'high' : 'low' });
        }
        case 'decode': {
          const ans = room?.stage?.game?.puzzleIndex !== undefined ? DECODE_PUZZLES[room.stage.game.puzzleIndex].answer : null;
          return act(v, { guess: smart && ans ? ans.toLowerCase() : 'not it' });
        }
        case 'suited-up':
          return act(v, { suit: SUITS[rnd(0, 3)] });
        case 'pressure-cooker':
          return act(v, { type: 'cashout' });
        case 'speedrun': {
          const ans = room?.stage?.game?.task?.answer;
          return act(v, { answer: smart && ans ? String(ans) : 'nope' });
        }
      }
    }, delay);
  };
  return c.subscribe(onUpdate);
}
