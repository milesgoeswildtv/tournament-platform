import type { Rng } from './rng';
import type { GameId, TournamentConfig } from './types';
import { LIMITS } from './types';
import { rollStageDurationMs } from './config';
import { getGame, type BaseState, type GameCtx, type RoundResult } from './games';
import { computeAllocations, computeStandings, evaluateAwards, type Allocation, type AwardResult, type ResultPlayer, type StageRecord, type StandingRow } from './results';

/**
 * Authoritative tournament room. Pure and synchronous: the Durable Object
 * feeds it commands and the current server time, persists the resulting
 * state, broadcasts views and writes the emitted events to D1.
 */

export type Phase = 'LOBBY' | 'COUNTDOWN' | 'STAGE_INTRO' | 'ROUND' | 'REVEAL' | 'STAGE_RESULT' | 'FINISHED' | 'CANCELED' | 'ABANDONED';
export const RUNNING_PHASES: Phase[] = ['STAGE_INTRO', 'ROUND', 'REVEAL', 'STAGE_RESULT'];
export const CLOSED_PHASES: Phase[] = ['FINISHED', 'CANCELED', 'ABANDONED'];

export interface RoomPlayer {
  id: string;
  name: string;
  tag: string;
  role: 'HOST' | 'PLAYER';
  competes: boolean;
  joinedAt: number;
  joinOrder: number;
  eligibleFrom: number;
  left: boolean;
  connected: boolean;
}

export interface ChatMessage {
  id: number;
  playerId: string | null;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

export interface RoomTiming {
  countdownMs: number;
  introMs: number;
  revealMs: number;
  resultMs: number;
  lobbyLifetimeMs: number;
  /** 1 in production. Only local development/tests may shrink time. */
  scale: number;
}

export const DEFAULT_TIMING: RoomTiming = {
  countdownMs: LIMITS.countdownSeconds * 1000,
  introMs: 6000,
  revealMs: 5000,
  resultMs: 6000,
  lobbyLifetimeMs: LIMITS.lobbyLifetimeHours * 3600_000,
  scale: 1,
};

export interface StageLive {
  index: number;
  gameId: GameId;
  durationMs: number;
  participants: string[];
  game: BaseState;
  submitted: Record<string, number>;
  eliminations: { playerId: string; round: number; reason: string }[];
  lastRound: (RoundResult & { round: number }) | null;
}

export interface FinalResults {
  standings: StandingRow[];
  allocations: Allocation[];
  awards: AwardResult[];
  winners: string[];
}

export interface RoomState {
  v: 1;
  id: string;
  title: string;
  sponsorId: string;
  config: TournamentConfig;
  configHash: string;
  createdAt: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  players: Record<string, RoomPlayer>;
  joinCounter: number;
  sequence: GameId[];
  currentStage: number;
  stage: StageLive | null;
  stages: StageRecord[];
  chat: ChatMessage[];
  chatCounter: number;
  final: FinalResults | null;
  endedReason: string | null;
  timing: RoomTiming;
}

export interface RoomEvent {
  type: string;
  actorId: string | null;
  at: number;
  data: Record<string, unknown>;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface UserRef {
  id: string;
  name: string;
  tag: string;
}

export function createRoomState(args: {
  id: string;
  sponsor: UserRef;
  config: TournamentConfig;
  configHash: string;
  sequence: GameId[];
  now: number;
  timing?: RoomTiming;
}): RoomState {
  const timing = args.timing ?? DEFAULT_TIMING;
  return {
    v: 1,
    id: args.id,
    title: args.config.title,
    sponsorId: args.sponsor.id,
    config: args.config,
    configHash: args.configHash,
    createdAt: args.now,
    phase: 'LOBBY',
    phaseStartedAt: args.now,
    phaseEndsAt: args.now + timing.lobbyLifetimeMs,
    players: {
      [args.sponsor.id]: {
        ...args.sponsor,
        role: 'HOST',
        competes: args.config.entry.hostCompetes,
        joinedAt: args.now,
        joinOrder: 1,
        eligibleFrom: 1,
        left: false,
        connected: false,
      },
    },
    joinCounter: 1,
    sequence: args.sequence,
    currentStage: 0,
    stage: null,
    stages: [],
    chat: [],
    chatCounter: 0,
    final: null,
    endedReason: null,
    timing,
  };
}

const scaled = (t: RoomTiming, ms: number) => Math.max(50, Math.round(ms * t.scale));

export class RoomCore {
  readonly events: RoomEvent[] = [];
  /** Players whose private view changed outside a broadcast (e.g. a reroll). */
  readonly replies: { playerId: string; data: unknown }[] = [];

