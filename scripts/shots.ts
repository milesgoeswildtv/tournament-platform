/**
 * Visual QA: renders the main screens at phone and desktop sizes and saves
 * screenshots to screens/ (git-ignored). Uses the local dev server and
 * Playwright's bundled Chromium.
 *
 *   node --experimental-sqlite --import tsx scripts/shots.ts
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
const sizes = process.argv.includes('--desktop') ? [{ name: 'desk', width: 1280, height: 860, mobile: false }] : [{ name: 'phone', width: 390, height: 844, mobile: true }];
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const pages: [string, string][] = [
  ['hub', '/'],
  ['join', '/join'],
  ['invite', `/j/${t.invite.code}`],
  ['sponsor', '/sponsor'],
  ['create-1', '/sponsor/new'],
  ['lobby', `/t/${t.id}`],
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
    await page.screenshot({ path: `${OUT}${sz.name}-${name}.png`, fullPage: true });
  }
  if (errors.length) console.log(`console errors (${sz.name}):\n  ${[...new Set(errors)].join('\n  ')}`);
  await ctx.close();
}
await browser.close();
await server.close();
console.log(`screenshots in ${OUT}`);
process.exit(0);
