/**
 * Visual QA: renders the main screens at phone and desktop sizes and saves
 * screenshots to screens/ (git-ignored). Uses the local dev server and
 * Playwright's bundled Chromium.
 *
 *   npm run shots                         # 390×844 phone
 *   npm run shots -- --size=se,max,desk   # 375×667, 430×932, 1280×860
 *   npm run shots -- hub lobby            # only some screens
 *
 * Each screen is saved twice: <size>-<name>.png is exactly what fits on the
 * screen (fixed bars where they really sit), <size>-<name>-full.png is the
 * whole scroll.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startDevServer } from '../dev/server';
import { Client, tournamentConfig } from '../tests/support/client';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');

const OUT = new URL('../screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = await startDevServer({ quiet: true, timeScale: 1 });
const host = await Client.register(server.url, 'mara', 'Mara Quill');
const pals = await Promise.all(['dex', 'juno', 'ike'].map((h, i) => Client.register(server.url, h, ['Dex Rowe', 'Juno Park', 'Ike Vance'][i])));

const cfg = tournamentConfig({
  title: 'Dock Nine Invitational',
  payout: { structure: 'HYBRID', stageAwardCents: 2500, finalAwardCents: 10000 },
  specialAwards: [{ id: 'a1', type: 'FIRST_STAGE', label: 'First Blood', amountCents: 1500 }],
  stages: 12,
});
const t = (await host.api('POST', '/api/tournaments', { config: cfg })).data;
for (const p of pals) await p.api('POST', '/api/join', { code: t.invite.code });

const browser = await chromium.launch();
const SIZES = {
  se: { name: 'se', width: 375, height: 667, mobile: true },
  phone: { name: 'phone', width: 390, height: 844, mobile: true },
  max: { name: 'max', width: 430, height: 932, mobile: true },
  desk: { name: 'desk', width: 1280, height: 860, mobile: false },
};
const sizeArg = process.argv.find((a) => a.startsWith('--size='))?.slice(7) ?? (process.argv.includes('--desktop') ? 'desk' : 'phone');
const sizes = sizeArg.split(',').map((k) => SIZES[k as keyof typeof SIZES]).filter(Boolean);
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const pages: [string, string][] = [
  ['hub', '/'],
  ['join', '/join'],
  ['invite', `/j/${t.invite.code}`],
  ['sponsor', '/sponsor'],
  ['create-1', '/sponsor/new'],
  ['lobby', `/t/${t.id}`],
  ['results-missing', '/t/nope'],
  ['library', '/games'],
  ['game-suited', '/games/suited-up'],
  ['ranks', '/ranks'],
  ['profile', '/me'],
  ['settings', '/settings'],
];

for (const sz of sizes) {
  const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: 2, isMobile: sz.mobile, hasTouch: sz.mobile });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${server.url}/auth`);
  await page.waitForTimeout(400);
  if (!only.length || only.includes('auth')) await page.screenshot({ path: `${OUT}${sz.name}-auth.png` });
  await page.evaluate(([token, user]) => localStorage.setItem('tp.session.v1', JSON.stringify({ token, user })), [host.token, host.user] as const);

  for (const [name, path] of pages) {
    if (only.length && !only.includes(name)) continue;
    await page.goto(`${server.url}${path}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}${sz.name}-${name}.png` });
    await page.screenshot({ path: `${OUT}${sz.name}-${name}-full.png`, fullPage: true });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 0) console.log(`horizontal overflow on ${sz.name}-${name}: ${wide}px`);
  }
  if (!only.length || only.includes('sheets')) {
    await page.goto(`${server.url}/t/${t.id}`);
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Players', exact: true }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}${sz.name}-sheet-players.png` });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.waitForTimeout(350);
    await page.getByLabel('Message').last().fill('Doors open at nine. Bring your A game.');
    await page.getByRole('button', { name: 'Send' }).last().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${sz.name}-sheet-chat.png` });
    await page.getByRole('button', { name: 'Close' }).click();
  }
  if (!only.length || only.includes('lobby-player')) {
    await page.evaluate(([token, user]) => localStorage.setItem('tp.session.v1', JSON.stringify({ token, user })), [pals[0].token, pals[0].user] as const);
    await page.goto(`${server.url}/t/${t.id}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}${sz.name}-lobby-player.png` });
    await page.screenshot({ path: `${OUT}${sz.name}-lobby-player-full.png`, fullPage: true });
    await page.evaluate(([token, user]) => localStorage.setItem('tp.session.v1', JSON.stringify({ token, user })), [host.token, host.user] as const);
  }
  if (errors.length) console.log(`console errors (${sz.name}):\n  ${[...new Set(errors)].join('\n  ')}`);
  await ctx.close();
}
await browser.close();
await server.close();
console.log(`screenshots in ${OUT}`);
process.exit(0);