  constructor(
    public s: RoomState,
    private rng: Rng,
  ) {}

  drainEvents(): RoomEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private emit(type: string, at: number, data: Record<string, unknown> = {}, actorId: string | null = null) {
    this.events.push({ type, actorId, at, data });
  }

  private system(text: string, at: number) {
    this.pushChat({ id: ++this.s.chatCounter, playerId: null, name: 'SYSTEM', text, at, system: true });
  }

  private pushChat(m: ChatMessage) {
    this.s.chat.push(m);
    if (this.s.chat.length > 100) this.s.chat.splice(0, this.s.chat.length - 100);
  }

  private setPhase(phase: Phase, now: number, durationMs: number | null) {
    this.s.phase = phase;
    this.s.phaseStartedAt = now;
    this.s.phaseEndsAt = durationMs === null ? null : now + durationMs;
  }

  private ctx(now: number): GameCtx {
    return { rng: this.rng, now, settings: { zeroHourPercent: this.s.config.gameSettings.zeroHourPercent } };
  }

  get isRunning() {
    return RUNNING_PHASES.includes(this.s.phase);
  }

  get isClosed() {
    return CLOSED_PHASES.includes(this.s.phase);
  }

  competitors(): RoomPlayer[] {
    return Object.values(this.s.players).filter((p) => p.competes && !p.left);
  }

  // ---------------------------------------------------------------- membership

  /** Checks whether a user could join right now, without changing anything. */
  canJoin(userId: string): Result<{ eligibleFrom: number; already: boolean }> {
    const existing = this.s.players[userId];
    if (existing && !existing.left) return { ok: true, eligibleFrom: existing.eligibleFrom, already: true };
    if (this.isClosed) return { ok: false, error: 'tournament_closed' };
    if (existing?.left && this.isRunning) return { ok: false, error: 'forfeited' };
    let eligibleFrom = 1;
    if (this.isRunning) {
      const e = this.s.config.entry;
      if (!e.lateEntry) return { ok: false, error: 'entry_closed' };
      if (this.s.currentStage >= e.lateEntryUntilStage) return { ok: false, error: 'late_entry_closed' };
      eligibleFrom = this.s.currentStage + 1;
    }
    if (this.competitors().length >= this.s.config.entry.maxPlayers) return { ok: false, error: 'tournament_full' };
    return { ok: true, eligibleFrom, already: false };
  }

  join(user: UserRef, now: number, via: string | null = null): Result<{ eligibleFrom: number; already: boolean }> {
    const check = this.canJoin(user.id);
    if (!check.ok || check.already) return check;
    const late = this.isRunning;
    this.s.players[user.id] = {
      ...user,
      role: user.id === this.s.sponsorId ? 'HOST' : 'PLAYER',
      competes: user.id === this.s.sponsorId ? this.s.config.entry.hostCompetes : true,
      joinedAt: now,
      joinOrder: ++this.s.joinCounter,
      eligibleFrom: check.eligibleFrom,
      left: false,
      connected: this.s.players[user.id]?.connected ?? false,
    };
    this.emit('PLAYER_JOINED', now, { playerId: user.id, name: user.name, eligibleFrom: check.eligibleFrom, late, via }, user.id);
    this.system(late ? `${user.name} entered late — eligible from stage ${check.eligibleFrom}.` : `${user.name} joined.`, now);
    return { ok: true, eligibleFrom: check.eligibleFrom, already: false };
  }

