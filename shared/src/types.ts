export const GAME_IDS = [
  'guess-color',
  'zero-hour',
  'high-low',
  'decode',
  'suited-up',
  'pressure-cooker',
  'speedrun',
  'flood',
  'wrong-way',
] as const;
export type GameId = (typeof GAME_IDS)[number];

export type PayoutStructure = 'PER_STAGE' | 'MOST_WINS' | 'HYBRID';
export type GameSelection = 'MANUAL' | 'RANDOM';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'PTS';

export type SpecialAwardType =
  | 'FIRST_STAGE'
  | 'FINAL_STAGE'
  | 'STAGE_N'
  | 'MOST_ROUNDS_SURVIVED'
  | 'HIGHEST_CASHOUT'
  | 'CLOSEST_ZERO_HOUR'
  | 'FASTEST_CORRECT';

export interface SpecialAward {
  id: string;
  type: SpecialAwardType;
  label: string;
  amountCents: number;
  /** Only used by STAGE_N (1-based). */
  stage?: number;
}

export interface TournamentConfig {
  title: string;
  currency: Currency;
  payout: {
    structure: PayoutStructure;
    /** Paid to each stage's winner (PER_STAGE and HYBRID). */
    stageAwardCents: number;
    /** Paid to the most-stage-wins winner (MOST_WINS and HYBRID). */
    finalAwardCents: number;
  };
  specialAwards: SpecialAward[];
  stages: number;
  timer: { minSeconds: number; maxSeconds: number };
  games: {
    selection: GameSelection;
    /** MANUAL: exactly one game per stage. */
    manual: GameId[];
    /** RANDOM: the pool the generator may draw from. */
    pool: GameId[];
  };
  entry: {
    maxPlayers: number;
    lateEntry: boolean;
    /** Late entrants may join until this stage has started (1-based). */
    lateEntryUntilStage: number;
    hostCompetes: boolean;
    visibility: 'PRIVATE' | 'PUBLIC';
  };
  invite: { expiresInHours: number; maxUses: number };
  gameSettings: {
    zeroHourPercent: number;
  };
}

export const LIMITS = {
  minStages: 10,
  maxStages: 25,
  minTimer: 15,
  maxTimer: 45,
  minPlayersToStart: 2,
  maxPlayers: 200,
  maxAwardCents: 100_000_000, // 1,000,000.00 per line item
  maxSpecialAwards: 6,
  countdownSeconds: 60,
  inviteHours: [1, 6, 24, 72, 168] as const,
  maxInviteUses: 500,
  titleMax: 60,
  chatMax: 280,
  lobbyLifetimeHours: 72,
} as const;

export interface PlayerStageStats {
  stageWins: number;
  outrightWins: number;
  roundsSurvived: number;
  eliminations: number;
}
