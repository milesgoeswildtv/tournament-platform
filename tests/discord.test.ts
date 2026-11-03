/**
 * Discord sign-in against a stand-in Discord (same endpoints and checks as
 * discord.com: client secret, redirect URI, single-use codes, bearer tokens).
 * Verifies the identity relationship in the database, not just responses.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { startDevServer, type DevServer } from '../dev/server';
import { Client } from './support/client';

const ID = '1234567890';
const SECRET = 'discord-client-secret-xyz';
const TG_TOKEN = '888:discord-test';
let s: DevServer;
let fake: Server;
let fakeUrl = '';
const codes = new Map<string, { id: string; username: string; global_name: string | null }>();
const tokens = new Map<string, { id: string; username: string; global_name: string | null }>();
const revoked = new Set<string>();
const seen: { redirect?: string; secretOk?: boolean } = {};
let n = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${n++}`;

function startFake(): Promise<void> {
  fake = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/oauth2/token' && req.method === 'POST') {
      seen.redirect = form.get('redirect_uri') ?? undefined;
      seen.secretOk = form.get('client_secret') === SECRET && form.get('client_id') === ID;
      const p = codes.get(form.get('code') ?? '');
      if (!seen.secretOk || !p || form.get('grant_type') !== 'authorization_code') return send(400, { error: 'invalid_grant' });
      codes.delete(form.get('code')!);
      const at = `at_${Math.random().toString(36).slice(2)}`;
      tokens.set(at, p);
      return send(200, { access_token: at, token_type: 'Bearer', expires_in: 604800, scope: 'identify' });
    }
    if (req.url === '/users/@me') {
      const at = (req.headers.authorization ?? '').replace('Bearer ', '');
      const p = !revoked.has(at) && tokens.get(at);
      return p ? send(200, p) : send(401, { message: '401: Unauthorized' });
    }
    if (req.url === '/oauth2/token/revoke') {
      revoked.add(form.get('token') ?? '');
      return send(200, {});
    }
    send(404, {});
  });
  return new Promise((r) => fake.listen(0, '127.0.0.1', () => {
    fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    r();
  }));
}

/** The browser round trip: start → Discord consent → callback. Returns where the callback sends the browser. */
async function oauth(profile: { id: string; username: string; global_name?: string | null } | 'deny', opts: { client?: Client; mode?: 'login' | 'link'; next?: string } = {}) {
  const c = opts.client ?? new Client(s.url, 'web');
  const st = await c.api('POST', '/api/auth/discord/start', { mode: opts.mode ?? 'login', next: opts.next });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const auth = new URL(st.data.url);
  assert.equal(auth.searchParams.get('client_id'), ID);
  assert.equal(auth.searchParams.get('scope'), 'identify');
  const state = auth.searchParams.get('state')!;
  const q = new URLSearchParams({ state });
  if (profile === 'deny') q.set('error', 'access_denied');
  else {
    const code = `code_${Math.random().toString(36).slice(2)}`;
    codes.set(code, { global_name: null, ...profile });
    q.set('code', code);
  }
  const cb = await fetch(`${s.url}/api/auth/discord/callback?${q}`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  return { location: new URL(cb.headers.get('location')!), state, query: q };
}
const hashParams = (u: URL) => new URLSearchParams(u.hash.slice(1));
async function signInWithDiscord(profile: { id: string; username: string; global_name?: string | null }) {
  const { location } = await oauth(profile);
  const h = hashParams(location);
  const c = new Client(s.url, 'discord');
  if (h.get('ticket')) {
    const r = await c.api('POST', '/api/auth/discord/exchange', { ticket: h.get('ticket') });
    c.token = r.data.token;
    c.user = r.data.user;
    return { c, created: false, r };
  }
  const r = await c.api('POST', '/api/auth/discord/complete', { pending: h.get('pending'), action: 'create' });
  c.token = r.data.token;
  c.user = r.data.user;
  return { c, created: true, r };
}
const db = <T,>(sql: string, ...a: unknown[]) => s.env.DB.prepare(sql).bind(...a).all() as Promise<{ results: T[] }>;
const userCount = async () => (await db<{ n: number }>('SELECT COUNT(*) AS n FROM users')).results[0].n;

before(async () => {
  await startFake();
  s = await startDevServer({ quiet: true, staticDir: null, extraEnv: { DISCORD_CLIENT_ID: ID, DISCORD_CLIENT_SECRET: SECRET, DISCORD_API_BASE: fakeUrl, TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_WEBHOOK_SECRET: 'h', TELEGRAM_BOT_USERNAME: 'shyst_bot' } });
});
after(async () => {
  await s.close();
  fake.close();
});

describe('Discord sign-in', () => {
  test('providers endpoint reports Discord; the client secret is never sent to the browser', async () => {
    const p = await new Client(s.url, 'x').api('GET', '/api/auth/providers');
    assert.deepEqual(p.data, { discord: true, telegram: { enabled: true, bot: 'shyst_bot' } });
    const st = await new Client(s.url, 'x').api('POST', '/api/auth/discord/start', { mode: 'login' });
    assert.ok(!JSON.stringify(st.data).includes(SECRET));
  });

  test('a new Discord identity is not given a player until the person chooses; "create" makes exactly one', async () => {
    const before = await userCount();
    const { location } = await oauth({ id: '700000000000000001', username: 'neo', global_name: 'Neo Vance' });
    assert.equal(location.pathname, '/auth/discord');
    assert.ok(hashParams(location).get('pending'));
    assert.equal(hashParams(location).get('name'), 'Neo Vance');
    assert.equal(location.search, '', 'nothing sensitive in the query string');
    assert.equal(await userCount(), before, 'no player created by the callback');
    assert.ok(seen.secretOk, 'code exchanged server-side with the client secret');
    assert.equal(seen.redirect, `${s.url}/api/auth/discord/callback`);

    const r = await new Client(s.url, 'n').api('POST', '/api/auth/discord/complete', { pending: hashParams(location).get('pending'), action: 'create' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.name, 'Neo Vance');
    assert.equal(r.data.user.discord, true);
    assert.equal(await userCount(), before + 1);
    const again = await new Client(s.url, 'n').api('POST', '/api/auth/discord/complete', { pending: hashParams(location).get('pending'), action: 'create' });
    assert.equal(again.status, 410, 'pending identity is single-use');
  });

  test('returning Discord users sign in to the same player; tickets are single-use; Discord tokens are revoked', async () => {
    const first = await signInWithDiscord({ id: '700000000000000002', username: 'trin' });
    const second = await signInWithDiscord({ id: '700000000000000002', username: 'trin_renamed' });
    assert.equal(second.created, false);
    assert.equal(second.c.user.id, first.c.user.id);
    assert.equal(second.c.user.tag, first.c.user.tag);
    assert.ok([...tokens.keys()].every((t) => revoked.has(t)), 'every access token was revoked after use');
    const { location } = await oauth({ id: '700000000000000002', username: 'trin' });
    const ticket = hashParams(location).get('ticket');
    assert.equal((await new Client(s.url, 'a').api('POST', '/api/auth/discord/exchange', { ticket })).status, 200);
    assert.equal((await new Client(s.url, 'a').api('POST', '/api/auth/discord/exchange', { ticket })).status, 410);
  });

  test('the Discord username is never the identity: same username, different id → different players', async () => {
    const a = await signInWithDiscord({ id: '700000000000000010', username: 'samename' });
    const b = await signInWithDiscord({ id: '700000000000000011', username: 'samename' });
    assert.notEqual(a.c.user.id, b.c.user.id);
  });

  test('linking from Settings attaches Discord to the existing player; history-bearing identity stays one player', async () => {
    const web = await Client.register(s.url, uniq('dlink'), 'Linker');
    const before = await userCount();
    const { location } = await oauth({ id: '700000000000000003', username: 'linker' }, { client: web, mode: 'link' });
    assert.equal(`${location.pathname}${location.search}`, '/settings?discord=linked');
    const me = await web.api('GET', '/api/me');
    assert.deepEqual(me.data.discord, { configured: true, linked: true, username: 'linker' });
    const viaDiscord = await signInWithDiscord({ id: '700000000000000003', username: 'linker' });
    assert.equal(viaDiscord.c.user.id, web.user.id, 'Discord sign-in resolves to the original player');
    assert.equal(await userCount(), before);
  });

  test('"I already play": a pending Discord identity links to the player who signs in', async () => {
    const web = await Client.register(s.url, uniq('pend'), 'Pender');
    const { location } = await oauth({ id: '700000000000000004', username: 'pender' });
    const r = await web.api('POST', '/api/auth/discord/complete', { pending: hashParams(location).get('pending'), action: 'link' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.id, web.user.id);
    assert.equal((await signInWithDiscord({ id: '700000000000000004', username: 'pender' })).c.user.id, web.user.id);
  });

  test('Telegram first, then Discord: one player with both providers, nothing overwritten', async () => {
    const f: Record<string, string> = { user: JSON.stringify({ id: 6060, first_name: 'Both' }), auth_date: String(Math.floor(Date.now() / 1000)) };
    const chk = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(TG_TOKEN).digest();
    const initData = new URLSearchParams({ ...f, hash: createHmac('sha256', secret).update(chk).digest('hex') }).toString();
    const tg = new Client(s.url, 'tg');
    const t = await tg.api('POST', '/api/auth/telegram', { initData });
    tg.token = t.data.token;
    tg.user = t.data.user;
    await oauth({ id: '700000000000000005', username: 'both' }, { client: tg, mode: 'link' });
    const row = (await db<{ telegram_id: string; discord_id: string }>('SELECT telegram_id, discord_id FROM users WHERE id = ?', tg.user.id)).results[0];
    assert.deepEqual(row, { telegram_id: '6060', discord_id: '700000000000000005' });
    assert.equal((await signInWithDiscord({ id: '700000000000000005', username: 'both' })).c.user.id, tg.user.id);
    assert.equal((await new Client(s.url, 'tg').api('POST', '/api/auth/telegram', { initData })).data.user.id, tg.user.id);
  });

  test('collisions are refused, never merged or overwritten', async () => {
    const owner = await Client.register(s.url, uniq('own'));
    await oauth({ id: '700000000000000006', username: 'owner' }, { client: owner, mode: 'link' });
    const other = await Client.register(s.url, uniq('oth'));
    const { location } = await oauth({ id: '700000000000000006', username: 'owner' }, { client: other, mode: 'link' });
    assert.equal(location.search, '?discord=taken');
    assert.equal((await other.api('GET', '/api/me')).data.discord.linked, false);
    // a player already on Discord A isn't offered a switch to Discord B
    assert.deepEqual((await owner.api('POST', '/api/auth/discord/start', { mode: 'link' })).data, { linked: true });
    const ownerRow = (await db<{ discord_id: string }>('SELECT discord_id FROM users WHERE id = ?', owner.user.id)).results[0];
    assert.equal(ownerRow.discord_id, '700000000000000006');
    const pend = await oauth({ id: '700000000000000006', username: 'owner' });
    assert.ok(hashParams(pend.location).get('ticket'), 'the Discord account still signs in as its owner');
    const ev = (await db<{ kind: string }>("SELECT kind FROM identity_events WHERE user_id = ? AND via = 'discord'", other.user.id)).results;
    assert.deepEqual(ev, [{ kind: 'DISCORD_LINK_REFUSED' }]);
  });

  test('denied consent, replayed state, forged state and bad codes all fail safely', async () => {
    const denied = await oauth('deny');
    assert.equal(denied.location.search, '?discord=denied');
    const replay = await fetch(`${s.url}/api/auth/discord/callback?${denied.query}`, { redirect: 'manual' });
    assert.equal(new URL(replay.headers.get('location')!).search, '?discord=expired', 'state is single-use');
    const forged = await fetch(`${s.url}/api/auth/discord/callback?state=forgedforgedforgedforged&code=x`, { redirect: 'manual' });
    assert.equal(new URL(forged.headers.get('location')!).search, '?discord=expired');
    const st = await new Client(s.url, 'x').api('POST', '/api/auth/discord/start', { mode: 'login' });
    const state = new URL(st.data.url).searchParams.get('state')!;
    const bad = await fetch(`${s.url}/api/auth/discord/callback?state=${state}&code=not-a-real-code`, { redirect: 'manual' });
    assert.equal(new URL(bad.headers.get('location')!).search, '?discord=failed');
  });

  test('link mode needs a session; open redirects are refused', async () => {
    assert.equal((await new Client(s.url, 'x').api('POST', '/api/auth/discord/start', { mode: 'link' })).status, 401);
    const { location } = await oauth({ id: '700000000000000008', username: 'nx' }, { next: '//evil.example/steal' });
    assert.equal(hashParams(location).get('next'), '/');
  });
});
