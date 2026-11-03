/**
 * Multiplayer integration tests: real Worker + Durable Object code running on
 * the local runtime (dev/runtime.ts), driven over HTTP and websockets exactly
 * like browsers. Room timers are scaled down (TIME_SCALE) so whole
 * tournaments finish in seconds; production always runs at scale 1.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, type DevServer } from '../dev/server';
import { Client, sleep, tournamentConfig } from './support/client';
import { autoplay } from './support/bots';
import { GAME_IDS, totalCommitmentCents, type RoomView } from '../shared/src/index';

const SCALE = 0.03;
let server: DevServer;
let n = 0;
const handle = (p: string) => `${p}${++n}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);
const peek = (tid: string) => () => (server.env.ROOMS.states.get(tid)?.storage as any)?.snapshot()?.room;
const db = () => server.env.DB;

before(async () => {
  server = await startDevServer({ quiet: true, staticDir: null, timeScale: SCALE, adminHandles: 'auditor' });
});
after(async () => {
  await server.close();
});

async function create(sponsor: Client, cfg = tournamentConfig()) {
  const r = await sponsor.api('POST', '/api/tournaments', { config: cfg });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data as { id: string; invite: { code: string; link: string; expiresAt: number; maxUses: number } };
}

async function join(c: Client, code: string) {
  return c.api('POST', '/api/join', { code });
}

const samePlayers = (a: RoomView, b: RoomView) => JSON.stringify(a.players.map((p) => p.id)) === JSON.stringify(b.players.map((p) => p.id));

describe('accounts', () => {
  test('register, login, profile, logout invalidates the token', async () => {
    const h = handle('acct');
    const c = await Client.register(server.url, h, 'Account One');
    assert.match(c.user.tag, /^[A-Z2-9]{6}$/);
    const me = await c.api('GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, 'Account One');

    const dup = await c.api('POST', '/api/auth/register', { handle: h, password: 'whatever-123', displayName: 'Dup' });
    assert.equal(dup.status, 409);

    const bad = await new Client(server.url, h).api('POST', '/api/auth/login', { handle: h, password: 'wrong-password' });
    assert.equal(bad.status, 401);

    const fresh = new Client(server.url, h);
    const ok = await fresh.api('POST', '/api/auth/login', { handle: h, password: 'correct-horse-9' });
    assert.equal(ok.status, 200);
    fresh.token = ok.data.token;

    const rename = await fresh.api('PATCH', '/api/me', { displayName: 'Renamed' });
    assert.equal(rename.data.user.name, 'Renamed');

    assert.equal((await fresh.api('POST', '/api/auth/logout')).status, 200);
    assert.equal((await fresh.api('GET', '/api/me')).status, 401);
    assert.equal((await c.api('GET', '/api/me')).status, 200, 'other sessions unaffected');
  });

  test('unauthenticated access is refused and Telegram sign-in reports unconfigured', async () => {
    const anon = new Client(server.url, 'anon');
    assert.equal((await anon.api('GET', '/api/me')).status, 401);
    assert.equal((await anon.api('POST', '/api/tournaments', { config: tournamentConfig() })).status, 401);
    const tg = await anon.api('POST', '/api/auth/telegram', { initData: 'user=%7B%22id%22%3A1%7D&hash=abc' });
    assert.equal(tg.status, 503);
  });

  test('input validation on registration', async () => {
    const anon = new Client(server.url, 'v');
    assert.equal((await anon.api('POST', '/api/auth/register', { handle: 'no spaces!', password: 'longenough1' })).status, 400);
    assert.equal((await anon.api('POST', '/api/auth/register', { handle: handle('short'), password: 'short' })).status, 400);
  });
});

describe('final acceptance: complete multiplayer tournament', () => {
  test('sponsor + 3 players, every game, hybrid payout and special awards, lobby → final results', async () => {
    const sponsor = await Client.register(server.url, handle('sponsor'), 'Sponsor');
    const players = await Promise.all(['p1', 'p2', 'p3'].map((p) => Client.register(server.url, handle(p), p.toUpperCase())));
    // Every game at least once, padded to the 10-stage minimum.
    const manual = [...GAME_IDS] as typeof GAME_IDS[number][];
    for (const g of ['guess-color', 'zero-hour', 'suited-up'] as const) if (manual.length < 10) manual.push(g);
    const cfg = tournamentConfig({
      title: 'Acceptance Run',
      manual,
      payout: { structure: 'HYBRID', stageAwardCents: 250, finalAwardCents: 1000 },
      specialAwards: [
        { id: 'a1', type: 'FIRST_STAGE', label: 'First Blood', amountCents: 100 },
        { id: 'a2', type: 'HIGHEST_CASHOUT', label: 'Nerve', amountCents: 300 },
        { id: 'a3', type: 'MOST_ROUNDS_SURVIVED', label: 'Iron Lung', amountCents: 200 },
      ],
      timer: { minSeconds: 15, maxSeconds: 30 },
    });
    const t = await create(sponsor, cfg);

    // Invite preview works without joining.
    const peekInv = await players[0].api('GET', `/api/invites/${t.invite.code}`);
    assert.equal(peekInv.data.valid, true);
    assert.equal(peekInv.data.tournament.title, 'Acceptance Run');

    for (const p of players) {
      const j = await join(p, t.invite.code);
      assert.equal(j.status, 200, JSON.stringify(j.data));
      assert.equal(j.data.eligibleFrom, 1);
    }
    const all = [sponsor, ...players];
    await Promise.all(all.map((c) => c.connect(t.id)));
    await Promise.all(all.map((c) => c.waitFor((v) => v.players.length === 4, 3000, '4 players')));
    for (const c of all) assert.ok(samePlayers(c.view!, sponsor.view!), 'everyone sees the same player list');
    assert.equal(sponsor.view!.players.find((p) => p.id === sponsor.user.id)!.role, 'HOST');

    // Only the sponsor can start.
    players[0].send({ t: 'start' });
    await players[0].waitForError('not_sponsor');
    assert.equal(sponsor.view!.phase, 'LOBBY');

    const stops = all.map((c, i) => autoplay(c, { peek: peek(t.id), skill: [0.9, 0.6, 0.4, 0.2][i] }));
    sponsor.send({ t: 'start' });
    const cds = await Promise.all(all.map((c) => c.waitFor((v) => v.phase === 'COUNTDOWN', 3000, 'countdown')));
    assert.equal(new Set(cds.map((v) => v.phaseEndsAt)).size, 1, 'one shared server deadline');
    assert.ok(Math.abs(cds[0].phaseEndsAt! - cds[0].serverNow - 60_000 * SCALE) < 200);

    await Promise.all(all.map((c) => c.waitFor((v) => v.phase === 'STAGE_INTRO' && v.currentStage === 1, 5000, 'stage 1')));
    const finals = await Promise.all(all.map((c) => c.waitFor((v) => v.phase === 'FINISHED', 120_000, 'finish')));
    stops.forEach((s) => s());

    const f = finals[0].final!;
    assert.ok(f, 'final results in view');
    assert.equal(finals[0].results.length, manual.length);
    for (const v of finals) assert.deepEqual(v.final, f, 'everyone gets identical results');
    assert.equal(f.standings.length, 4);
    const committed = totalCommitmentCents(cfg);
    assert.equal(f.allocations.reduce((s, a) => s + a.amountCents, 0), committed, 'allocations account for every committed cent');
    assert.ok(f.allocations.every((a) => a.status === 'COMMITTED_UNPAID' || a.status === 'UNAWARDED'), 'nothing is marked paid');

    await sleep(100);
    // Persisted: results endpoint, history, standings, audit trail.
    const res = await players[1].api('GET', `/api/tournaments/${t.id}/results`);
    assert.equal(res.status, 200);
    assert.equal(res.data.tournament.status, 'FINISHED');
    assert.equal(res.data.standings.length, 4);
    assert.equal(res.data.stages.length, manual.length);
    assert.equal(res.data.allocations.reduce((s: number, a: any) => s + a.amount_cents, 0), committed);

    const hist = await players[1].api('GET', '/api/tournaments?scope=mine');
    const row = hist.data.tournaments.find((x: any) => x.id === t.id);
    assert.ok(row && row.status === 'FINISHED' && row.myRank >= 1, 'tournament history saved for the player');

    const me = await players[0].api('GET', '/api/me');
    assert.equal(me.data.stats.tournamentsPlayed, 1);

    const lb = await players[0].api('GET', '/api/leaderboard?metric=stage_wins');
    assert.ok(lb.data.rows.length >= 1);

    assert.equal((await players[0].api('GET', `/api/tournaments/${t.id}/audit`)).status, 403, 'players cannot read the audit log');
    const audit = await sponsor.api('GET', `/api/tournaments/${t.id}/audit`);
    assert.equal(audit.status, 200);
    const seqs = audit.data.events.map((e: any) => e.seq);
    assert.deepEqual(seqs, seqs.map((_: number, i: number) => i + 1), 'event log is gapless');
    const types = new Set(audit.data.events.map((e: any) => e.type));
    for (const ty of ['TOURNAMENT_CREATED', 'PLAYER_JOINED', 'COUNTDOWN_STARTED', 'TOURNAMENT_STARTED', 'STAGE_STARTED', 'ROUND_STARTED', 'SUBMISSION', 'ROUND_RESOLVED', 'STAGE_FINISHED', 'TOURNAMENT_FINISHED']) {
      assert.ok(types.has(ty), `audit has ${ty}`);
    }
    assert.ok(audit.data.submissions.length > 10);
    assert.ok(audit.data.submissions.every((s: any) => typeof s.received_at === 'number'));
    assert.ok(audit.data.eliminations.every((e: any) => e.reason.length > 0));
    assert.equal(audit.data.configHistory.length, 1);

    // Immutable audit rows.
    assert.throws(() => db().db.exec(`UPDATE tournament_events SET type = 'X' WHERE tournament_id = '${t.id}'`), /append-only/);
    assert.throws(() => db().db.exec(`DELETE FROM submissions WHERE tournament_id = '${t.id}'`), /append-only/);

    // Stage results can be reconstructed from events alone.
    const finishedEvents = audit.data.events.filter((e: any) => e.type === 'STAGE_FINISHED').map((e: any) => e.payload.winners);
    assert.deepEqual(finishedEvents, res.data.stages.map((s: any) => s.winners));

    // In-app notification for the finish.
    const notes = await players[2].api('GET', '/api/me/notifications');
    assert.ok(notes.data.notifications.some((n: any) => n.kind === 'finished'));
    await Promise.all(all.map((c) => c.disconnect()));
  });
});

describe('invites', () => {
  test('use limits, expiry, regeneration revokes the old code', async () => {
    const sponsor = await Client.register(server.url, handle('inv'));
    const cfg = tournamentConfig({ invite: { expiresInHours: 1, maxUses: 2 } });
    const t = await create(sponsor, cfg);
    const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map((x) => Client.register(server.url, handle(`i${x}`))));
    assert.equal((await join(a, t.invite.code)).status, 200);
    assert.equal((await join(a, t.invite.code)).data.already, true, 'rejoin does not consume a use');
    assert.equal((await join(b, t.invite.code)).status, 200);
    const third = await join(c, t.invite.code);
    assert.equal(third.status, 410);
    assert.equal(third.data.error, 'invite_used_up');

    // Only the sponsor can regenerate.
    assert.equal((await a.api('POST', `/api/tournaments/${t.id}/invite`)).status, 403);
    const regen = await sponsor.api('POST', `/api/tournaments/${t.id}/invite`);
    assert.equal(regen.status, 200);
    const code2 = regen.data.invite.code;
    assert.notEqual(code2, t.invite.code);
    const old = await join(c, t.invite.code);
    assert.equal(old.data.error, 'invite_revoked');
    assert.equal((await join(c, code2)).status, 200);

    // Expiry.
    db().db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1, code2);
    const exp = await join(d, code2);
    assert.equal(exp.status, 410);
    assert.equal(exp.data.error, 'invite_expired');
    const info = await d.api('GET', `/api/invites/${code2}`);
    assert.equal(info.data.valid, false);
    assert.equal(info.data.reason, 'invite_expired');
    assert.equal((await join(d, 'NOPE2345')).status, 404);
  });

  test('private tournaments need a code; public ones are listed and joinable', async () => {
    const sponsor = await Client.register(server.url, handle('pub'));
    const priv = await create(sponsor, tournamentConfig({ title: 'Private one' }));
    const pub = await create(sponsor, tournamentConfig({ title: 'Public one', entry: { ...tournamentConfig().entry, visibility: 'PUBLIC' } }));
    const x = await Client.register(server.url, handle('px'));
    assert.equal((await x.api('POST', '/api/join', { tournamentId: priv.id })).status, 403);
    assert.equal((await x.api('GET', `/api/tournaments/${priv.id}`)).status, 403);
    const list = await x.api('GET', '/api/tournaments?scope=public');
    assert.ok(list.data.tournaments.some((t: any) => t.id === pub.id));
    assert.ok(!list.data.tournaments.some((t: any) => t.id === priv.id));
    assert.equal((await x.api('POST', '/api/join', { tournamentId: pub.id })).status, 200);
  });

  test('player cap is enforced by the room', async () => {
    const sponsor = await Client.register(server.url, handle('cap'));
    const t = await create(sponsor, tournamentConfig({ entry: { ...tournamentConfig().entry, maxPlayers: 2 } }));
    const [a, b] = await Promise.all(['a', 'b'].map((x) => Client.register(server.url, handle(`c${x}`))));
    assert.equal((await join(a, t.invite.code)).status, 200);
    const full = await join(b, t.invite.code);
    assert.equal(full.status, 409);
    assert.equal(full.data.error, 'tournament_full');
    const inv = await sponsor.api('GET', `/api/tournaments/${t.id}/invite`);
    assert.equal(inv.data.invite.uses, 1, 'refused join returned its invite use');
  });
});

describe('sponsor controls and lifecycle', () => {
  test('config edits are versioned in the lobby and locked after start; countdown abort; cancel', async () => {
    const sponsor = await Client.register(server.url, handle('cfg'));
    const p = await Client.register(server.url, handle('cfgp'));
    const cfg = tournamentConfig();
    const t = await create(sponsor, cfg);
    await join(p, t.invite.code);
    assert.equal((await p.api('PATCH', `/api/tournaments/${t.id}/config`, { config: { ...cfg, title: 'Hijack' } })).status, 403);
    const bad = await sponsor.api('PATCH', `/api/tournaments/${t.id}/config`, { config: { ...cfg, stages: 30 } });
    assert.equal(bad.status, 400);
    const ok = await sponsor.api('PATCH', `/api/tournaments/${t.id}/config`, { config: { ...cfg, title: 'Renamed Night', stages: 12 } });
    assert.equal(ok.status, 200);
    await Promise.all([sponsor.connect(t.id), p.connect(t.id)]);
    assert.equal(sponsor.view!.title, 'Renamed Night');
    assert.equal(sponsor.view!.totalStages, 12);

    sponsor.send({ t: 'start' });
    await p.waitFor((v) => v.phase === 'COUNTDOWN');
    const locked = await sponsor.api('PATCH', `/api/tournaments/${t.id}/config`, { config: { ...cfg, title: 'Too late' } });
    assert.equal(locked.status, 409);
    p.send({ t: 'abort' });
    await p.waitForError('not_sponsor');
    sponsor.send({ t: 'abort' });
    await p.waitFor((v) => v.phase === 'LOBBY');
    sponsor.send({ t: 'cancel' });
    await p.waitFor((v) => v.phase === 'CANCELED');
    await sleep(50);
    const audit = await sponsor.api('GET', `/api/tournaments/${t.id}/audit`);
    assert.equal(audit.data.configHistory.length, 2, 'every saved configuration is kept');
    assert.equal(audit.data.tournament.status, 'CANCELED');
    const notes = await p.api('GET', '/api/me/notifications');
    assert.ok(notes.data.notifications.some((x: any) => x.kind === 'closed'));
    await Promise.all([sponsor.disconnect(), p.disconnect()]);
  });

  test('sponsor disconnecting during the countdown and run does not stop or corrupt the tournament', async () => {
    const sponsor = await Client.register(server.url, handle('dc'));
    const [a, b] = await Promise.all(['a', 'b'].map((x) => Client.register(server.url, handle(`dc${x}`))));
    const cfg = tournamentConfig({ manual: Array(10).fill('suited-up'), entry: { ...tournamentConfig().entry, hostCompetes: false } });
    const t = await create(sponsor, cfg);
    await join(a, t.invite.code);
    await join(b, t.invite.code);
    await Promise.all([sponsor, a, b].map((c) => c.connect(t.id)));
    const stops = [a, b].map((c) => autoplay(c));
    sponsor.send({ t: 'start' });
    await a.waitFor((v) => v.phase === 'COUNTDOWN');
    await sponsor.disconnect();
    await a.waitFor((v) => v.players.find((p) => p.role === 'HOST')!.connected === false);
    const end = await a.waitFor((v) => v.phase === 'FINISHED', 90_000, 'finish without host');
    stops.forEach((s) => s());
    assert.equal(end.final!.standings.length, 2, 'non-competing host is not ranked');
    // The sponsor can come back and see the final state.
    const back = await sponsor.connect(t.id);
    assert.equal(back.phase, 'FINISHED');
    await sleep(50);
    const audit = await sponsor.api('GET', `/api/tournaments/${t.id}/audit`);
    assert.ok(audit.data.disconnections.some((d: any) => d.type === 'PLAYER_DISCONNECTED' && d.actor_id === sponsor.user.id));
    await Promise.all([sponsor, a, b].map((c) => c.disconnect()));
  });

  test('the room survives a Durable Object restart mid-tournament', async () => {
    const sponsor = await Client.register(server.url, handle('ev'));
    const a = await Client.register(server.url, handle('eva'));
    const t = await create(sponsor, tournamentConfig({ manual: Array(10).fill('guess-color') }));
    await join(a, t.invite.code);
    await Promise.all([sponsor.connect(t.id), a.connect(t.id)]);
    const stops = [sponsor, a].map((c) => autoplay(c));
    sponsor.send({ t: 'start' });
    await a.waitFor((v) => v.currentStage >= 3, 60_000, 'stage 3');
    server.env.ROOMS.evict(t.id);
    const end = await a.waitFor((v) => v.phase === 'FINISHED', 90_000, 'finish after restart');
    stops.forEach((s) => s());
    assert.equal(end.results.length, 10);
    await sleep(50);
    const audit = await sponsor.api('GET', `/api/tournaments/${t.id}/audit`);
    const seqs = audit.data.events.map((e: any) => e.seq);
    assert.deepEqual(seqs, seqs.map((_: number, i: number) => i + 1), 'no gaps or duplicates across the restart');
    await Promise.all([sponsor.disconnect(), a.disconnect()]);
  });
});

describe('gameplay integrity over the wire', () => {
  test('duplicate, late and stale submissions are rejected; disconnected players cannot stall a round; reconnect restores state', async () => {
    const sponsor = await Client.register(server.url, handle('int'));
    const [a, b] = await Promise.all(['a', 'b'].map((x) => Client.register(server.url, handle(`int${x}`))));
    const cfg = tournamentConfig({ manual: Array(10).fill('guess-color'), timer: { minSeconds: 45, maxSeconds: 45 } });
    const t = await create(sponsor, cfg);
    await join(a, t.invite.code);
    await join(b, t.invite.code);
    await Promise.all([sponsor, a, b].map((c) => c.connect(t.id)));
    sponsor.send({ t: 'start' });
    const v = await a.waitFor((x) => x.phase === 'ROUND', 10_000, 'round 1');
    const st = v.stage!;
    a.send({ t: 'act', stage: st.index, round: st.round, action: { color: 'purple' } });
    await a.waitForError('invalid_color');
    a.send({ t: 'act', stage: st.index, round: st.round, action: { color: 'red' } });
    await a.waitFor((x) => !!x.me?.submitted);
    a.send({ t: 'act', stage: st.index, round: st.round, action: { color: 'blue' } });
    await a.waitForError('already_submitted');
    a.send({ t: 'act', stage: st.index, round: st.round + 5, action: { color: 'red' } });
    await a.waitForError('stale_round');

    // b drops mid-round without acting; the round must still close on the server's schedule.
    await b.disconnect();
    const closed = await a.waitFor((x) => x.phase === 'REVEAL', 5000, 'reveal on schedule');
    assert.ok(closed.phaseStartedAt >= st.roundEndsAt - 5 || closed.stage!.lastRound, 'closed at/after the deadline');
    sponsor.send({ t: 'act', stage: st.index, round: st.round, action: { color: 'red' } });
    await sponsor.waitForError('round_closed');

    const back = await b.connect(t.id);
    assert.ok(['REVEAL', 'STAGE_RESULT', 'STAGE_INTRO', 'ROUND'].includes(back.phase));
    assert.ok(back.me && back.me.id === b.user.id);
    const missed = back.stage?.lastRound?.eliminated.find((e) => e.playerId === b.user.id);
    if (back.phase === 'REVEAL' && back.stage?.lastRound && !back.stage.lastRound.voided) {
      assert.ok(missed, 'missing submission eliminated');
      assert.equal(missed!.reason, 'No color picked');
    }
    await sleep(50);
    const subs = db().db.prepare('SELECT accepted, reject_reason FROM submissions WHERE tournament_id = ?').all(t.id) as any[];
    assert.ok(subs.some((s) => s.reject_reason === 'already_submitted'));
    assert.ok(subs.some((s) => s.reject_reason === 'round_closed'));
    assert.equal(subs.filter((s) => s.accepted === 1).length, 1);
    sponsor.send({ t: 'cancel' });
    await sponsor.waitForError('already_started');
    await Promise.all([sponsor, a, b].map((c) => c.disconnect()));
  });

  test('late entry: eligible from the next stage, refused after the cutoff, absent without late entry', async () => {
    const sponsor = await Client.register(server.url, handle('late'));
    const [a, l1, l2] = await Promise.all(['a', 'l1', 'l2'].map((x) => Client.register(server.url, handle(`le${x}`))));
    const cfg = tournamentConfig({
      manual: Array(10).fill('zero-hour'),
      payout: { structure: 'PER_STAGE', stageAwardCents: 100, finalAwardCents: 0 },
      entry: { ...tournamentConfig().entry, lateEntry: true, lateEntryUntilStage: 3 },
    });
    const t = await create(sponsor, cfg);
    await join(a, t.invite.code);
    await Promise.all([sponsor.connect(t.id), a.connect(t.id)]);
    const stops = [sponsor, a].map((c) => autoplay(c));
    sponsor.send({ t: 'start' });
    await a.waitFor((v) => v.currentStage === 1 && v.phase === 'ROUND', 10_000);
    const lj = await join(l1, t.invite.code);
    assert.equal(lj.status, 200);
    assert.equal(lj.data.eligibleFrom, 2);
    await l1.connect(t.id);
    assert.equal(l1.view!.me!.status, 'waiting');
    const stop3 = autoplay(l1);
    await a.waitFor((v) => v.currentStage >= 3, 60_000, 'stage 3');
    const refused = await join(l2, t.invite.code);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'late_entry_closed');
    const end = await a.waitFor((v) => v.phase === 'FINISHED', 90_000);
    [...stops, stop3].forEach((s) => s());
    assert.ok(!end.results[0].winners.includes(l1.user.id), 'late entrant cannot win stage 1');
    const stage1 = end.final!.allocations.find((x) => x.ref === 'stage-1');
    assert.notEqual(stage1?.playerId, l1.user.id);

    // No late entry configured → entry closes at the start.
    const s2 = await create(sponsor, tournamentConfig({ manual: Array(10).fill('zero-hour') }));
    await join(a, s2.invite.code);
    await Promise.all([sponsor.connect(s2.id), a.connect(s2.id)]);
    sponsor.send({ t: 'start' });
    await a.waitFor((v) => v.phase === 'STAGE_INTRO' || v.phase === 'ROUND', 10_000);
    const closed = await join(l2, s2.invite.code);
    assert.equal(closed.data.error, 'entry_closed');
    await Promise.all([sponsor, a, l1].map((c) => c.disconnect()));
  });

  test('each game resolves correctly with simultaneous players', async () => {
    for (const gameId of GAME_IDS) {
      const sponsor = await Client.register(server.url, handle('g'));
      const ps = await Promise.all([1, 2, 3, 4, 5].map((i) => Client.register(server.url, handle(`g${i}`))));
      const t = await create(sponsor, tournamentConfig({ manual: Array(10).fill(gameId), title: `Only ${gameId}` }));
      await Promise.all(ps.map((p) => join(p, t.invite.code)));
      const all = [sponsor, ...ps];
      await Promise.all(all.map((c) => c.connect(t.id)));
      const stops = all.map((c, i) => autoplay(c, { peek: peek(t.id), skill: 0.3 + i * 0.1, skipRate: i === 5 ? 0.3 : 0 }));
      sponsor.send({ t: 'start' });
      const end = await sponsor.waitFor((v) => v.phase === 'FINISHED', 180_000, `${gameId} finish`);
      stops.forEach((s) => s());
      assert.equal(end.results.length, 10, gameId);
      for (const r of end.results) {
        assert.equal(r.gameId, gameId);
        assert.ok(r.winners.length <= 6);
      }
      assert.equal(end.final!.standings.length, 6);
      await Promise.all(all.map((c) => c.disconnect()));
    }
  });
});

describe('rate limiting', () => {
  test('repeated failed logins are throttled', async () => {
    const h = handle('rl');
    await Client.register(server.url, h);
    const c = new Client(server.url, h);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.api('POST', '/api/auth/login', { handle: h, password: 'nope-nope' })).status;
    assert.equal(last, 429);
  });

  test('websocket message flood is throttled', async () => {
    const sponsor = await Client.register(server.url, handle('fl'));
    const t = await create(sponsor);
    await sponsor.connect(t.id);
    for (let i = 0; i < 40; i++) sponsor.send({ t: 'ping', at: i });
    await sponsor.waitForError('rate_limited');
    await sponsor.disconnect();
  });
});

describe('Telegram (server configured with a bot token)', () => {
  const TOKEN = '777000:integration-test-token';
  let tg: DevServer;
  const sign = async (fields: Record<string, string>) => {
    const { createHmac } = await import('node:crypto');
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
  };
  before(async () => {
    tg = await startDevServer({ quiet: true, staticDir: null, timeScale: SCALE, extraEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: 'hook-secret-123', TELEGRAM_BOT_USERNAME: 'shyst_test_bot' } });
  });
  after(async () => {
    await tg.close();
  });

  test('Mini App sign-in: signed initData creates one account per Telegram user; forged data is refused', async () => {
    const anon = new Client(tg.url, 'tg');
    const now = Math.floor(Date.now() / 1000);
    const initData = await sign({ user: JSON.stringify({ id: 5150, first_name: 'Rae', username: 'rae' }), auth_date: String(now), start_param: 'ABCD2345' });
    const r1 = await anon.api('POST', '/api/auth/telegram', { initData });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    assert.equal(r1.data.user.name, 'Rae');
    assert.equal(r1.data.user.telegram, true);
    assert.equal(r1.data.startParam, 'ABCD2345');
    const r2 = await anon.api('POST', '/api/auth/telegram', { initData });
    assert.equal(r2.data.user.id, r1.data.user.id, 'same Telegram user → same account');

    const forged = initData.replace('5150', '5151');
    assert.equal((await anon.api('POST', '/api/auth/telegram', { initData: forged })).status, 401);
    assert.equal((await anon.api('POST', '/api/auth/telegram', { initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=00' })).status, 401);
  });

  test('a signed-in browser account gets Telegram linked when it opens the Mini App', async () => {
    const c = await Client.register(tg.url, handle('tglink'));
    const initData = await sign({ user: JSON.stringify({ id: 8080, first_name: 'Link' }), auth_date: String(Math.floor(Date.now() / 1000)) });
    const r = await c.api('POST', '/api/auth/telegram', { initData });
    assert.equal(r.data.user.id, c.user.id);
    const me = await c.api('GET', '/api/me');
    assert.equal(me.data.telegram.linked, true);
    assert.equal(me.data.telegram.bot, 'shyst_test_bot');
  });

  test('webhook requires the registered secret header', async () => {
    const body = JSON.stringify({ message: { chat: { id: 1, type: 'private' }, text: '/help' } });
    const bad = await fetch(`${tg.url}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'nope' }, body });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${tg.url}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook-secret-123' }, body });
    assert.equal(ok.status, 200);
  });
});
