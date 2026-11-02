import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, GAME_IDS, LIMITS, type GameId } from '../shared/src/index';
import { config, makeRoom, playOut, T0 } from './helpers';

const U = (id: string) => ({ id, name: id.toUpperCase(), tag: id.toUpperCase().padEnd(6, 'X') });

describe('lobby, permissions and countdown', () => {
  test('creation puts the sponsor in the lobby as host', () => {
    const room = makeRoom(config());
    assert.equal(room.s.phase, 'LOBBY');
    assert.equal(room.s.players.host.role, 'HOST');
    assert.equal(room.s.sequence.length, 10);
  });

  test('only the sponsor can start, and only with 2+ competitors', () => {
    const room = makeRoom(config());
    assert.deepEqual(room.start('host', T0), { ok: false, error: 'not_enough_players' });
    room.join(U('p1'), T0 + 1);
    assert.deepEqual(room.start('p1', T0 + 2), { ok: false, error: 'not_sponsor' });
    assert.deepEqual(room.start('mallory', T0 + 2), { ok: false, error: 'not_sponsor' });
    assert.deepEqual(room.start('host', T0 + 3), { ok: true });
    assert.equal(room.s.phase, 'COUNTDOWN');
    assert.equal(room.s.phaseEndsAt, T0 + 3 + LIMITS.countdownSeconds * 1000);
    assert.deepEqual(room.start('host', T0 + 4), { ok: false, error: 'not_in_lobby' });
  });

  test('every player sees the same countdown deadline', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.join(U('p2'), T0);
    room.start('host', T0 + 1000);
    const a = room.view('p1', T0 + 1500);
    const b = room.view('p2', T0 + 1700);
    assert.equal(a.phaseEndsAt, b.phaseEndsAt);
    assert.equal(a.phase, 'COUNTDOWN');
  });

  test('countdown advances to stage 1 only when the server deadline passes', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.start('host', T0);
    room.advance(T0 + 59_999);
    assert.equal(room.s.phase, 'COUNTDOWN');
    room.advance(T0 + 60_000);
    assert.equal(room.s.phase, 'STAGE_INTRO');
    assert.equal(room.s.currentStage, 1);
  });

  test('host disconnecting does not affect the countdown or the run', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.setConnected('host', true, T0);
    room.start('host', T0);
    room.setConnected('host', false, T0 + 10);
    room.advance(T0 + 60_000);
    assert.equal(room.s.phase, 'STAGE_INTRO');
    const ev = room.drainEvents().map((e) => e.type);
    assert.ok(ev.includes('PLAYER_DISCONNECTED'));
  });

  test('sponsor can abort countdown or cancel before start, not after', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.start('host', T0);
    assert.deepEqual(room.abortCountdown('p1', T0 + 1), { ok: false, error: 'not_sponsor' });
    assert.deepEqual(room.abortCountdown('host', T0 + 1), { ok: true });
    assert.equal(room.s.phase, 'LOBBY');
    room.start('host', T0 + 2);
    room.advance(T0 + 70_000);
    assert.deepEqual(room.cancel('host', T0 + 70_001), { ok: false, error: 'already_started' });
    const r2 = makeRoom(config());
    assert.deepEqual(r2.cancel('p1', T0), { ok: false, error: 'not_sponsor' });
    assert.deepEqual(r2.cancel('host', T0), { ok: true });
    assert.equal(r2.s.phase, 'CANCELED');
    assert.deepEqual(r2.join(U('p9'), T0 + 1), { ok: false, error: 'tournament_closed' });
  });

  test('countdown stops if a leave drops competitors below the minimum', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.start('host', T0);
    room.leave('p1', T0 + 5);
    assert.equal(room.s.phase, 'LOBBY');
  });

  test('untouched lobby is abandoned when it expires', () => {
    const room = makeRoom(config());
    room.advance(T0 + LIMITS.lobbyLifetimeHours * 3600_000);
    assert.equal(room.s.phase, 'ABANDONED');
    assert.ok(room.drainEvents().some((e) => e.type === 'TOURNAMENT_ABANDONED'));
  });

  test('player cap enforced; host cannot leave; join is idempotent', () => {
    const c = config();
    c.entry.maxPlayers = 2;
    const room = makeRoom(c);
    assert.deepEqual(room.join(U('p1'), T0), { ok: true, eligibleFrom: 1, already: false });
    assert.deepEqual(room.join(U('p1'), T0), { ok: true, eligibleFrom: 1, already: true });
    assert.deepEqual(room.join(U('p2'), T0), { ok: false, error: 'tournament_full' });
    assert.deepEqual(room.leave('host', T0), { ok: false, error: 'host_cannot_leave' });
  });
});

