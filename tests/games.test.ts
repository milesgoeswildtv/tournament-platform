import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, getGame, compareSuits, suitedScore, SUITS, pressureHundredths, decodeBoard, type Rng } from '../shared/src/index';
import { highLowVerdict } from '../shared/src/games/highLow';
import { zeroHourScaledDistance } from '../shared/src/games/zeroHour';
import { speedrunCuts, speedrunQuota, DEFAULT_SPEEDRUN_SCHEDULE } from '../shared/src/games/speedrun';
import { evaluateTask, TASK_GENERATORS, TASK_KINDS } from '../shared/src/games/speedrunTasks';
import { decodeMatches } from '../shared/src/games/decode';
import { DECODE_PUZZLES } from '../shared/src/games/decodeLibrary';

const ctx = (rng: Rng, now = 1000) => ({ rng, now, settings: { zeroHourPercent: 67 } });
/** An Rng whose int() returns scripted values in order (falls back to min). */
function scripted(values: number[]): Rng {
  let i = 0;
  return { int: (min) => (i < values.length ? values[i++] : min), float: () => 0.5 };
}

describe('Suited Up rules', () => {
  test('hierarchy: spade>diamond>club>heart>spade', () => {
    assert.equal(compareSuits('spade', 'diamond'), 1);
    assert.equal(compareSuits('diamond', 'club'), 1);
    assert.equal(compareSuits('club', 'heart'), 1);
    assert.equal(compareSuits('heart', 'spade'), 1);
    assert.equal(compareSuits('diamond', 'spade'), -1);
    assert.equal(compareSuits('heart', 'club'), -1);
  });
  test('unrelated pairs and matching suits are neutral', () => {
    assert.equal(compareSuits('spade', 'club'), 0);
    assert.equal(compareSuits('club', 'spade'), 0);
    assert.equal(compareSuits('diamond', 'heart'), 0);
    assert.equal(compareSuits('heart', 'diamond'), 0);
    for (const s of SUITS) assert.equal(compareSuits(s, s), 0);
  });
  test('exhaustive scoring table and survival threshold', () => {
    // Player spade: beats diamond, loses to heart, neutral with club.
    assert.equal(suitedScore('spade', ['diamond', 'club']), 1);
    assert.equal(suitedScore('spade', ['diamond', 'heart']), 0);
    assert.equal(suitedScore('spade', ['heart', 'club']), -1);
    assert.equal(suitedScore('spade', ['spade', 'heart']), -1);
    assert.equal(suitedScore('spade', ['spade', 'diamond']), 1);
    assert.equal(suitedScore('spade', ['spade', 'club']), 0);
    for (const p of SUITS) for (const a of SUITS) for (const b of SUITS) {
      if (a === b) continue;
      const sc = suitedScore(p, [a, b]);
      assert.ok(sc >= -1 && sc <= 1, 'score range is -1..1 with two different dealer suits');
    }
  });
  test('round: -1 eliminated, 0 and +1 survive', () => {
    const g = getGame('suited-up');
    // tiebreaks 1,2,3; dealer: first suit index 3 (heart), then rest index 1 (of spade,diamond,club → diamond)
    const rng = scripted([1, 2, 3, 3, 1]);
    let s = g.init(['a', 'b', 'c'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 30000 }, ctx(rng));
    s = (g.act(s, 'a', { suit: 'club' }, ctx(rng)) as any).state; // vs heart +1, vs diamond -1 => 0
    s = (g.act(s, 'b', { suit: 'spade' }, ctx(rng)) as any).state; // vs heart -1, vs diamond +1 => 0
    s = (g.act(s, 'c', { suit: 'diamond' }, ctx(rng)) as any).state; // vs heart 0, vs diamond 0 => 0
    const r = g.resolveRound(s, ctx(rng));
    assert.deepEqual((r.result.reveal as any).dealer, ['heart', 'diamond']);
    assert.deepEqual(r.result.eliminated, []);
    assert.equal(r.result.voided, false);
  });
  test('duplicate pick rejected', () => {
    const g = getGame('suited-up');
    const rng = seededRng(1);
    let s = g.startRound(g.init(['a'], ctx(rng)), { startedAt: 0, endsAt: 1 }, ctx(rng));
    s = (g.act(s, 'a', { suit: 'club' }, ctx(rng)) as any).state;
    assert.deepEqual(g.act(s, 'a', { suit: 'heart' }, ctx(rng)), { ok: false, error: 'already_submitted' });
    assert.deepEqual(g.act(s, 'a', { suit: 'joker' }, ctx(rng)), { ok: false, error: 'invalid_suit' });
  });
});