  leave(userId: string, now: number): Result {
    const p = this.s.players[userId];
    if (!p || p.left) return { ok: false, error: 'not_in_tournament' };
    if (userId === this.s.sponsorId) return { ok: false, error: 'host_cannot_leave' };
    if (this.isClosed) return { ok: false, error: 'tournament_closed' };
    p.left = true;
    this.emit('PLAYER_LEFT', now, { playerId: userId, phase: this.s.phase, forfeit: this.isRunning }, userId);
    this.system(this.isRunning ? `${p.name} forfeited.` : `${p.name} left.`, now);
    if (this.s.phase === 'COUNTDOWN' && this.competitors().length < LIMITS.minPlayersToStart) {
      this.setPhase('LOBBY', now, this.s.createdAt + this.s.timing.lobbyLifetimeMs - now);
      this.emit('COUNTDOWN_ABORTED', now, { reason: 'not_enough_players' });
      this.system('Countdown stopped — not enough players.', now);
    }
    return { ok: true };
  }

  setConnected(userId: string, connected: boolean, now: number) {
    const p = this.s.players[userId];
    if (!p || p.connected === connected) return;
    p.connected = connected;
    this.emit(connected ? 'PLAYER_CONNECTED' : 'PLAYER_DISCONNECTED', now, { playerId: userId, phase: this.s.phase, stage: this.s.currentStage, round: this.s.stage?.game.round ?? 0 }, userId);
  }

  chat(userId: string, raw: string, now: number): Result {
    const p = this.s.players[userId];
    if (!p || p.left) return { ok: false, error: 'not_in_tournament' };
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.chatMax);
    if (!text) return { ok: false, error: 'empty_message' };
    const m: ChatMessage = { id: ++this.s.chatCounter, playerId: userId, name: p.name, text, at: now };
    this.pushChat(m);
    this.emit('CHAT', now, { id: m.id, text }, userId);
    return { ok: true };
  }

  // ---------------------------------------------------------------- sponsor controls

  start(userId: string, now: number): Result {
    if (userId !== this.s.sponsorId) return { ok: false, error: 'not_sponsor' };
    if (this.s.phase !== 'LOBBY') return { ok: false, error: 'not_in_lobby' };
    const n = this.competitors().length;
    if (n < LIMITS.minPlayersToStart) return { ok: false, error: 'not_enough_players' };
    this.setPhase('COUNTDOWN', now, scaled(this.s.timing, this.s.timing.countdownMs));
    this.emit('COUNTDOWN_STARTED', now, { endsAt: this.s.phaseEndsAt, players: n, configHash: this.s.configHash }, userId);
    this.system(`Countdown started. ${n} competitors.`, now);
    return { ok: true };
  }

  abortCountdown(userId: string, now: number): Result {
    if (userId !== this.s.sponsorId) return { ok: false, error: 'not_sponsor' };
    if (this.s.phase !== 'COUNTDOWN') return { ok: false, error: 'not_counting_down' };
    this.setPhase('LOBBY', now, this.s.createdAt + this.s.timing.lobbyLifetimeMs - now);
    this.emit('COUNTDOWN_ABORTED', now, { reason: 'sponsor' }, userId);
    this.system('The host stopped the countdown.', now);
    return { ok: true };
  }

  cancel(userId: string, now: number, reason = 'Canceled by host'): Result {
    if (userId !== this.s.sponsorId) return { ok: false, error: 'not_sponsor' };
    if (this.s.phase !== 'LOBBY' && this.s.phase !== 'COUNTDOWN') return { ok: false, error: 'already_started' };
    this.setPhase('CANCELED', now, null);
    this.s.endedReason = reason;
    this.emit('TOURNAMENT_CANCELED', now, { reason }, userId);
    this.system('Tournament canceled by the host.', now);
    return { ok: true };
  }

  // ---------------------------------------------------------------- gameplay