describe('entry cutoff and late entry', () => {
  test('without late entry, nobody joins after the tournament starts', () => {
    const room = makeRoom(config());
    room.join(U('p1'), T0);
    room.start('host', T0);
    // joining during countdown is still allowed
    assert.equal(room.join(U('p2'), T0 + 1000).ok, true);
    room.advance(T0 + 60_000);
    assert.deepEqual(room.join(U('p3'), T0 + 61_000), { ok: false, error: 'entry_closed' });
  });

  test('late entrants become eligible from the next stage and cannot win earlier stages', () => {
    const c = config();
    c.payout = { structure: 'PER_STAGE', stageAwardCents: 100, finalAwardCents: 0 };
    c.entry.lateEntry = true;
    c.entry.lateEntryUntilStage = 4;
    const rng = seededRng(21);
    const room = makeRoom(c, rng);
    room.join(U('p1'), T0);
    room.start('host', T0);
    room.advance(T0 + 60_000);
    assert.equal(room.s.currentStage, 1);
    const r = room.join(U('late'), T0 + 61_000);
    assert.deepEqual(r, { ok: true, eligibleFrom: 2, already: false });
    assert.ok(!room.s.stage!.participants.includes('late'), 'not in the current stage');
    assert.equal(room.view('late', T0 + 61_000).me!.status, 'waiting');
    // Late player cannot act in stage 1.
    room.advance(T0 + 70_000);
    if (room.s.phase === 'ROUND') {
      const res = room.act('late', { stage: 1, round: room.s.stage!.game.round, action: {} }, T0 + 70_001);
      assert.deepEqual(res, { ok: false, error: 'not_in_stage' });
    }
    // Play on until stage 2 begins, then the late player is a participant.
    let now = T0 + 70_000;
    while (room.s.currentStage < 2) {
      now = room.nextDeadline()!;
      room.advance(now);
    }
    assert.ok(room.s.stage!.participants.includes('late'));
    // Cutoff: once stage 4 has started, late entry closes.
    while (room.s.currentStage < 4) {
      now = room.nextDeadline()!;
      room.advance(now);
    }
    assert.deepEqual(room.join(U('toolate'), now + 1), { ok: false, error: 'late_entry_closed' });
    playOut(room, rng);
    const lateAllocs = room.s.final!.allocations.filter((a) => a.playerId === 'late');
    for (const a of lateAllocs) assert.ok(Number(a.ref.split('-')[1]) >= 2);
  });
});

describe('submissions', () => {
  function roomAtRound(gameId: GameId) {
    const room = makeRoom(config({ manual: Array(10).fill(gameId) }));
    room.join(U('p1'), T0);
    room.join(U('p2'), T0);
    room.start('host', T0);
    room.advance(T0 + 60_000); // intro
    room.advance(room.nextDeadline()!); // round 1
    assert.equal(room.s.phase, 'ROUND');
    return room;
  }

  test('duplicate submissions rejected and logged', () => {
    const room = roomAtRound('zero-hour');
    const now = room.s.phaseStartedAt + 100;
    assert.equal(room.act('p1', { stage: 1, round: 1, action: { value: 10 } }, now).ok, true);
    assert.deepEqual(room.act('p1', { stage: 1, round: 1, action: { value: 20 } }, now + 1), { ok: false, error: 'already_submitted' });
    const subs = room.drainEvents().filter((e) => e.type === 'SUBMISSION');
    assert.deepEqual(subs.map((e) => e.data.accepted), [true, false]);
    assert.equal(subs[1].data.error, 'already_submitted');
  });

  test('late submissions rejected even before the alarm fires', () => {
    const room = roomAtRound('guess-color');
    const end = room.s.phaseEndsAt!;
    assert.deepEqual(room.act('p1', { stage: 1, round: 1, action: { color: 'red' } }, end), { ok: false, error: 'round_closed' });
    room.advance(end);
    assert.notEqual(room.s.phase, 'ROUND');
    assert.deepEqual(room.act('p2', { stage: 1, round: 1, action: { color: 'red' } }, end + 5), { ok: false, error: 'round_closed' });
  });

  test('stale stage/round numbers and non-members rejected', () => {
    const room = roomAtRound('guess-color');
    const t = room.s.phaseStartedAt + 1;
    assert.deepEqual(room.act('p1', { stage: 1, round: 2, action: { color: 'red' } }, t), { ok: false, error: 'stale_round' });
    assert.deepEqual(room.act('stranger', { stage: 1, round: 1, action: { color: 'red' } }, t), { ok: false, error: 'not_in_tournament' });
  });

  test('round closes early once everyone alive has acted', () => {
    const room = roomAtRound('suited-up');
    const t = room.s.phaseStartedAt + 10;
    for (const p of ['host', 'p1', 'p2']) room.act(p, { stage: 1, round: 1, action: { suit: 'club' } }, t);
    assert.equal(room.s.phase, 'REVEAL');
  });

  test('a disconnected player cannot extend the timer: the round ends on schedule', () => {
    const room = roomAtRound('zero-hour');
    room.setConnected('p2', false, room.s.phaseStartedAt + 1);
    const end = room.s.phaseEndsAt!;
    room.act('host', { stage: 1, round: 1, action: { value: 40 } }, end - 500);
    room.act('p1', { stage: 1, round: 1, action: { value: 41 } }, end - 400);
    room.advance(end);
    assert.equal(room.s.phase, 'REVEAL');
    const out = room.s.stage!.lastRound!.eliminated.find((e) => e.playerId === 'p2');
    assert.equal(out?.reason, 'No number submitted');
  });

  test('reconnection restores private state in the view', () => {
    const room = roomAtRound('high-low');
    room.setConnected('p1', true, room.s.phaseStartedAt);
    room.setConnected('p1', false, room.s.phaseStartedAt + 5);
    room.setConnected('p1', true, room.s.phaseStartedAt + 10);
    const v = room.view('p1', room.s.phaseStartedAt + 11);
    const mine = v.me!.private as { number: number };
    assert.ok(mine.number >= 1 && mine.number <= 100);
    // The other player's number is not in my view.
    const theirs = (room.s.stage!.game as any).hands.p2.final;
    assert.ok(!JSON.stringify(v.stage!.public).includes(`"number":${theirs}`));
    const ev = room.drainEvents().map((e) => e.type);
    assert.ok(ev.filter((t) => t === 'PLAYER_CONNECTED').length >= 2);
  });

  test('pressure break fires at its own server deadline', () => {
    const room = roomAtRound('pressure-cooker');
    const inner = room.nextDeadline()!;
    assert.ok(inner < room.s.phaseEndsAt!);
    room.act('host', { stage: 1, round: 1, action: { type: 'cashout' } }, inner - 1);
    room.advance(inner);
    assert.equal(room.s.phase, 'REVEAL');
    assert.deepEqual(room.s.stage!.lastRound!.survivors, ['host']);
  });
});