describe('Guess the Color', () => {
  test('correct survive, wrong eliminated, all-wrong round is void', () => {
    const g = getGame('guess-color');
    const rng = scripted([5, 6, 0 /* draw red */, 1 /* draw yellow */]);
    let s = g.init(['a', 'b'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 10 }, ctx(rng));
    s = (g.act(s, 'a', { color: 'green' }, ctx(rng)) as any).state;
    s = (g.act(s, 'b', { color: 'blue' }, ctx(rng)) as any).state;
    let r = g.resolveRound(s, ctx(rng));
    assert.equal(r.result.voided, true);
    assert.deepEqual(r.state.alive, ['a', 'b']);
    s = g.startRound(r.state, { startedAt: 20, endsAt: 30 }, ctx(rng));
    s = (g.act(s, 'a', { color: 'yellow' }, ctx(rng)) as any).state;
    r = g.resolveRound(s, ctx(rng)); // b did not pick
    assert.deepEqual(r.state.alive, ['a']);
    assert.equal(r.result.eliminated[0].reason, 'No color picked');
    assert.equal(r.state.done, true);
    assert.deepEqual(g.outcome(r.state).winners, ['a']);
  });
  test('round cap ends the stage with a shared win', () => {
    const g = getGame('guess-color');
    const rng = seededRng(3);
    let s = g.init(['a', 'b'], ctx(rng));
    for (let i = 0; i < 6; i++) {
      s = g.startRound(s, { startedAt: i * 10, endsAt: i * 10 + 9 }, ctx(rng));
      // Both miss every time → every round void.
      const r = g.resolveRound(s, ctx(rng));
      s = r.state;
    }
    assert.equal(s.done, true);
    assert.deepEqual(g.outcome(s).winners.sort(), ['a', 'b']);
  });
});

describe('Zero Hour', () => {
  test('exact integer distances and closest wins', () => {
    // values 0, 50, 100 → avg 50, target 33.5 at 67%
    assert.equal(zeroHourScaledDistance(50, 150, 3, 67), Math.abs(100 * 3 * 50 - 67 * 150));
    const g = getGame('zero-hour');
    const rng = seededRng(2);
    let s = g.init(['a', 'b', 'c', 'd'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 30000 }, ctx(rng));
    s = (g.act(s, 'a', { value: 0 }, ctx(rng, 10)) as any).state;
    s = (g.act(s, 'b', { value: 50 }, ctx(rng, 20)) as any).state;
    s = (g.act(s, 'c', { value: 100 }, ctx(rng, 30)) as any).state;
    const r = g.resolveRound(s, ctx(rng));
    const rev = r.result.reveal as any;
    assert.equal(rev.target, 33.5);
    assert.equal(rev.winner, 'b'); // |50-33.5|=16.5 < |0-33.5|=33.5
    assert.deepEqual(g.outcome(r.state).winners, ['b']);
    const d = r.result.eliminated.find((e) => e.playerId === 'd')!;
    assert.equal(d.reason, 'No number submitted');
  });
  test('tie on distance → earliest submission wins', () => {
    const g = getGame('zero-hour');
    const rng = seededRng(2);
    // percent 100, values 40 and 60 → avg 50; both 10 away
    let s = g.init(['late', 'early'], { ...ctx(rng), settings: { zeroHourPercent: 100 } });
    s = g.startRound(s, { startedAt: 0, endsAt: 30000 }, ctx(rng));
    s = (g.act(s, 'early', { value: 40 }, ctx(rng, 100)) as any).state;
    s = (g.act(s, 'late', { value: 60 }, ctx(rng, 200)) as any).state;
    const r = g.resolveRound(s, ctx(rng));
    assert.deepEqual(g.outcome(r.state).winners, ['early']);
    assert.equal(r.result.eliminated[0].reason, 'Tied on distance, submitted later');
  });
  test('submissions are private during the round', () => {
    const g = getGame('zero-hour');
    const rng = seededRng(2);
    let s = g.startRound(g.init(['a', 'b'], ctx(rng)), { startedAt: 0, endsAt: 1 }, ctx(rng));
    s = (g.act(s, 'a', { value: 77 }, ctx(rng)) as any).state;
    const pub = JSON.stringify(g.publicView(s));
    assert.ok(!pub.includes('77'), 'public view must not reveal values');
    assert.deepEqual(g.playerView(s, 'a'), { value: 77 });
    assert.deepEqual(g.playerView(s, 'b'), { value: null });
    assert.equal((g.act(s, 'a', { value: 5 }, ctx(rng)) as any).error, 'already_submitted');
    assert.equal((g.act(s, 'b', { value: 101 }, ctx(rng)) as any).error, 'invalid_number');
    assert.equal((g.act(s, 'b', { value: 4.5 }, ctx(rng)) as any).error, 'invalid_number');
  });
});

