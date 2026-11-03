import type { GameUIRegistry } from './types';
import { GuessColorPlay, GuessColorReveal } from './GuessColor';
import { ZeroHourPlay, ZeroHourReveal } from './ZeroHour';
import { HighLowPlay, HighLowReveal } from './HighLow';
import { DecodePlay, DecodeReveal } from './Decode';
import { SuitedUpPlay, SuitedUpReveal } from './SuitedUp';
import { PressurePlay, PressureReveal } from './PressureCooker';
import { SpeedrunPlay, SpeedrunReveal } from './Speedrun';
import { FloodPlay, FloodReveal } from './Flood';

/**
 * Each game supplies its own board and reveal. The gameplay room picks the
 * pair by game id and knows nothing else about how a game looks.
 */
export const GAME_UI: GameUIRegistry = {
  'guess-color': { Play: GuessColorPlay, Reveal: GuessColorReveal },
  'zero-hour': { Play: ZeroHourPlay, Reveal: ZeroHourReveal },
  'high-low': { Play: HighLowPlay, Reveal: HighLowReveal },
  decode: { Play: DecodePlay, Reveal: DecodeReveal },
  'suited-up': { Play: SuitedUpPlay, Reveal: SuitedUpReveal },
  'pressure-cooker': { Play: PressurePlay, Reveal: PressureReveal },
  speedrun: { Play: SpeedrunPlay, Reveal: SpeedrunReveal },
  flood: { Play: FloodPlay, Reveal: FloodReveal },
};
