import { GAME_IDS, LIMITS, type GameId, type TournamentConfig, type SpecialAwardType } from './types';
import type { Rng } from './rng';

export const SPECIAL_AWARD_TYPES: Record<SpecialAwardType, { label: string; describe: (stage?: number) => string; needs?: GameId[] }> = {
  FIRST_STAGE: { label: 'First Blood', describe: () => 'Winner of stage 1.' },
  FINAL_STAGE: { label: 'Closer', describe: () => 'Winner of the final stage.' },
  STAGE_N: { label: 'Marked Stage', describe: (n) => `Winner of stage ${n ?? '?'}.` },
  MOST_ROUNDS_SURVIVED: { label: 'Iron Lung', describe: () => 'Most game rounds survived across the tournament.' },
  HIGHEST_CASHOUT: { label: 'Nerve', describe: () => 'Highest locked multiplier in any Pressure Cooker stage.', needs: ['pressure-cooker'] },
  CLOSEST_ZERO_HOUR: { label: 'Dead Center', describe: () => 'Closest single Zero Hour guess to its target.', needs: ['zero-hour'] },
  FASTEST_CORRECT: { label: 'Quick Draw', describe: () => 'Fastest correct answer in any Decode or Speedrun round.', needs: ['decode', 'speedrun'] },
};

