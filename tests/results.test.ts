import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAllocations,
  computeStandings,
  evaluateAwards,
  splitCents,
  validateConfig,
  normalizeConfig,
  buildSequence,
  rollStageDurationMs,
  totalCommitmentCents,
  defaultConfig,
  seededRng,
  GAME_IDS,
  type StageRecord,
  type ResultPlayer,
} from '../shared/src/index';
import { config } from './helpers';

const players: ResultPlayer[] = [
  { id: 'a', joinOrder: 1, eligibleFrom: 1 },
  { id: 'b', joinOrder: 2, eligibleFrom: 1 },
  { id: 'c', joinOrder: 3, eligibleFrom: 3 }, // late entrant
];

function stage(index: number, winners: string[], participants = ['a', 'b'], rounds: Record<string, number> = {}): StageRecord {
  return {
    index,
    gameId: 'guess-color',
    durationMs: 20000,
    participants,
    winners,
    ranking: participants,
    metrics: Object.fromEntries(participants.map((p) => [p, { roundsSurvived: rounds[p] ?? 0 }])),
    eliminations: [],
    rounds: 1,
    summary: '',
  };
}

describe('splitCents', () => {
  test('equal split with deterministic remainder', () => {
    assert.deepEqual(splitCents(1000, ['x', 'y', 'z']), [
      { playerId: 'x', amountCents: 334 },
      { playerId: 'y', amountCents: 333 },
      { playerId: 'z', amountCents: 333 },
    ]);
    assert.equal(splitCents(1000, ['x', 'y', 'z']).reduce((s, r) => s + r.amountCents, 0), 1000);
    assert.deepEqual(splitCents(500, []), []);
  });
});

describe('standings', () => {
  test('ordered by stage wins, then outright wins, then rounds survived; equal keys share rank', () => {
    const stages = [stage(1, ['a']), stage(2, ['a', 'b']), stage(3, ['b'], ['a', 'b', 'c']), stage(4, ['c'], ['a', 'b', 'c'])];
    const s = computeStandings(players, stages);
    // a: 2 wins (1 outright), b: 2 wins (1 outright), c: 1 win
    assert.deepEqual(s.map((r) => [r.playerId, r.rank, r.stageWins, r.outrightWins]), [
      ['a', 1, 2, 1],
      ['b', 1, 2, 1],
      ['c', 3, 1, 1],
    ]);
  });
  test('rounds survived breaks a stage-win tie', () => {
    const stages = [stage(1, ['a'], ['a', 'b'], { a: 1, b: 0 }), stage(2, ['b'], ['a', 'b'], { a: 0, b: 3 })];
    const s = computeStandings(players.slice(0, 2), stages);
    assert.equal(s[0].playerId, 'b');
    assert.equal(s[0].rank, 1);
    assert.equal(s[1].rank, 2);
  });
});

