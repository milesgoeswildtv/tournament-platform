/**
 * Browser acceptance test for both Crashout → SHYST account-link flows.
 * Runs at phone size against the real SHYST Worker and a local stand-in
 * for the central Supabase gateway.
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startDevServer } from '../dev/server';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');
const OUT = new URL('../screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ADAPTER_KEY = 'e2e-only-shyst-adapter-key-not-production';
const TOKEN_EXISTING = 'a'.repeat(64);
const TOKEN_CREATE = 'b'.repeat(64);
const TOKEN_ACTIVE_EXISTING = 'c'.repeat(64);
const calls: { key: string | string[] | undefined; body: any }[] = [];

const gateway = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let body: any = null;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* malformed request */ }
  calls.push({ key: req.headers['x-crashout-adapter-key'], body });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ link_id: `e2e-link-${calls.length}` }));
});
await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const gatewayUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
const server = await startDevServer({
  quiet: true,
  extraEnv: {
    CRASHOUT_SHYST_ADAPTER_KEY: ADAPTER_KEY,
    CRASHOUT_LINK_GATEWAY_URL: gatewayUrl,
  },
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error' && !/401|409|410/.test(message.text())) errors.push(message.text());
});
const check = (condition: unknown, label: string) => {
  assert.ok(condition, label);
  console.log(`✓ ${label}`);
};
const userId = async (handle: string) => {
  const row = await server.env.DB.prepare('SELECT id FROM users WHERE handle = ?').bind(handle).first<{ id: string }>();
  assert.ok(row, `SHYST account ${handle} exists`);
  return row.id;
};

try {
  // Existing-account path: preserve the one-time token while the player signs in.
  await page.goto(`${server.url}/auth?mode=signup`);
  await page.getByLabel('Username').fill('crashout_existing');
  await page.getByLabel('Display name').fill('Existing Player');
  await page.getByLabel('Password').fill('existing-player-1');
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.getByText('Join with a code').waitFor();
  const existingId = await userId('crashout_existing');
  await page.goto(`${server.url}/settings`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/auth/);
  await page.goto(`${server.url}/#crashout_link=${TOKEN_EXISTING}&crashout_flow=existing`);
  await page.waitForURL(/\/auth\?/);
  await page.getByRole('radio', { name: 'Sign in' }).waitFor();
  check(await page.getByRole('radio', { name: 'Sign in' }).isChecked(), 'existing-account handoff opens sign-in mode');
  await page.getByLabel('Username').fill('crashout_existing');
  await page.getByLabel('Password').fill('existing-player-1');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.getByText('Your SHYST account is now connected to Crashout.').waitFor();
  check(calls.length === 1 && calls[0].body.external_player_id === existingId, 'existing SHYST account is linked using the authenticated session identity');
  check(calls[0].body.token === TOKEN_EXISTING && calls[0].key === ADAPTER_KEY, 'one-time token and adapter credential reach only the server-side gateway');
  check(!page.url().includes(TOKEN_EXISTING), 'one-time token is removed from the address bar after handoff');
  await page.screenshot({ path: `${OUT}crashout-link-existing.png`, fullPage: true });

  // If the browser already has a SHYST session, require an explicit choice.
  await page.goto(`${server.url}/#crashout_link=${TOKEN_ACTIVE_EXISTING}&crashout_flow=existing`);
  await page.getByText('ALREADY SIGNED IN.').waitFor();
  await page.getByRole('button', { name: 'USE THIS SHYST ACCOUNT' }).click();
  await page.getByText('Your current SHYST account is now connected to Crashout.').waitFor();
  check(calls.length === 2 && calls[1].body.external_player_id === existingId, 'active existing SHYST session is linked only after explicit confirmation');

  // New-account path: signup mode is selected and the newly created player is linked.
  await page.goto(`${server.url}/#crashout_link=${TOKEN_CREATE}&crashout_flow=create`);
  await page.getByText('ALREADY SIGNED IN.').waitFor();
  await page.getByRole('button', { name: 'SIGN OUT & CREATE A NEW ACCOUNT' }).click();
  await page.waitForURL(/\/auth\?/);
  check(await page.getByRole('radio', { name: 'Create account' }).isChecked(), 'create-account handoff offers explicit sign-out then opens signup mode');
  await page.getByLabel('Username').fill('crashout_created');
  await page.getByLabel('Display name').fill('New Player');
  await page.getByLabel('Password').fill('new-player-password-1');
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.getByText('Your SHYST account is now connected to Crashout.').waitFor();
  const createdId = await userId('crashout_created');
  check(calls.length === 3 && calls[2].body.external_player_id === createdId, 'newly created SHYST account is linked automatically');
  check(calls[2].body.token === TOKEN_CREATE && calls[2].key === ADAPTER_KEY, 'new-account flow uses the same scoped server-side gateway');
  check(!page.url().includes(TOKEN_CREATE), 'new-account one-time token is removed from the address bar');
  const browserStorage = await page.evaluate(() => JSON.stringify({ local: localStorage, session: sessionStorage }));
  check(!browserStorage.includes(ADAPTER_KEY), 'adapter credential never enters browser storage');
  await page.screenshot({ path: `${OUT}crashout-link-create.png`, fullPage: true });
  check(errors.length === 0, `no browser runtime or console errors (${errors.join(' | ')})`);
  console.log('✓ Crashout existing-account and create-account browser flows passed');
} finally {
  await browser.close();
  await server.close();
  await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve()));
}