  act(userId: string, msg: { stage?: unknown; round?: unknown; action?: unknown }, now: number): Result<{ reply?: unknown }> {
    const reject = (error: string): Result<{ reply?: unknown }> => {
      this.emit('SUBMISSION', now, { stage: this.s.currentStage, round: this.s.stage?.game.round ?? 0, playerId: userId, action: msg.action ?? null, accepted: false, error }, userId);
      return { ok: false, error };
    };
    const st = this.s.stage;
    if (!st || this.s.phase !== 'ROUND') return reject('round_closed');
    if (msg.stage !== st.index || msg.round !== st.game.round) return reject('stale_round');
    if (this.s.phaseEndsAt !== null && now >= this.s.phaseEndsAt) return reject('round_closed');
    if (!this.s.players[userId] || this.s.players[userId].left) return reject('not_in_tournament');
    if (!st.game.alive.includes(userId)) return reject(st.participants.includes(userId) ? 'eliminated' : 'not_in_stage');
    const game = getGame(st.gameId);
    const r = game.act(st.game, userId, msg.action, this.ctx(now));
    if (!r.ok) return reject(r.error);
    st.game = r.state;
    st.submitted[userId] ??= now;
    this.emit('SUBMISSION', now, { stage: st.index, round: st.game.round, playerId: userId, action: msg.action ?? null, accepted: true }, userId);
    if (r.reply !== undefined) this.replies.push({ playerId: userId, data: r.reply });
    if (game.roundReady(st.game)) this.resolveRound(now);
    return { ok: true, reply: r.reply };
  }

  /** Earliest moment the room needs to be woken. */
  nextDeadline(): number | null {
    let d = this.s.phaseEndsAt;
    const st = this.s.stage;
    if (this.s.phase === 'ROUND' && st) {
      const inner = getGame(st.gameId).internalDeadline?.(st.game) ?? null;
      if (inner !== null && (d === null || inner < d)) d = inner;
    }
    return d;
  }

  /** Processes every deadline that has passed. Safe to call at any time. */
  advance(now: number): void {
    for (let guard = 0; guard < 200; guard++) {
      const d = this.nextDeadline();
      if (d === null || now < d) return;
      this.step(now);
    }
  }

  private step(now: number) {
    const s = this.s;
    switch (s.phase) {
      case 'LOBBY':
        this.setPhase('ABANDONED', now, null);
        s.endedReason = 'Lobby expired before the host started it';
        this.emit('TOURNAMENT_ABANDONED', now, { reason: s.endedReason });
        this.system('Lobby expired.', now);
        return;
      case 'COUNTDOWN':
        if (this.competitors().length < LIMITS.minPlayersToStart) {
          this.setPhase('LOBBY', now, s.createdAt + s.timing.lobbyLifetimeMs - now);
          this.emit('COUNTDOWN_ABORTED', now, { reason: 'not_enough_players' });
          return;
        }
        this.emit('TOURNAMENT_STARTED', now, { configHash: s.configHash, sequence: s.sequence, players: this.competitors().map((p) => p.id) });
        this.startStage(1, now);
        return;
      case 'STAGE_INTRO':
        this.startRound(now);
        return;
      case 'ROUND': {
        const st = s.stage!;
        const game = getGame(st.gameId);
        const inner = game.internalDeadline?.(st.game) ?? null;
        if (inner !== null && now >= inner && game.onInternalDeadline) {
          st.game = game.onInternalDeadline(st.game, this.ctx(now));
          this.emit('ROUND_INTERNAL_DEADLINE', now, { stage: st.index, round: st.game.round });
          if (game.roundReady(st.game)) this.resolveRound(now);
          return;
        }
        this.resolveRound(now);
        return;
      }
      case 'REVEAL':
        if (s.stage!.game.done) this.finishStage(now);
        else this.startRound(now);
        return;
      case 'STAGE_RESULT':
        if (s.currentStage < s.sequence.length) this.startStage(s.currentStage + 1, now);
        else this.finishTournament(now);
        return;
      default:
        s.phaseEndsAt = null;
    }
  }

  private startStage(index: number, now: number) {
    const s = this.s;
    s.currentStage = index;
    const gameId = s.sequence[index - 1];
    const participants = this.competitors()
      .filter((p) => p.eligibleFrom <= index)
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => p.id);
    const durationMs = scaled(s.timing, rollStageDurationMs(s.config, this.rng));
    const game = getGame(gameId).init(participants, this.ctx(now));
    s.stage = { index, gameId, durationMs, participants, game, submitted: {}, eliminations: [], lastRound: null };
    this.emit('STAGE_STARTED', now, { stage: index, gameId, durationMs, participants });
    if (participants.length === 0) {
      this.finishStage(now);
      return;
    }
    this.setPhase('STAGE_INTRO', now, scaled(s.timing, s.timing.introMs));
  }