describe('payout calculations', () => {
  test('PER_STAGE: each stage pays its winner; no-winner stages are unawarded; shared stages split', () => {
    const cfg = config({ stages: 10 });
    cfg.payout = { structure: 'PER_STAGE', stageAwardCents: 1000, finalAwardCents: 0 };
    const stages = Array.from({ length: 10 }, (_, i) => stage(i + 1, i === 4 ? [] : i === 5 ? ['a', 'b'] : [i % 2 ? 'b' : 'a']));
    const st = computeStandings(players.slice(0, 2), stages);
    const allocs = computeAllocations(cfg, players.slice(0, 2), stages, st, []);
    const total = (p: string | null) => allocs.filter((x) => x.playerId === p).reduce((s, x) => s + x.amountCents, 0);
    assert.equal(allocs.filter((a) => a.status === 'UNAWARDED').length, 1);
    assert.equal(total('a') + total('b'), 9000);
    assert.ok(allocs.every((a) => a.status !== ('PAID' as never)), 'nothing is ever marked paid');
    const shared = allocs.filter((a) => a.ref === 'stage-6');
    assert.deepEqual(shared.map((a) => a.amountCents), [500, 500]);
  });
  test('MOST_WINS: final award to the leader; ties split', () => {
    const cfg = config();
    cfg.payout = { structure: 'MOST_WINS', stageAwardCents: 0, finalAwardCents: 10001 };
    const stages = [stage(1, ['a']), stage(2, ['b'])];
    const st = computeStandings(players.slice(0, 2), stages);
    const allocs = computeAllocations(cfg, players.slice(0, 2), stages, st, []);
    assert.deepEqual(
      allocs.map((a) => [a.playerId, a.amountCents]),
      [
        ['a', 5001],
        ['b', 5000],
      ],
    );
    assert.ok(allocs.every((a) => a.kind === 'FINAL'));
  });
  test('HYBRID: stage awards plus final award', () => {
    const cfg = config({ stages: 10 });
    cfg.payout = { structure: 'HYBRID', stageAwardCents: 200, finalAwardCents: 5000 };
    const stages = Array.from({ length: 10 }, (_, i) => stage(i + 1, [i < 7 ? 'a' : 'b']));
    const st = computeStandings(players.slice(0, 2), stages);
    const allocs = computeAllocations(cfg, players.slice(0, 2), stages, st, []);
    const sum = (p: string) => allocs.filter((x) => x.playerId === p).reduce((s, x) => s + x.amountCents, 0);
    assert.equal(sum('a'), 7 * 200 + 5000);
    assert.equal(sum('b'), 3 * 200);
  });
  test('late entrants cannot receive awards for stages before eligibility', () => {
    const cfg = config({ stages: 10 });
    cfg.payout = { structure: 'PER_STAGE', stageAwardCents: 100, finalAwardCents: 0 };
    // Corrupt record claims c won stage 2 (before eligibility at stage 3). Must not be paid.
    const stages = [stage(1, ['a']), stage(2, ['c'], ['a', 'b', 'c']), stage(3, ['c'], ['a', 'b', 'c'])];
    const allocs = computeAllocations(cfg, players, stages, computeStandings(players, stages), []);
    const s2 = allocs.filter((a) => a.ref === 'stage-2');
    assert.equal(s2.length, 1);
    assert.equal(s2[0].status, 'UNAWARDED');
    assert.equal(allocs.find((a) => a.ref === 'stage-3')!.playerId, 'c');
  });
  test('deterministic: same inputs produce identical allocations', () => {
    const cfg = config({ stages: 10 });
    const stages = Array.from({ length: 10 }, (_, i) => stage(i + 1, i % 3 === 0 ? ['a', 'b'] : ['b']));
    const run = () => JSON.stringify(computeAllocations(cfg, players.slice(0, 2), stages, computeStandings(players.slice(0, 2), stages), []));
    assert.equal(run(), run());
  });
  test('special awards: criteria evaluated from stage records, ties split', () => {
    const cfg = config({ stages: 10 });
    cfg.specialAwards = [
      { id: 'fb', type: 'FIRST_STAGE', label: 'First Blood', amountCents: 300 },
      { id: 'nerve', type: 'HIGHEST_CASHOUT', label: 'Nerve', amountCents: 1000 },
      { id: 'iron', type: 'MOST_ROUNDS_SURVIVED', label: 'Iron', amountCents: 501 },
    ];
    const s1 = stage(1, ['b'], ['a', 'b'], { a: 2, b: 2 });
    s1.metrics.a.cashout = 3.1;
    s1.metrics.b.cashout = 2.4;
    const stages = [s1];
    const st = computeStandings(players.slice(0, 2), stages);
    const aw = evaluateAwards(cfg.specialAwards, stages, st, players.slice(0, 2));
    assert.deepEqual(aw.map((a) => a.winners), [['b'], ['a'], ['a', 'b']]);
    const allocs = computeAllocations(cfg, players.slice(0, 2), stages, st, aw).filter((a) => a.kind === 'SPECIAL');
    assert.deepEqual(allocs.map((a) => [a.ref, a.playerId, a.amountCents]), [
      ['fb', 'b', 300],
      ['nerve', 'a', 1000],
      ['iron', 'a', 251],
      ['iron', 'b', 250],
    ]);
  });
});

