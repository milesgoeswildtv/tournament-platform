import type { GameId } from '../types';
import type { BaseState, GameDefinition, GameMeta } from './common';
import { guessColor } from './guessColor';
import { zeroHour } from './zeroHour';
import { highLow } from './highLow';
import { decode } from './decode';
import { suitedUp } from './suitedUp';
import { pressureCooker } from './pressureCooker';
import { speedrun } from './speedrun';
import { flood } from './flood';
import { wrongWay } from './wrongWay';

/**
 * The only place the engine learns which games exist. To add a game, implement
 * GameDefinition in its own file and register it here (see docs/ADDING_A_GAME.md).
 */
export const GAMES: Record<GameId, GameDefinition<BaseState>> = {
  'guess-color': guessColor as unknown as GameDefinition<BaseState>,
  'zero-hour': zeroHour as unknown as GameDefinition<BaseState>,
  'high-low': highLow as unknown as GameDefinition<BaseState>,
  decode: decode as unknown as GameDefinition<BaseState>,
  'suited-up': suitedUp as unknown as GameDefinition<BaseState>,
  'pressure-cooker': pressureCooker as unknown as GameDefinition<BaseState>,
  speedrun: speedrun as unknown as GameDefinition<BaseState>,
  flood: flood as unknown as GameDefinition<BaseState>,
  'wrong-way': wrongWay as unknown as GameDefinition<BaseState>,
};

export function getGame(id: GameId): GameDefinition<BaseState> {
  const g = GAMES[id];
  if (!g) throw new Error(`unknown game ${id}`);
  return g;
}

export const GAME_META: Record<GameId, GameMeta> = Object.fromEntries(
  Object.entries(GAMES).map(([id, g]) => [id, g.meta]),
) as Record<GameId, GameMeta>;

export * from './common';
export { COLORS } from './guessColor';
export { SUITS, compareSuits, suitedScore } from './suitedUp';
export { pressureHundredths, PRESSURE_GROWTH } from './pressureCooker';
export { decodeBoard } from './decode';
