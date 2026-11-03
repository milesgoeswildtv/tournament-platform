/**
 * Browser test of the Telegram Mini App entry: the app is opened the way
 * Telegram opens it (signed initData in the URL hash, an invite code as the
 * start parameter). Expect: server-validated sign-in, deep link to the invite,
 * join, and the player appearing in the lobby. The bot token is a test value.
 *
 * Then the account-linking flow, end to end through the UI: a player signs up
 * in a normal browser, taps Link Telegram in Settings, taps Start in the bot
 * (simulated webhook from the verified sender), and opens the Mini App in a
 * separate context (Telegram's own webview, no shared storage). Expect ONE
 * player: the same Player ID in the browser and the Mini App, after logout and
 * login, after reopening, and exactly one database row for that Telegram user.
 *
 *   npm run build:web && npm run test:telegram-ui
 */
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { startDevServer } from '../dev/server';
import { Client, tournamentConfig } from '../tests/support/client';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const TOKEN = '777:ui-test';
const server = await startDevServer({ quiet: true, extraEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: 'shyst_bot', TELEGRAM_WEBHOOK_SECRET: 'ui-hook' } });
const host = await Client.register(server.url, 'hosty', 'Hosty');
const t = (await host.api('POST', '/api/tournaments', { config: tournamentConfig({ title: 'Telegram Night' }) })).data;
const fields: Record<string, string> = { user: JSON.stringify({ id: 99, first_name: 'Tess', username: 'tess' }), auth_date: String(Math.floor(Date.now() / 1000)), start_param: t.invite.code };
const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
const initData = new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('https://telegram.org/**', (r) => r.abort());
await page.goto(`${server.url}/#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`);
await page.waitForURL(`${server.url}/j/${t.invite.code}`, { timeout: 10000 });
await page.getByRole('button', { name: 'Join tournament' }).click();
await page.waitForURL(`${server.url}/t/${t.id}`);
await page.locator('[data-player="Tess"]').waitFor();
console.log('Telegram Mini App: signed in as Tess via initData, deep-linked to invite, joined lobby. errors:', errs.length);

// ------------------------------------------------------------------ account linking
const assert = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`linking: ${msg}`);
};
const OUT = new URL('../screens/', import.meta.url).pathname;
const signed = (tgId: number) => {
  const f: Record<string, string> = { user: JSON.stringify({ id: tgId, first_name: 'Prot', username: 'protocol_tg' }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const c = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  return new URLSearchParams({ ...f, hash: createHmac('sha256', secret).update(c).digest('hex') }).toString();
};
const playerId = async (pg: typeof page) => (await pg.getByText(/^Player #[A-Z0-9]{6}/).first().textContent())!.match(/#([A-Z0-9]{6})/)![1];
const TG = 424242;

const web = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
let botUrl = '';
await web.route('https://t.me/**', (r) => {
  botUrl = r.request().url();
  return r.fulfill({ status: 200, contentType: 'text/html', body: 'telegram' });
});
const w = await web.newPage();
w.on('pageerror', (e) => errs.push(String(e)));
await w.goto(`${server.url}/auth?mode=signup`);
await w.getByLabel('Username').fill('protocol');
await w.getByLabel('Display name').fill('Protocol');
await w.getByLabel('Password').fill('protocol-pass-1');
await w.getByRole('button', { name: 'Create account' }).last().click();
await w.getByText('Join with a code').waitFor();
const original = await playerId(w);

await w.goto(`${server.url}/settings`);
await w.getByRole('button', { name: 'Link Telegram' }).click();
for (let i = 0; i < 50 && !botUrl; i++) await w.waitForTimeout(100);
const param = new URL(botUrl).searchParams.get('start') ?? '';
assert(botUrl.startsWith('https://t.me/shyst_bot?start=link_') && param.length > 20, `bot link opened: ${botUrl}`);
// the player taps Start; Telegram calls the webhook with the verified sender
const hook = await fetch(`${server.url}/api/telegram/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'ui-hook' },
  body: JSON.stringify({ message: { chat: { id: TG, type: 'private' }, from: { id: TG, first_name: 'Prot', username: 'protocol_tg' }, text: `/start ${param}` } }),
});
assert(hook.ok, 'webhook accepted');
await w.getByRole('button', { name: /check again/ }).click();
await w.getByText(`@protocol_tg signs in as this player, #${original}`).waitFor();
await w.screenshot({ path: `${OUT}tg-link-01-browser-settings-linked.png` });

// the Mini App: a separate webview with no browser session
const openMiniApp = async (label: string) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push(String(e)));
  await m.route('https://telegram.org/**', (r) => r.abort());
  await m.goto(`${server.url}/#tgWebAppData=${encodeURIComponent(signed(TG))}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`);
  await m.getByText('Join with a code').waitFor();
  const id = await playerId(m);
  assert(id === original, `${label}: Mini App shows #${id}, browser player is #${original}`);
  await m.goto(`${server.url}/settings`);
  await m.getByText(`signs in as this player, #${original}`).waitFor();
  return { ctx, m };
};
const first = await openMiniApp('first open');
await first.m.goto(`${server.url}/me`);
await first.m.getByText(`Player #${original}`).waitFor();
const shownIds = new Set((await first.m.locator('main').innerText()).match(/#[A-Z0-9]{6}\b/g) ?? []);
assert(shownIds.size === 1 && shownIds.has(`#${original}`), `profile shows one identity, got ${[...shownIds].join(', ')}`);
await first.m.screenshot({ path: `${OUT}tg-link-02-miniapp-profile.png` });
await first.ctx.close();

// logout and back in with the password: same player, still linked
await w.goto(`${server.url}/settings`);
await w.getByRole('button', { name: 'Sign out' }).click();
await w.waitForURL(/\/auth/);
await w.getByLabel('Username').fill('protocol');
await w.getByLabel('Password').fill('protocol-pass-1');
await w.getByRole('button', { name: 'Sign in' }).last().click();
await w.getByText('Join with a code').waitFor();
assert((await playerId(w)) === original, 'same Player ID after logout and login');
await w.goto(`${server.url}/settings`);
await w.getByText(`signs in as this player, #${original}`).waitFor();

// reopening the Mini App, and asking to link again, create nothing new
const before = (await server.env.DB.prepare('SELECT COUNT(*) AS n FROM users').bind().first()) as { n: number };
(await openMiniApp('second open')).ctx.close();
(await openMiniApp('third open')).ctx.close();
const again = await w.evaluate(async () => {
  const s = JSON.parse(localStorage.getItem('tp.session.v1')!);
  return (await fetch('/api/me/telegram/link', { method: 'POST', headers: { authorization: `Bearer ${s.token}` } })).json();
});
assert(again.linked === true, 'a repeat link request reports already linked');
const after = (await server.env.DB.prepare('SELECT COUNT(*) AS n FROM users').bind().first()) as { n: number };
const rows = (await server.env.DB.prepare('SELECT tag FROM users WHERE telegram_id = ?').bind(String(TG)).all()) as { results: { tag: string }[] };
assert(after.n === before.n, `no new player rows (${before.n} → ${after.n})`);
assert(rows.results.length === 1 && rows.results[0].tag === original, `one row for this Telegram user: ${JSON.stringify(rows.results)}`);
console.log(`Telegram linking: browser player #${original} = Mini App player (3 opens), one identity shown, survives logout/login, one DB row, no duplicates. errors: ${errs.length}`);

await browser.close(); await server.close(); process.exit(errs.length ? 1 : 0);