describe('config validation and sequencing', () => {
  test('defaults with a title validate', () => {
    assert.deepEqual(validateConfig(config()), []);
  });
  test('stage bounds, timer bounds and ordering', () => {
    const bad = (o: object) => validateConfig(normalizeConfig({ ...config(), ...o })).map((e) => e.field);
    assert.ok(bad({ stages: 9 }).includes('stages'));
    assert.ok(bad({ stages: 26 }).includes('stages'));
    assert.ok(bad({ timer: { minSeconds: 14, maxSeconds: 30 } }).includes('timer.minSeconds'));
    assert.ok(bad({ timer: { minSeconds: 20, maxSeconds: 46 } }).includes('timer.maxSeconds'));
    assert.ok(bad({ timer: { minSeconds: 40, maxSeconds: 20 } }).includes('timer.maxSeconds'));
    assert.ok(bad({ title: 'x' }).includes('title'));
  });
  test('late entry only with PER_STAGE', () => {
    const c = config();
    c.payout = { structure: 'HYBRID', stageAwardCents: 100, finalAwardCents: 100 };
    c.entry.lateEntry = true;
    c.entry.lateEntryUntilStage = 5;
    assert.ok(validateConfig(c).some((e) => e.field === 'entry.lateEntry'));
    // normalizeConfig strips it.
    assert.equal(normalizeConfig(c).entry.lateEntry, false);
  });
  test('manual selection requires exactly one game per stage', () => {
    const c = config({ manual: ['decode', 'decode', 'decode', 'decode', 'decode', 'decode', 'decode', 'decode', 'decode', 'decode'] });
    assert.deepEqual(validateConfig(c), []);
    c.games.manual = c.games.manual.slice(0, 9);
    assert.ok(validateConfig(c).some((e) => e.field === 'games.manual'));
    c.games.manual = [...c.games.manual, 'bogus' as never];
    assert.ok(validateConfig(c).some((e) => e.field === 'games.manual'));
  });
  test('award requiring a game absent from the lineup is rejected', () => {
    const c = config({ manual: Array(10).fill('decode') });
    c.specialAwards = [{ id: 'x', type: 'HIGHEST_CASHOUT', label: 'Nerve', amountCents: 100 }];
    assert.ok(validateConfig(c).some((e) => e.field === 'specialAwards.0'));
  });
  test('random sequences: right length, every pool game, no back-to-back repeats', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const c = config({ stages: 10 + (seed % 16) });
      c.games.pool = GAME_IDS.slice(0, 2 + (seed % 6));
      const seq = buildSequence(c, rng);
      assert.equal(seq.length, c.stages);
      for (const g of c.games.pool) assert.ok(seq.includes(g), `pool game ${g} used`);
      for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `seed ${seed}: repeat at ${i}`);
      assert.ok(seq.every((g) => c.games.pool.includes(g)));
    }
  });
  test('single-game pool fills every stage', () => {
    const c = config();
    c.games.pool = ['zero-hour'];
    assert.deepEqual(buildSequence(c, seededRng(1)), Array(10).fill('zero-hour'));
  });
  test('stage timer is drawn within the configured whole-second range', () => {
    const c = config();
    c.timer = { minSeconds: 15, maxSeconds: 17 };
    const seen = new Set<number>();
    const rng = seededRng(99);
    for (let i = 0; i < 200; i++) {
      const ms = rollStageDurationMs(c, rng);
      assert.ok(ms >= 15000 && ms <= 17000 && ms % 1000 === 0);
      seen.add(ms);
    }
    assert.deepEqual([...seen].sort(), [15000, 16000, 17000]);
  });
  test('total commitment adds stage, final and special amounts', () => {
    const c = defaultConfig();
    c.payout = { structure: 'HYBRID', stageAwardCents: 100, finalAwardCents: 1000 };
    c.stages = 12;
    c.specialAwards = [{ id: 'a', type: 'FIRST_STAGE', label: 'x', amountCents: 50 }];
    assert.equal(totalCommitmentCents(c), 1200 + 1000 + 50);
  });
});
