/**
 * Browser-safe entry point. The web app imports only from here: rules text,
 * validation, protocol and view types — never game implementations, puzzle
 * libraries or task answers (scripts/build-web.mjs checks the bundle).
 */
export * from './types';
export * from './config';
export { ERROR_TEXT } from './protocol';
export type { ClientMessage, ServerMessage } from './protocol';
export type { RoomView, Phase, PlayerStatus, ChatMessage, FinalResults } from './room';
export type { StageRecord, StandingRow, Allocation, AwardResult } from './results';
export type { GameMeta } from './games/common';
export { GAME_META_DATA as GAME_META, COLORS, SUITS } from './games/meta';
export { compareSuits, suitedScore } from './games/suitedUp';
export { pressureHundredths, PRESSURE_GROWTH } from './games/pressureCooker';