describe('full tournaments', () => {
  for (const gameId of GAME_IDS) {
    test(`10 stages of ${gameId} with 6 players complete with valid results`, () => {
      const rng = seededRng(GAME_IDS.indexOf(gameId) + 100);
      const room = makeRoom(config({ manual: Array(10).fill(gameId) }), rng);
      for (let i = 1; i <= 5; i++) room.join(U(`p${i}`), T0 + i);
      room.start('host', T0 + 10);
      playOut(room, rng);
      assert.equal(room.s.phase, 'FINISHED');
      assert.equal(room.s.stages.length, 10);
      for (const st of room.s.stages) {
        assert.equal(st.gameId, gameId);
        for (const w of st.winners) assert.ok(st.participants.includes(w));
        assert.equal(new Set(st.ranking).size, st.participants.length);
      }
      const f = room.s.final!;
      assert.equal(f.standings.length, 6);
      const total = f.allocations.reduce((s, a) => s + a.amountCents, 0);
      assert.equal(total, room.s.config.payout.stageAwardCents * 10);
      assert.ok(f.allocations.every((a) => a.status === 'COMMITTED_UNPAID' || a.status === 'UNAWARDED'));
    });
  }

  test('random lineup, hybrid payout, special awards, 12 players, mid-run forfeits', () => {
    const rng = seededRng(4242);
    const c = config({ stages: 15 });
    c.payout = { structure: 'HYBRID', stageAwardCents: 250, finalAwardCents: 10_000 };
    c.specialAwards = [
      { id: 'first', type: 'FIRST_STAGE', label: 'First Blood', amountCents: 500 },
      { id: 'iron', type: 'MOST_ROUNDS_SURVIVED', label: 'Iron Lung', amountCents: 700 },
    ];
    const room = makeRoom(c, rng);
    for (let i = 1; i <= 11; i++) room.join(U(`p${i}`), T0 + i);
    room.start('host', T0 + 20);
    let now = T0 + 20;
    // Two players forfeit after stage 3 begins.
    while (room.s.currentStage < 3) {
      now = room.nextDeadline()!;
      room.advance(now);
    }
    room.leave('p3', now);
    room.leave('p4', now);
    playOut(room, rng);
    assert.equal(room.s.phase, 'FINISHED');
    for (const st of room.s.stages.filter((x) => x.index > 3)) {
      assert.ok(!st.participants.includes('p3') && !st.participants.includes('p4'));
    }
    const f = room.s.final!;
    const committed = f.allocations.reduce((s, a) => s + a.amountCents, 0);
    assert.equal(committed, 250 * 15 + 10_000 + 500 + 700);
    const events = room.drainEvents().map((e) => e.type);
    for (const t of ['TOURNAMENT_STARTED', 'STAGE_STARTED', 'ROUND_STARTED', 'SUBMISSION', 'ROUND_RESOLVED', 'STAGE_FINISHED', 'TOURNAMENT_FINISHED', 'PLAYER_LEFT']) {
      assert.ok(events.includes(t), `event ${t} recorded`);
    }
  });

  test('state survives a JSON round-trip mid-game (Durable Object restart)', async () => {
    const rng = seededRng(77);
    const room = makeRoom(config({ manual: ['decode', 'speedrun', 'pressure-cooker', 'zero-hour', 'high-low', 'suited-up', 'guess-color', 'decode', 'speedrun', 'zero-hour'] }), rng);
    room.join(U('p1'), T0);
    room.start('host', T0);
    room.advance(T0 + 60_000);
    room.advance(room.nextDeadline()!);
    const { RoomCore } = await import('../shared/src/index');
    const revived = new RoomCore(JSON.parse(JSON.stringify(room.s)), rng);
    playOut(revived, rng);
    assert.equal(revived.s.phase, 'FINISHED');
  });
});