describe('Trust Yourself — High/Low', () => {
  test('verdicts including ties', () => {
    assert.deepEqual(highLowVerdict(80, 'high', 40), { pass: true });
    assert.equal(highLowVerdict(30, 'high', 40).pass, false);
    assert.deepEqual(highLowVerdict(10, 'low', 40), { pass: true });
    assert.equal(highLowVerdict(50, 'low', 40).pass, false);
    assert.equal(highLowVerdict(40, 'high', 40).pass, false);
    assert.equal(highLowVerdict(40, 'low', 40).pass, false);
    assert.equal(highLowVerdict(90, null, 40).pass, false);
  });
  test('one reroll, call locks, numbers private', () => {
    const g = getGame('high-low');
    const rng = scripted([1, 2, 10, 90, 55, 50]);
    let s = g.init(['a', 'b'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 1 }, ctx(rng)); // a=10, b=90
    assert.deepEqual(g.playerView(s, 'a'), { number: 10, first: 10, rerolled: false, call: null });
    const rr = g.act(s, 'a', { type: 'reroll' }, ctx(rng)) as any; // a → 55
    assert.equal(rr.reply.number, 55);
    s = rr.state;
    assert.equal((g.act(s, 'a', { type: 'reroll' }, ctx(rng)) as any).error, 'already_rerolled');
    s = (g.act(s, 'a', { type: 'call', side: 'high' }, ctx(rng)) as any).state;
    assert.equal((g.act(s, 'a', { type: 'call', side: 'low' }, ctx(rng)) as any).error, 'already_submitted');
    s = (g.act(s, 'b', { type: 'call', side: 'low' }, ctx(rng)) as any).state;
    assert.ok(!JSON.stringify(g.publicView(s)).includes('55'));
    const r = g.resolveRound(s, ctx(rng)); // comparison 50
    assert.equal((r.result.reveal as any).comparison, 50);
    assert.deepEqual(r.state.alive, ['a']);
  });
});