export function defaultConfig(): TournamentConfig {
  return {
    title: '',
    currency: 'USD',
    payout: { structure: 'PER_STAGE', stageAwardCents: 500, finalAwardCents: 0 },
    specialAwards: [],
    stages: 10,
    timer: { minSeconds: 20, maxSeconds: 35 },
    games: { selection: 'RANDOM', manual: [], pool: [...GAME_IDS] },
    entry: { maxPlayers: 50, lateEntry: false, lateEntryUntilStage: 5, hostCompetes: true, visibility: 'PRIVATE' },
    invite: { expiresInHours: 24, maxUses: 50 },
    gameSettings: { zeroHourPercent: 67 },
  };
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isGame = (g: unknown): g is GameId => typeof g === 'string' && (GAME_IDS as readonly string[]).includes(g);

export interface ConfigError {
  field: string;
  message: string;
}

/** Coerces irrelevant fields so stored configs are unambiguous. */
export function normalizeConfig(input: TournamentConfig): TournamentConfig {
  const c: TournamentConfig = JSON.parse(JSON.stringify(input));
  c.title = (c.title ?? '').trim().replace(/\s+/g, ' ');
  if (c.payout.structure === 'PER_STAGE') c.payout.finalAwardCents = 0;
  if (c.payout.structure === 'MOST_WINS') c.payout.stageAwardCents = 0;
  if (c.payout.structure !== 'PER_STAGE') c.entry.lateEntry = false;
  if (!c.entry.lateEntry) c.entry.lateEntryUntilStage = 1;
  if (c.games.selection === 'MANUAL') c.games.pool = [];
  else c.games.manual = [];
  c.specialAwards = (c.specialAwards ?? []).map((a, i) => ({
    id: a.id || `award-${i + 1}`,
    type: a.type,
    label: (a.label || SPECIAL_AWARD_TYPES[a.type]?.label || 'Special award').trim().slice(0, 40),
    amountCents: a.amountCents,
    ...(a.type === 'STAGE_N' ? { stage: a.stage } : {}),
  }));
  return c;
}

export function validateConfig(c: TournamentConfig): ConfigError[] {
  const e: ConfigError[] = [];
  const err = (field: string, message: string) => e.push({ field, message });

  if (typeof c.title !== 'string' || c.title.trim().length < 3 || c.title.trim().length > LIMITS.titleMax) {
    err('title', `Title must be 3–${LIMITS.titleMax} characters.`);
  }
  if (!['USD', 'EUR', 'GBP', 'PTS'].includes(c.currency)) err('currency', 'Unsupported currency.');

  const { structure, stageAwardCents, finalAwardCents } = c.payout ?? ({} as TournamentConfig['payout']);
  if (!['PER_STAGE', 'MOST_WINS', 'HYBRID'].includes(structure)) err('payout.structure', 'Choose a payout structure.');
  const needsStage = structure === 'PER_STAGE' || structure === 'HYBRID';
  const needsFinal = structure === 'MOST_WINS' || structure === 'HYBRID';
  if (needsStage && (!isInt(stageAwardCents) || stageAwardCents <= 0 || stageAwardCents > LIMITS.maxAwardCents)) {
    err('payout.stageAwardCents', 'Stage award must be greater than zero.');
  }
  if (needsFinal && (!isInt(finalAwardCents) || finalAwardCents <= 0 || finalAwardCents > LIMITS.maxAwardCents)) {
    err('payout.finalAwardCents', 'Final award must be greater than zero.');
  }

  if (!isInt(c.stages) || c.stages < LIMITS.minStages || c.stages > LIMITS.maxStages) {
    err('stages', `Stages must be between ${LIMITS.minStages} and ${LIMITS.maxStages}.`);
  }

  const { minSeconds, maxSeconds } = c.timer ?? ({} as TournamentConfig['timer']);
  const inTimer = (n: unknown) => isInt(n) && n >= LIMITS.minTimer && n <= LIMITS.maxTimer;
  if (!inTimer(minSeconds)) err('timer.minSeconds', `Minimum must be ${LIMITS.minTimer}–${LIMITS.maxTimer} seconds.`);
  if (!inTimer(maxSeconds)) err('timer.maxSeconds', `Maximum must be ${LIMITS.minTimer}–${LIMITS.maxTimer} seconds.`);
  if (inTimer(minSeconds) && inTimer(maxSeconds) && minSeconds > maxSeconds) {
    err('timer.maxSeconds', 'Maximum cannot be lower than minimum.');
  }

  if (c.games?.selection === 'MANUAL') {
    if (!Array.isArray(c.games.manual) || c.games.manual.length !== c.stages) {
      err('games.manual', 'Assign exactly one game to every stage.');
    } else if (!c.games.manual.every(isGame)) {
      err('games.manual', 'Unknown game in stage list.');
    }
  } else if (c.games?.selection === 'RANDOM') {
    const pool = c.games.pool ?? [];
    if (pool.length === 0) err('games.pool', 'Pick at least one game for the random pool.');
    else if (!pool.every(isGame) || new Set(pool).size !== pool.length) err('games.pool', 'Invalid game pool.');
  } else {
    err('games.selection', 'Choose manual or random game selection.');
  }

  const en = c.entry ?? ({} as TournamentConfig['entry']);
  if (!isInt(en.maxPlayers) || en.maxPlayers < LIMITS.minPlayersToStart || en.maxPlayers > LIMITS.maxPlayers) {
    err('entry.maxPlayers', `Player cap must be ${LIMITS.minPlayersToStart}–${LIMITS.maxPlayers}.`);
  }
  if (en.lateEntry) {
    if (structure !== 'PER_STAGE') err('entry.lateEntry', 'Late entry is only available with Per Stage Winner payouts.');
    if (!isInt(en.lateEntryUntilStage) || en.lateEntryUntilStage < 2 || en.lateEntryUntilStage > c.stages) {
      err('entry.lateEntryUntilStage', `Late-entry cutoff must be stage 2–${c.stages}.`);
    }
  }
  if (!['PRIVATE', 'PUBLIC'].includes(en.visibility)) err('entry.visibility', 'Choose visibility.');

  if (!(LIMITS.inviteHours as readonly number[]).includes(c.invite?.expiresInHours)) err('invite.expiresInHours', 'Choose an invite expiry.');
  if (!isInt(c.invite?.maxUses) || c.invite.maxUses < 1 || c.invite.maxUses > LIMITS.maxInviteUses) {
    err('invite.maxUses', `Invite uses must be 1–${LIMITS.maxInviteUses}.`);
  }

  const zh = c.gameSettings?.zeroHourPercent;
  if (!isInt(zh) || zh < 10 || zh > 100) err('gameSettings.zeroHourPercent', 'Zero Hour percentage must be 10–100.');

  const awards = c.specialAwards ?? [];
  if (awards.length > LIMITS.maxSpecialAwards) err('specialAwards', `At most ${LIMITS.maxSpecialAwards} special awards.`);
  const games = new Set<GameId>(c.games?.selection === 'MANUAL' ? c.games.manual : c.games?.pool ?? []);
  awards.forEach((a, i) => {
    const meta = SPECIAL_AWARD_TYPES[a.type];
    if (!meta) return err(`specialAwards.${i}`, 'Unknown award type.');
    if (!isInt(a.amountCents) || a.amountCents <= 0 || a.amountCents > LIMITS.maxAwardCents) {
      err(`specialAwards.${i}`, 'Award amount must be greater than zero.');
    }
    if (a.type === 'STAGE_N' && (!isInt(a.stage) || a.stage < 1 || a.stage > c.stages)) {
      err(`specialAwards.${i}`, `Stage must be 1–${c.stages}.`);
    }
    if (meta.needs && !meta.needs.some((g) => games.has(g))) {
      err(`specialAwards.${i}`, `Requires ${meta.needs.join(' or ')} in the game lineup.`);
    }
  });
  return e;
}

/**
 * Stage lineup. MANUAL is copied verbatim. RANDOM uses every pool game at
 * least once (pools never exceed the 10-stage minimum) and never places the
 * same game twice in a row when the pool has more than one game.
 */
export function buildSequence(c: TournamentConfig, rng: Rng): GameId[] {
  if (c.games.selection === 'MANUAL') return c.games.manual.slice();
  const pool = c.games.pool;
  const counts = new Map<GameId, number>();
  for (const g of pool) counts.set(g, 1);
  for (let i = pool.length; i < c.stages; i++) {
    const g = pool[rng.int(0, pool.length - 1)];
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  // Keep any single game from exceeding what adjacency rules allow.
  const cap = Math.ceil(c.stages / 2);
  for (const [g, n] of counts) {
    if (n > cap && pool.length > 1) {
      counts.set(g, cap);
      let extra = n - cap;
      const others = pool.filter((x) => x !== g);
      while (extra-- > 0) {
        const o = others[rng.int(0, others.length - 1)];
        counts.set(o, (counts.get(o) ?? 0) + 1);
      }
    }
  }
  const seq: GameId[] = [];
  let prev: GameId | null = null;
  for (let remaining = c.stages; remaining > 0; remaining--) {
    const entries = [...counts.entries()].filter(([, n]) => n > 0);
    // A game holding more than half of what's left must go now (unless it just went).
    const forced = entries.find(([g, n]) => n > Math.floor(remaining / 2) && g !== prev);
    let candidates = forced ? [forced] : entries.filter(([g]) => g !== prev || pool.length === 1);
    if (candidates.length === 0) candidates = entries;
    const total = candidates.reduce((s, [, n]) => s + n, 0);
    let r = rng.int(1, total);
    let chosen = candidates[0][0];
    for (const [g, n] of candidates) {
      r -= n;
      if (r <= 0) {
        chosen = g;
        break;
      }
    }
    seq.push(chosen);
    counts.set(chosen, (counts.get(chosen) ?? 0) - 1);
    prev = chosen;
  }
  return seq;
}

/** Stage timer in ms, drawn uniformly from the sponsor's whole-second range. */
export function rollStageDurationMs(c: TournamentConfig, rng: Rng): number {
  return rng.int(c.timer.minSeconds, c.timer.maxSeconds) * 1000;
}

export function totalCommitmentCents(c: TournamentConfig): number {
  const stage = c.payout.structure === 'MOST_WINS' ? 0 : c.payout.stageAwardCents * c.stages;
  const final = c.payout.structure === 'PER_STAGE' ? 0 : c.payout.finalAwardCents;
  return stage + final + c.specialAwards.reduce((s, a) => s + a.amountCents, 0);
}

export function formatMoney(cents: number, currency: string): string {
  if (currency === 'PTS') return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} PTS`;
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const neg = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${neg}${sym}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Stable JSON for hashing and audit comparisons. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
