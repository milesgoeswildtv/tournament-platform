/**
 * One player, one identity. Telegram is a sign-in method attached to the
 * canonical SHYST player; linking must never mint a second player.
 *
 * Runs the real Worker (dev/runtime.ts stand-in for D1 + Durable Objects) and
 * checks the database itself, not just what the UI is told.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startDevServer, type DevServer } from '../dev/server';
import { Client, tournamentConfig } from './support/client';

const TOKEN = '777000:identity-test-token';
const HOOK = 'identity-hook-secret';
let s: DevServer;
let n = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${n++}`;

const initData = (tgId: number, extra: Record<string, string> = {}) => {
  const f: Record<string, string> = { user: JSON.stringify({ id: tgId, first_name: 'Tele', username: `tg${tgId}` }), auth_date: String(Math.floor(Date.now() / 1000)), ...extra };
  const check = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  return new URLSearchParams({ ...f, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
};
/** What the Mini App does: a fresh webview, no browser session, only signed initData. */
const miniApp = (tgId: number, extra?: Record<string, string>, as?: Client) => (as ?? new Client(s.url, 'tg')).api('POST', '/api/auth/telegram', { initData: initData(tgId, extra) });
/** What Telegram does when the player taps Start on t.me/<bot>?start=<param>. */
const botStart = (tgId: number, param: string) =>
  fetch(`${s.url}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': HOOK },
    body: JSON.stringify({ message: { chat: { id: tgId, type: 'private' }, from: { id: tgId, first_name: 'Tele', username: `tg${tgId}` }, text: `/start ${param}` } }),
  });
const linkParam = async (c: Client) => {
  const r = await c.api('POST', '/api/me/telegram/link');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, false);
  return new URL(r.data.botUrl).searchParams.get('start')!;
};
const db = <T,>(sql: string, ...args: unknown[]) => s.env.DB.prepare(sql).bind(...args).all() as Promise<{ results: T[] }>;
const usersWithTg = async (tgId: number) => (await db<{ id: string }>('SELECT id FROM users WHERE telegram_id = ?', String(tgId))).results;
const userCount = async () => (await db<{ n: number }>('SELECT COUNT(*) AS n FROM users')).results[0].n;

before(async () => {
  s = await startDevServer({ quiet: true, staticDir: null, extraEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: HOOK, TELEGRAM_BOT_USERNAME: 'shyst_test_bot', TELEGRAM_MINIAPP_SHORTNAME: 'play' } });
});
after(async () => s.close());

describe('Telegram linking keeps one canonical player', () => {
  test('bot link: the Mini App then resolves to the original player, with one identity', async () => {
    const web = await Client.register(s.url, uniq('web'), 'Web Player');
    const before = await userCount();
    const param = await linkParam(web);
    assert.match(param, /^link_[A-Za-z0-9_-]{24}$/);

    assert.equal((await botStart(9101, param)).status, 200);
    const rows = await usersWithTg(9101);
    assert.deepEqual(rows.map((r) => r.id), [web.user.id], 'Telegram attached to the existing player row');

    const tg = await miniApp(9101);
    assert.equal(tg.status, 200);
    assert.equal(tg.data.user.id, web.user.id, 'Mini App signs in as the original player');
    assert.equal(tg.data.user.tag, web.user.tag, 'same public Player ID');
    assert.equal(await userCount(), before, 'no player record was created');

    const me = await web.api('GET', '/api/me');
    assert.equal(me.data.telegram.linked, true);
    assert.equal(me.data.telegram.username, 'tg9101');
    const ev = (await db<{ kind: string; via: string }>('SELECT kind, via FROM identity_events WHERE user_id = ?', web.user.id)).results;
    assert.deepEqual(ev, [{ kind: 'TELEGRAM_LINKED', via: 'bot' }]);
  });

  test('Mini App link (startapp=link_…): resolves to the original player', async () => {
    const web = await Client.register(s.url, uniq('mini'), 'Mini Player');
    const r = await web.api('POST', '/api/me/telegram/link');
    assert.equal(new URL(r.data.miniAppUrl).pathname, '/shyst_test_bot/play');
    const param = new URL(r.data.miniAppUrl).searchParams.get('startapp')!;
    const tg = await miniApp(9102, { start_param: param });
    assert.equal(tg.data.user.id, web.user.id);
    assert.equal(tg.data.link.ok, true);
    assert.equal(tg.data.startParam, null, 'the link token is not treated as an invite code');
    assert.deepEqual((await usersWithTg(9102)).map((x) => x.id), [web.user.id]);
  });

  test('the bug state (an empty Telegram-only duplicate) is reconciled safely into the original', async () => {
    const web = await Client.register(s.url, uniq('dup'), 'Original');
    // The shipped bug: the Mini App was opened before linking and minted a second player.
    const dupClient = new Client(s.url, 'tg');
    const dup = await miniApp(9103, undefined, dupClient);
    dupClient.token = dup.data.token;
    assert.notEqual(dup.data.user.id, web.user.id);
    const total = await userCount();

    await botStart(9103, await linkParam(web));

    assert.deepEqual((await usersWithTg(9103)).map((x) => x.id), [web.user.id], 'Telegram moved to the original player');
    const dupRow = (await db<{ telegram_id: string | null; merged_into: string | null }>('SELECT telegram_id, merged_into FROM users WHERE id = ?', dup.data.user.id)).results[0];
    assert.deepEqual(dupRow, { telegram_id: null, merged_into: web.user.id }, 'duplicate kept (not deleted) and pointed at the original');
    assert.equal(await userCount(), total, 'nothing deleted');
    assert.equal((await dupClient.api('GET', '/api/me')).status, 401, 'the duplicate’s sessions are revoked');
    assert.equal((await miniApp(9103)).data.user.id, web.user.id, 'Telegram now signs in as the original');
    const ev = (await db<{ kind: string; other_user_id: string }>('SELECT kind, other_user_id FROM identity_events WHERE user_id = ?', web.user.id)).results;
    assert.deepEqual(ev, [{ kind: 'TELEGRAM_RECONCILED', other_user_id: dup.data.user.id }]);
  });

  test('a Telegram-only player with tournament history is never merged automatically', async () => {
    const host = await Client.register(s.url, uniq('host'));
    const t = (await host.api('POST', '/api/tournaments', { config: tournamentConfig({ title: 'History cup' }) })).data;
    const tgOnly = new Client(s.url, 'tg');
    const signed = await miniApp(9104, undefined, tgOnly);
    tgOnly.token = signed.data.token;
    assert.equal((await tgOnly.api('POST', '/api/join', { code: t.invite.code })).status, 200);

    const web = await Client.register(s.url, uniq('hist'));
    await botStart(9104, await linkParam(web));

    assert.deepEqual((await usersWithTg(9104)).map((x) => x.id), [signed.data.user.id], 'Telegram stays with the player who has history');
    assert.equal((await web.api('GET', '/api/me')).data.telegram.linked, false);
    assert.equal((await tgOnly.api('GET', '/api/me')).status, 200, 'that player is untouched');
    const ev = (await db<{ kind: string }>('SELECT kind FROM identity_events WHERE user_id = ?', web.user.id)).results;
    assert.deepEqual(ev, [{ kind: 'TELEGRAM_LINK_REFUSED' }]);
  });

  test('repeated linking creates no duplicates; tokens are single-use', async () => {
    const web = await Client.register(s.url, uniq('rep'));
    const param = await linkParam(web);
    await botStart(9105, param);
    const total = await userCount();

    await botStart(9105, param); // same token again
    const again = await web.api('POST', '/api/me/telegram/link'); // already linked
    assert.deepEqual(again.data, { linked: true, telegramUsername: 'tg9105' });
    for (let i = 0; i < 3; i++) assert.equal((await miniApp(9105)).data.user.id, web.user.id);

    // A different SHYST player cannot take this Telegram account.
    const other = await Client.register(s.url, uniq('oth'));
    await botStart(9105, await linkParam(other));
    assert.equal((await other.api('GET', '/api/me')).data.telegram.linked, false);

    assert.deepEqual((await usersWithTg(9105)).map((x) => x.id), [web.user.id]);
    assert.equal(await userCount(), total + 1, 'only the second web account was added');
    const used = (await db<{ n: number }>('SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE user_id = ? AND used_at IS NOT NULL', web.user.id)).results[0].n;
    assert.equal(used, 1, 'the replayed token was not accepted twice');
  });

  test('a spent link token cannot be replayed by a different Telegram account', async () => {
    const owner = await Client.register(s.url, uniq('own2'));
    await botStart(9111, await linkParam(owner));
    const web = await Client.register(s.url, uniq('once'));
    const param = await linkParam(web);
    await botStart(9111, param); // refused: 9111 belongs to another player with a login
    await botStart(9112, param); // same token, different Telegram account
    assert.equal((await usersWithTg(9112)).length, 0, 'the spent token linked nothing');
    assert.equal((await web.api('GET', '/api/me')).data.telegram.linked, false);
  });

  test('an expired link token is refused', async () => {
    const web = await Client.register(s.url, uniq('exp'));
    const param = await linkParam(web);
    await s.env.DB.prepare('UPDATE telegram_link_tokens SET expires_at = 0 WHERE user_id = ?').bind(web.user.id).run();
    await botStart(9106, param);
    assert.equal((await usersWithTg(9106)).length, 0);
    assert.equal((await web.api('GET', '/api/me')).data.telegram.linked, false);
  });

  test('logout and login keep the association; Telegram still resolves to the same player', async () => {
    const h = uniq('relog');
    const web = await Client.register(s.url, h, 'Relog');
    await botStart(9107, await linkParam(web));
    const oldToken = web.token;
    await web.api('POST', '/api/auth/logout');
    assert.equal((await web.api('GET', '/api/me')).status, 401, 'logged out');

    const back = await new Client(s.url, h).api('POST', '/api/auth/login', { handle: h, password: 'correct-horse-9' });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.equal(back.data.user.id, web.user.id);
    assert.equal(back.data.user.telegram, true);
    assert.notEqual(back.data.token, oldToken);
    assert.equal((await miniApp(9107)).data.user.id, web.user.id);
  });

  test('a player signed in inside the Mini App is never swapped for another player', async () => {
    const owner = await Client.register(s.url, uniq('own'));
    await botStart(9108, await linkParam(owner));
    const other = await Client.register(s.url, uniq('swap'));
    const r = await miniApp(9108, undefined, other);
    assert.equal(r.data.user.id, other.user.id, 'stays signed in as the player who signed in');
    assert.equal(r.data.link.ok, false);
    assert.deepEqual((await usersWithTg(9108)).map((x) => x.id), [owner.user.id]);
  });

  test('signing in with a password inside the Mini App links that player', async () => {
    const web = await Client.register(s.url, uniq('pw'));
    const r = await miniApp(9109, undefined, web); // what linkInMiniApp() sends after the password sign-in
    assert.equal(r.data.user.id, web.user.id);
    assert.equal(r.data.link.ok, true);
    assert.deepEqual((await usersWithTg(9109)).map((x) => x.id), [web.user.id]);
  });

  test('a Telegram-created player can add username/password without creating a second player', async () => {
    const total = await userCount();
    const tg = new Client(s.url, 'tg');
    const first = await miniApp(9112, undefined, tg);
    tg.token = first.data.token;
    const playerId = first.data.user.id;
    const handle = uniq('tglogin');
    const saved = await tg.api('POST', '/api/me/password', { handle, password: 'new-secure-password-42' });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.user.id, playerId);
    assert.equal(saved.data.user.handle, handle);
    assert.equal(await userCount(), total + 1, 'credential linking does not create another player');

    const browser = new Client(s.url, 'browser');
    const login = await browser.api('POST', '/api/auth/login', { handle, password: 'new-secure-password-42' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.id, playerId, 'password login resolves to the same canonical player');

    const denied = await tg.api('POST', '/api/me/password', { handle, password: 'changed-password-43' });
    assert.equal(denied.status, 401, 'existing credentials cannot be overwritten without the current password');
    const changed = await tg.api('POST', '/api/me/password', { handle, currentPassword: 'new-secure-password-42', password: 'changed-password-43' });
    assert.equal(changed.status, 200);
    assert.equal((await browser.api('POST', '/api/auth/login', { handle, password: 'changed-password-43' })).status, 200);
  });

  test('a person with no SHYST account still gets exactly one Telegram player', async () => {
    const total = await userCount();
    const a = await miniApp(9110);
    const b = await miniApp(9110);
    assert.equal(a.data.user.id, b.data.user.id);
    assert.equal(await userCount(), total + 1);
  });
});