describe('Decode', () => {
  test('normalised matching and board masking', () => {
    const p = { answer: 'BREAK THE ICE', category: 'x', clues: ['a', 'b'] as [string, string] };
    assert.ok(decodeMatches(p, 'break the ice'));
    assert.ok(decodeMatches(p, '  Break-the ICE!! '));
    assert.ok(!decodeMatches(p, 'break ice cream'));
    assert.equal(decodeBoard('BREAK THE ICE', 1), 'B____ T__ I__');
    assert.equal(decodeBoard('BREAK THE ICE', 3), 'B_EA_ T_E I_E');
  });
  test('first correct by server time wins; one guess per round; clues per round', () => {
    const g = getGame('decode');
    const rng = scripted([1, 2, 3, 0]); // tiebreaks then puzzle 0
    let s = g.init(['a', 'b', 'c'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 30000 }, ctx(rng));
    assert.equal((g.publicView(s) as any).clues.length, 0);
    s = (g.act(s, 'a', { guess: 'nope' }, ctx(rng, 100)) as any).state;
    assert.equal((g.act(s, 'a', { guess: DECODE_PUZZLES[0].answer }, ctx(rng, 120)) as any).error, 'already_submitted');
    let r = g.resolveRound(s, ctx(rng));
    assert.equal(r.state.done, false);
    s = g.startRound(r.state, { startedAt: 40000, endsAt: 70000 }, ctx(rng));
    assert.equal((g.publicView(s) as any).clues.length, 1);
    s = (g.act(s, 'c', { guess: DECODE_PUZZLES[0].answer.toLowerCase() }, ctx(rng, 45000)) as any).state;
    s = (g.act(s, 'b', { guess: DECODE_PUZZLES[0].answer }, ctx(rng, 41000)) as any).state;
    r = g.resolveRound(s, ctx(rng));
    assert.equal(r.state.done, true);
    const o = g.outcome(r.state);
    assert.deepEqual(o.winners, ['b']);
    assert.deepEqual(r.result.eliminated.map((e) => e.playerId), ['a']);
    assert.equal(o.metrics.b.fastestCorrectMs, 1000);
  });
  test('unsolved after 3 rounds → no winner', () => {
    const g = getGame('decode');
    const rng = seededRng(5);
    let s = g.init(['a'], ctx(rng));
    for (let i = 0; i < 3; i++) s = g.resolveRound(g.startRound(s, { startedAt: i, endsAt: i + 1 }, ctx(rng)), ctx(rng)).state;
    assert.equal(s.done, true);
    assert.deepEqual(g.outcome(s).winners, []);
  });
});

describe('Pressure Cooker', () => {
  test('multiplier curve is monotonic and server-side', () => {
    assert.equal(pressureHundredths(0), 100);
    let prev = 0;
    for (let t = 0; t < 45000; t += 250) {
      const m = pressureHundredths(t);
      assert.ok(m >= prev);
      prev = m;
    }
  });
  test('cash out before break survives; after break rejected; highest wins; break hidden', () => {
    const g = getGame('pressure-cooker');
    const rng = scripted([1, 2, 3, 15000]); // tiebreaks, then break at +15000ms
    let s = g.init(['a', 'b', 'c'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 30000 }, ctx(rng));
    assert.equal((g.publicView(s) as any).breakAt, null, 'break point hidden during play');
    assert.equal(g.internalDeadline!(s), 15000);
    s = (g.act(s, 'a', { type: 'cashout' }, ctx(rng, 5000)) as any).state;
    s = (g.act(s, 'b', { type: 'cashout' }, ctx(rng, 14999)) as any).state;
    assert.equal((g.act(s, 'c', { type: 'cashout' }, ctx(rng, 15000)) as any).error, 'too_late');
    s = g.onInternalDeadline!(s, ctx(rng, 15000));
    assert.ok(g.roundReady(s));
    const r = g.resolveRound(s, ctx(rng));
    assert.deepEqual(g.outcome(r.state).winners, ['b']);
    assert.deepEqual(r.result.eliminated.map((e) => e.playerId), ['c']);
    assert.equal(g.outcome(r.state).metrics.b.cashout, pressureHundredths(14999) / 100);
  });
  test('everyone busts → replay, up to 3 runs', () => {
    const g = getGame('pressure-cooker');
    const rng = seededRng(9);
    let s = g.init(['a', 'b'], ctx(rng));
    for (let i = 1; i <= 3; i++) {
      s = g.startRound(s, { startedAt: i * 1e5, endsAt: i * 1e5 + 20000 }, ctx(rng));
      s = g.onInternalDeadline!(s, ctx(rng));
      const r = g.resolveRound(s, ctx(rng));
      s = r.state;
      assert.equal(r.result.voided, i < 3);
    }
    assert.equal(s.done, true);
    assert.deepEqual(g.outcome(s).winners, []);
  });
});