  private startRound(now: number) {
    const st = this.s.stage!;
    const game = getGame(st.gameId);
    st.game = game.startRound(st.game, { startedAt: now, endsAt: now + st.durationMs }, this.ctx(now));
    st.submitted = {};
    st.lastRound = null;
    this.setPhase('ROUND', now, st.durationMs);
    this.emit('ROUND_STARTED', now, { stage: st.index, round: st.game.round, startedAt: now, endsAt: now + st.durationMs, alive: st.game.alive });
  }

  private resolveRound(now: number) {
    const st = this.s.stage!;
    const { state, result } = getGame(st.gameId).resolveRound(st.game, this.ctx(now));
    st.game = state;
    st.lastRound = { ...result, round: state.round };
    for (const e of result.eliminated) st.eliminations.push({ ...e, round: state.round });
    this.setPhase('REVEAL', now, scaled(this.s.timing, this.s.timing.revealMs));
    this.emit('ROUND_RESOLVED', now, { stage: st.index, round: state.round, eliminated: result.eliminated, survivors: result.survivors, voided: result.voided, reveal: result.reveal });
  }

  private finishStage(now: number) {
    const st = this.s.stage!;
    const o = getGame(st.gameId).outcome(st.game);
    const rec: StageRecord = {
      index: st.index,
      gameId: st.gameId,
      durationMs: st.durationMs,
      participants: st.participants,
      winners: o.winners,
      ranking: o.ranking,
      metrics: o.metrics,
      eliminations: st.eliminations,
      rounds: st.game.round,
      summary: o.summary,
    };
    this.s.stages.push(rec);
    this.emit('STAGE_FINISHED', now, { ...rec });
    const names = o.winners.map((w) => this.s.players[w]?.name ?? '?');
    this.system(names.length ? `Stage ${st.index}: ${names.join(' & ')} ${names.length > 1 ? 'share the win' : 'wins'}.` : `Stage ${st.index}: no winner.`, now);
    this.setPhase('STAGE_RESULT', now, scaled(this.s.timing, this.s.timing.resultMs));
  }

  resultPlayers(): ResultPlayer[] {
    return Object.values(this.s.players)
      .filter((p) => p.competes)
      .map((p) => ({ id: p.id, joinOrder: p.joinOrder, eligibleFrom: p.eligibleFrom }));
  }

  private finishTournament(now: number) {
    const players = this.resultPlayers();
    const standings = computeStandings(players, this.s.stages);
    const awards = evaluateAwards(this.s.config.specialAwards, this.s.stages, standings, players);
    const allocations = computeAllocations(this.s.config, players, this.s.stages, standings, awards);
    const winners = standings.filter((r) => r.rank === 1 && r.stageWins > 0).map((r) => r.playerId);
    this.s.final = { standings, allocations, awards, winners };
    this.s.stage = null;
    this.setPhase('FINISHED', now, null);
    this.emit('TOURNAMENT_FINISHED', now, { standings, allocations, awards, winners });
    const names = winners.map((w) => this.s.players[w]?.name ?? '?');
    this.system(names.length ? `Tournament over. ${names.join(' & ')} ${names.length > 1 ? 'share the title' : 'takes it'}.` : 'Tournament over. No stage winners.', now);
  }

  // ---------------------------------------------------------------- views

  stageWins(): Record<string, number> {
    const w: Record<string, number> = {};
    for (const st of this.s.stages) for (const p of st.winners) w[p] = (w[p] ?? 0) + 1;
    return w;
  }

