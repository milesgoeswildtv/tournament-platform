/**
 * Browser test of Discord sign-in at phone size, through the real UI and the
 * real Worker, with a stand-in Discord consent page:
 *
 *   1. new Discord account → "Create my SHYST player" → signed in
 *   2. sign out, Continue with Discord again → the same player
 *   3. a username/password player links Discord in Settings → Discord sign-in
 *      resolves to that player; the database holds one row
 *   4. an unknown Discord account → "I already play on SHYST" → sign in → linked
 *   5. cancelled consent shows a clear message
 *
 *   npm run build:web && npm run test:discord-ui
 */
import { createRequire } from 'node:module';
import { startDevServer } from '../dev/server';
import { startFakeDiscord } from '../tests/support/fakeDiscord';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const OUT = new URL('../screens/', import.meta.url).pathname;
const fake = await startFakeDiscord('42', 'shh-secret');
const server = await startDevServer({ quiet: true, extraEnv: { DISCORD_CLIENT_ID: '42', DISCORD_CLIENT_SECRET: 'shh-secret', DISCORD_API_BASE: fake.api, DISCORD_AUTHORIZE_URL: fake.authorize, TELEGRAM_BOT_TOKEN: '9:x', TELEGRAM_BOT_USERNAME: 'shyst_bot' } });
const browser = await chromium.launch();
const errs: string[] = [];
const check = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`discord ui: ${msg}`);
  console.log(`✓ ${msg}`);
};
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/401|410|409/.test(m.text()) && errs.push(m.text()));
  return p;
};
const playerId = async (p: Awaited<ReturnType<typeof fresh>>) => (await p.getByText(/^Player #[A-Z0-9]{6}/).first().textContent())!.match(/#([A-Z0-9]{6})/)![1];
const signOut = async (p: Awaited<ReturnType<typeof fresh>>) => {
  await p.goto(`${server.url}/settings`);
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.waitForURL(/\/auth/);
};
const users = async (did: string) => ((await server.env.DB.prepare('SELECT tag FROM users WHERE discord_id = ?').bind(did).all()) as { results: { tag: string }[] }).results;

// 1. new Discord account creates one player, only after the person chooses
const a = await fresh();
await a.goto(`${server.url}/auth`);
await a.getByRole('button', { name: 'Continue with Discord' }).waitFor();
await a.screenshot({ path: `${OUT}discord-01-login.png` });
fake.state.current = { id: '800000000000000001', username: 'vex', global_name: 'Vex Marlow' };
await a.getByRole('button', { name: 'Continue with Discord' }).click();
await a.getByText('Discord verified').waitFor();
check((await users('800000000000000001')).length === 0, 'unknown Discord account: no player until the person chooses');
await a.screenshot({ path: `${OUT}discord-02-verified.png` });
await a.getByRole('button', { name: 'Create my SHYST player' }).click();
await a.getByText('Join with a code').waitFor();
const vex = await playerId(a);
check((await users('800000000000000001')).map((u) => u.tag).join() === vex, `created player #${vex} for the Discord account`);

// 2. returning: same player
await signOut(a);
await a.getByRole('button', { name: 'Continue with Discord' }).click();
await a.getByText('Join with a code').waitFor();
check((await playerId(a)) === vex, 'Discord sign-in again → the same player');
check(!a.url().includes('ticket'), 'no one-time ticket left in the address bar');

// 3. password player links Discord in Settings
const b = await fresh();
await b.goto(`${server.url}/auth?mode=signup`);
await b.getByLabel('Username').fill('webplayer');
await b.getByLabel('Display name').fill('Web Player');
await b.getByLabel('Password').fill('web-player-1');
await b.getByRole('button', { name: 'Create account' }).last().click();
await b.getByText('Join with a code').waitFor();
const web = await playerId(b);
await b.goto(`${server.url}/settings`);
fake.state.current = { id: '800000000000000002', username: 'webby', global_name: null };
await b.getByRole('button', { name: 'Link Discord' }).click();
await b.getByText(`@webby signs in as this player, #${web}`).waitFor();
await b.screenshot({ path: `${OUT}discord-03-settings-linked.png` });
await signOut(b);
await b.getByRole('button', { name: 'Continue with Discord' }).click();
await b.getByText('Join with a code').waitFor();
check((await playerId(b)) === web, `linked Discord resolves to the original player #${web}`);
check((await users('800000000000000002')).length === 1, 'one database row for that Discord account');

// 4. "I already play on SHYST"
const c = await fresh();
await c.goto(`${server.url}/auth?mode=signup`);
await c.getByLabel('Username').fill('already');
await c.getByLabel('Password').fill('already-plays-1');
await c.getByRole('button', { name: 'Create account' }).last().click();
await c.getByText('Join with a code').waitFor();
const already = await playerId(c);
await signOut(c);
fake.state.current = { id: '800000000000000003', username: 'alr', global_name: null };
await c.getByRole('button', { name: 'Continue with Discord' }).click();
await c.getByRole('button', { name: 'I already play on SHYST' }).click();
await c.getByLabel('Username').fill('already');
await c.getByLabel('Password').fill('already-plays-1');
await c.getByRole('button', { name: 'Sign in' }).last().click();
await c.getByText('Discord', { exact: true }).waitFor();
await c.getByText(`@alr signs in as this player, #${already}`).waitFor();
check((await users('800000000000000003')).map((u) => u.tag).join() === already, '"I already play" linked Discord to the existing player');

// 5. cancelled consent
fake.state.deny = true;
await c.goto(`${server.url}/settings`);
await signOut(c);
await c.getByRole('button', { name: 'Continue with Discord' }).click();
await c.getByText('Discord sign-in was cancelled.').waitFor();
check(true, 'cancelled consent explains itself');

const wide = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check(!wide && errs.length === 0, `no horizontal overflow, no console errors (${errs.join(' | ')})`);
await browser.close();
await server.close();
fake.close();
process.exit(0);