describe('Randomizer Speedrun', () => {
  test('every generated task has a valid answer under its own evaluator', () => {
    const rng = seededRng(11);
    for (const kind of TASK_KINDS) {
      for (let i = 0; i < 40; i++) {
        const t = TASK_GENERATORS[kind](rng);
        assert.ok(evaluateTask(t, t.answer), `${kind}: answer must evaluate correct`);
        assert.ok(!evaluateTask(t, 'zzzz-not-it'), `${kind}: junk must fail`);
        if (t.input === 'choice') assert.ok(t.options!.includes(t.answer), `${kind}: options include the answer`);
      }
    }
  });
  test('schedule bands', () => {
    const rng = seededRng(4);
    for (let r = 1; r <= 5; r++) assert.equal(speedrunQuota(r, DEFAULT_SPEEDRUN_SCHEDULE, rng), 1);
    for (let i = 0; i < 50; i++) {
      const q = speedrunQuota(7, DEFAULT_SPEEDRUN_SCHEDULE, rng);
      assert.ok(q >= 1 && q <= 2);
      const q2 = speedrunQuota(14, DEFAULT_SPEEDRUN_SCHEDULE, rng);
      assert.ok(q2 >= 1 && q2 <= 3);
    }
  });
  test('wrong and missing always cut; slowest correct fill the quota; one always survives', () => {
    assert.deepEqual(speedrunCuts(['a', 'b', 'c', 'd'], ['c', 'a', 'd'], 1), { failed: ['b'], slow: [], survivors: ['c', 'a', 'd'], voided: false });
    assert.deepEqual(speedrunCuts(['a', 'b', 'c', 'd'], ['c', 'a', 'd', 'b'], 2), { failed: [], slow: ['d', 'b'], survivors: ['c', 'a'], voided: false });
    assert.deepEqual(speedrunCuts(['a', 'b', 'c'], ['b'], 1), { failed: ['a', 'c'], slow: [], survivors: ['b'], voided: false });
    assert.deepEqual(speedrunCuts(['a', 'b'], ['a', 'b'], 3), { failed: [], slow: ['b'], survivors: ['a'], voided: false });
    assert.equal(speedrunCuts(['a', 'b'], [], 1).voided, true);
  });
  test('task answers never leak in the public view', () => {
    const g = getGame('speedrun');
    const rng = seededRng(12);
    for (let i = 0; i < 30; i++) {
      const s = g.startRound(g.init(['a', 'b'], ctx(rng)), { startedAt: 0, endsAt: 1 }, ctx(rng)) as any;
      const pub = g.publicView(s) as any;
      assert.equal(pub.task.answer, undefined);
      if (s.task.input !== 'choice') {
        const blob = JSON.stringify(pub);
        if (s.task.kind !== 'observation' && s.task.kind !== 'research') assert.ok(!blob.includes(`"${s.task.answer}"`));
      }
    }
  });
});

