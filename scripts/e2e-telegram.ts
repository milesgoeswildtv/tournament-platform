/**
 * Browser test of the Telegram Mini App entry: the app is opened the way
 * Telegram opens it (signed initData in the URL hash, an invite code as the
 * start parameter). Expect: server-validated sign-in, deep link to the invite,
 * join, and the player appearing in the lobby. The bot token is a test value.
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
const server = await startDevServer({ quiet: true, extraEnv: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_BOT_USERNAME: 'tbd_bot' } });
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
await browser.close(); await server.close(); process.exit(errs.length ? 1 : 0);