  view(userId: string | null, now: number): RoomView {
    const s = this.s;
    const st = s.stage;
    const wins = this.stageWins();
    const game = st ? getGame(st.gameId) : null;
    const showReveal = s.phase === 'REVEAL' || s.phase === 'STAGE_RESULT';
    const me = userId ? s.players[userId] : undefined;
    const stageStatus = (id: string): PlayerStatus => {
      const p = s.players[id];
      if (p.left) return 'left';
      if (!p.competes) return 'host';
      if (!st) return 'ready';
      if (!st.participants.includes(id)) return 'waiting';
      if (st.game.alive.includes(id)) return 'alive';
      return 'out';
    };
    return {
      id: s.id,
      title: s.title,
      phase: s.phase,
      phaseStartedAt: s.phaseStartedAt,
      phaseEndsAt: s.phaseEndsAt,
      serverNow: now,
      sponsorId: s.sponsorId,
      sponsorName: s.players[s.sponsorId]?.name ?? 'Host',
      config: s.config,
      configHash: s.configHash,
      totalStages: s.sequence.length,
      currentStage: s.currentStage,
      lineup: s.sequence.map((g, i) => (s.config.games.selection === 'MANUAL' || i < s.currentStage || this.isClosed ? g : null)),
      endedReason: s.endedReason,
      players: Object.values(s.players)
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((p) => ({
          id: p.id,
          name: p.name,
          tag: p.tag,
          role: p.role,
          competes: p.competes,
          connected: p.connected,
          left: p.left,
          eligibleFrom: p.eligibleFrom,
          stageWins: wins[p.id] ?? 0,
          status: stageStatus(p.id),
          submitted: !!(st && s.phase === 'ROUND' && st.submitted[p.id]),
        })),
      stage:
        st && game
          ? {
              index: st.index,
              gameId: st.gameId,
              durationMs: st.durationMs,
              round: st.game.round,
              maxRounds: st.game.maxRounds,
              roundStartedAt: st.game.startedAt,
              roundEndsAt: st.game.endsAt,
              participantCount: st.participants.length,
              aliveCount: st.game.alive.length,
              submittedCount: Object.keys(st.submitted).length,
              public: s.phase === 'ROUND' ? game.publicView(st.game) : null,
              reveal: showReveal ? (st.lastRound?.reveal ?? null) : null,
              lastRound: showReveal && st.lastRound
                ? { round: st.lastRound.round, voided: st.lastRound.voided, eliminated: st.lastRound.eliminated, survivors: st.lastRound.survivors }
                : null,
              done: st.game.done,
            }
          : null,
      results: s.stages.map((r) => ({ index: r.index, gameId: r.gameId, winners: r.winners, summary: r.summary, rounds: r.rounds, participants: r.participants.length })),
      lastStage: s.phase === 'STAGE_RESULT' ? (s.stages[s.stages.length - 1] ?? null) : null,
      chat: s.chat.slice(-60),
      final: s.final,
      me: me
        ? {
            id: me.id,
            isSponsor: me.id === s.sponsorId,
            competes: me.competes,
            left: me.left,
            eligibleFrom: me.eligibleFrom,
            status: stageStatus(me.id),
            submitted: !!(st && st.submitted[me.id]),
            outReason: st?.game.out[me.id]?.reason ?? null,
            private: st && st.participants.includes(me.id) && game ? game.playerView(st.game, me.id) : null,
          }
        : null,
    };
  }
}

export type PlayerStatus = 'alive' | 'out' | 'waiting' | 'ready' | 'host' | 'left';

export interface RoomView {
  id: string;
  title: string;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  serverNow: number;
  sponsorId: string;
  sponsorName: string;
  config: TournamentConfig;
  configHash: string;
  totalStages: number;
  currentStage: number;
  lineup: (GameId | null)[];
  endedReason: string | null;
  players: {
    id: string;
    name: string;
    tag: string;
    role: 'HOST' | 'PLAYER';
    competes: boolean;
    connected: boolean;
    left: boolean;
    eligibleFrom: number;
    stageWins: number;
    status: PlayerStatus;
    submitted: boolean;
  }[];
  stage: null | {
    index: number;
    gameId: GameId;
    durationMs: number;
    round: number;
    maxRounds: number;
    roundStartedAt: number;
    roundEndsAt: number;
    participantCount: number;
    aliveCount: number;
    submittedCount: number;
    public: unknown;
    reveal: unknown;
    lastRound: null | { round: number; voided: boolean; eliminated: { playerId: string; reason: string }[]; survivors: string[] };
    done: boolean;
  };
  results: { index: number; gameId: GameId; winners: string[]; summary: string; rounds: number; participants: number }[];
  lastStage: StageRecord | null;
  chat: ChatMessage[];
  final: FinalResults | null;
  me: null | {
    id: string;
    isSponsor: boolean;
    competes: boolean;
    left: boolean;
    eligibleFrom: number;
    status: PlayerStatus;
    submitted: boolean;
    outReason: string | null;
    private: unknown;
  };
}