describe('The Flood', () => {
  test('sizes: half the players flood, capped at half the platforms', async () => {
    const { floodSizes } = await import('../shared/src/games/flood');
    assert.deepEqual(floodSizes(2), { platforms: 4, flooded: 1 });
    assert.deepEqual(floodSizes(3), { platforms: 4, flooded: 1 });
    assert.deepEqual(floodSizes(8), { platforms: 8, flooded: 4 });
    assert.deepEqual(floodSizes(9), { platforms: 9, flooded: 4 });
    assert.deepEqual(floodSizes(20), { platforms: 20, flooded: 10 });
    assert.deepEqual(floodSizes(200), { platforms: 20, flooded: 10 });
    for (let n = 1; n <= 300; n++) {
      const { platforms, flooded } = floodSizes(n);
      assert.ok(flooded >= 1 && flooded <= platforms / 2, `n=${n}`);
    }
  });
  test('flood is drawn before picks, distinct, in range, and hidden until resolve', () => {
    const g = getGame('flood');
    const rng = seededRng(11);
    let s: any = g.init(['a', 'b', 'c', 'd', 'e', 'f'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 10 }, ctx(rng));
    assert.equal(s.platforms, 6);
    assert.equal(s.flood.length, 3);
    assert.equal(new Set(s.flood).size, 3);
    assert.ok(s.flood.every((x: number) => x >= 0 && x < 6));
    const pub = JSON.stringify(g.publicView(s));
    assert.ok(!pub.includes('"flood"'), 'the drawn flood is not public');
    assert.deepEqual((g.publicView(s) as any).floods, 3);
  });
  test('wet and missing picks are out, dry survive; duplicate and invalid picks refused', () => {
    const g = getGame('flood');
    const rng = scripted([1, 2, 3, 4]); // tiebreaks
    let s: any = g.init(['a', 'b', 'c', 'd'], ctx(rng));
    s = g.startRound(s, { startedAt: 0, endsAt: 10 }, ctx(rng));
    s = { ...s, flood: [0, 1] }; // fixed for the test: platforms 1 and 2 flood
    s = (g.act(s, 'a', { platform: 0 }, ctx(rng)) as any).state;
    s = (g.act(s, 'b', { platform: 2 }, ctx(rng)) as any).state;
    s = (g.act(s, 'c', { platform: 3 }, ctx(rng)) as any).state;
    assert.deepEqual(g.act(s, 'a', { platform: 2 }, ctx(rng)), { ok: false, error: 'already_submitted' });
    assert.deepEqual(g.act(s, 'd', { platform: 4 }, ctx(rng)), { ok: false, error: 'invalid_platform' });
    assert.deepEqual(g.act(s, 'd', { platform: 1.5 }, ctx(rng)), { ok: false, error: 'invalid_platform' });
    assert.equal(g.roundReady(s), false);
    const r = g.resolveRound(s, ctx(rng));
    assert.deepEqual(r.state.alive.sort(), ['b', 'c']);
    assert.deepEqual(Object.fromEntries(r.result.eliminated.map((e) => [e.playerId, e.reason])), { a: 'Platform 1 flooded', d: 'Didn’t pick a platform' });
    assert.deepEqual((r.result.reveal as any).flooded, [0, 1]);
    assert.deepEqual((r.result.reveal as any).occupancy, [1, 0, 1, 1]);
    assert.deepEqual((g.publicView(r.state) as any).lastFlood, [0, 1], 'last tide’s flood is shown next round');
  });
  test('a previously flooded platform can be safe; everyone wet → void replay; cap → shared win', () => {
    const g = getGame('flood');
    const rng = seededRng(5);
    let s: any = g.init(['a', 'b'], ctx(rng));
    s = { ...g.startRound(s, { startedAt: 0, endsAt: 10 }, ctx(rng)), flood: [2] };
    s = (g.act(s, 'a', { platform: 2 }, ctx(rng)) as any).state;
    s = (g.act(s, 'b', { platform: 2 }, ctx(rng)) as any).state;
    let r = g.resolveRound(s, ctx(rng));
    assert.equal(r.result.voided, true);
    assert.deepEqual(r.state.alive.sort(), ['a', 'b']);
    // next tide: platform 3 (flooded last time) is dry
    s = { ...g.startRound(r.state, { startedAt: 20, endsAt: 30 }, ctx(rng)), flood: [0] };
    s = (g.act(s, 'a', { platform: 2 }, ctx(rng)) as any).state;
    s = (g.act(s, 'b', { platform: 2 }, ctx(rng)) as any).state;
    r = g.resolveRound(s, ctx(rng));
    assert.deepEqual(r.state.alive.sort(), ['a', 'b']);
    s = r.state;
    for (let i = 2; i < 10; i++) {
      s = { ...g.startRound(s, { startedAt: i * 10, endsAt: i * 10 + 9 }, ctx(rng)), flood: [0] };
      s = (g.act(s, 'a', { platform: 1 }, ctx(rng)) as any).state;
      s = (g.act(s, 'b', { platform: 3 }, ctx(rng)) as any).state;
      s = g.resolveRound(s, ctx(rng)).state;
    }
    assert.equal(s.done, true);
    assert.deepEqual(g.outcome(s).winners.sort(), ['a', 'b']);
  });
  test('last player standing wins', () => {
    const g = getGame('flood');
    const rng = seededRng(9);
    let s: any = g.init(['a', 'b', 'c'], ctx(rng));
    s = { ...g.startRound(s, { startedAt: 0, endsAt: 10 }, ctx(rng)), flood: [0] };
    s = (g.act(s, 'a', { platform: 1 }, ctx(rng)) as any).state;
    s = (g.act(s, 'b', { platform: 0 }, ctx(rng)) as any).state;
    s = (g.act(s, 'c', { platform: 0 }, ctx(rng)) as any).state;
    const r = g.resolveRound(s, ctx(rng));
    assert.equal(r.state.done, true);
    const o = g.outcome(r.state);
    assert.deepEqual(o.winners, ['a']);
    assert.equal(o.ranking[0], 'a');
  });
});
