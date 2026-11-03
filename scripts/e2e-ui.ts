/**
 * Browser end-to-end test at phone size (390×844, touch). Runs the final
 * acceptance flow through the real UI:
 *
 *   sponsor signs up → creates a tournament in the wizard (hybrid payout,
 *   manual lineup with every game, custom timers) → lobby → second player
 *   opens the invite link, signs up, joins → both see the same players →
 *   sponsor starts → both see the same countdown → both play every stage by
 *   tapping the UI → final standings and prize allocation → results, audit,
 *   history, leaderboard pages.
 *
 * A third player joins over the websocket API as a bot. Screenshots of every
 * screen land in screens/e2e-*.png for visual review.
 *
 *   npm run build:web && npm run test:ui
 *
 * Against a deployment (real timers, fresh QA accounts, no server peeking):
 *   E2E_APP_URL=https://….pages.dev E2E_API_URL=https://….workers.dev npm run test:ui
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startDevServer } from '../dev/server';
import { Client } from '../tests/support/client';
import { autoplay } from '../tests/support/bots';
import { GAME_IDS } from '../shared/src/index';
import { DECODE_PUZZLES } from '../shared/src/games/decodeLibrary';
import type { Page } from 'playwright';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');

const SCALE = Number(process.env.TIME_SCALE ?? 0.25);
const OUT = new URL('../screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const REMOTE = !!process.env.E2E_APP_URL;
const server = REMOTE ? null : await startDevServer({ quiet: true, timeScale: SCALE });
const APP = (process.env.E2E_APP_URL ?? server!.url).replace(/\/$/, '');
const API = (process.env.E2E_API_URL ?? server!.url).replace(/\/$/, '');
const sfx = REMOTE ? `_${Math.random().toString(36).slice(2, 7)}` : '';
const NAMES = REMOTE ? { host: 'QA Sponsor', player: 'QA Player', bot: 'QA Bot' } : { host: 'Mara Quill', player: 'Dex Rowe', bot: 'Ike Vance' };
const TITLE = REMOTE ? 'Production smoke test' : 'Acceptance Night';
if (REMOTE) console.log(`remote run against ${APP} (API ${API})`);
const browser = await chromium.launch();
const [vw, vh] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number);
const device = { viewport: { width: vw, height: vh }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors: string[] = [];
const shots = new Set<string>();

async function open(label: string) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|401|409|410/.test(m.text())) errors.push(`${label}: ${m.text()}`);
  });
  return page;
}

const overflow: string[] = [];
async function shot(page: Page, name: string, full = false) {
  if (shots.has(name)) return;
  shots.add(name);
  await page.screenshot({ path: `${OUT}e2e-${name}.png`, fullPage: full }).catch(() => {});
  // Layout check: nothing may push the page wider than the phone.
  const wide = await page
    .evaluate(() => {
      const w = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= w) return null;
      const bad = [...document.querySelectorAll('body *')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          if (r.right <= w + 1 || getComputedStyle(e).position === 'fixed') return false;
          for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false;
          }
          return true;
        })
        .slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} (${Math.round(e.getBoundingClientRect().right)}px)`);
      return `${document.documentElement.scrollWidth}px > ${w}px: ${bad.join(', ')}`;
    })
    .catch(() => null);
  if (wide) overflow.push(`${name}: ${wide}`);
}

async function signUp(page: Page, handle: string, name: string) {
  await page.getByRole('radio', { name: 'Create account' }).click();
  await page.getByLabel('Username').fill(handle);
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Create account' }).click();
}

const attr = (page: Page, a: string) => page.locator('[data-phase]').first().getAttribute(a).catch(() => null);

// ------------------------------------------------------------------ sponsor creates the tournament

const A = await open('sponsor');
await A.goto(`${APP}/auth`);
await shot(A, '01-auth');
await signUp(A, `qa_host${sfx}`, NAMES.host);
await A.waitForURL(`${APP}/`);
await A.getByText('Join with a code').waitFor();
await shot(A, '02-hub');
log('sponsor signed up');

await A.goto(`${APP}/sponsor`);
await A.getByRole('link', { name: 'New tournament' }).click();
await A.getByLabel('Tournament name').fill(TITLE);
await shot(A, '03-create-basics');
await A.getByRole('button', { name: 'Next: Prizes' }).click();
await A.getByRole('radio', { name: /Hybrid/ }).click();
await A.getByLabel('Award per stage winner').fill('5');
await A.getByLabel('Final award (most stage wins)').fill('20');
await A.getByRole('button', { name: 'Add a special award' }).click();
await shot(A, '04-create-prizes', true);
await A.getByRole('button', { name: 'Next: Stages' }).click();
await A.getByRole('radio', { name: 'Pick each stage' }).click();
// Remote runs use real timers, so the lineup favours games that close as soon as everyone acts.
const QUICK = ['zero-hour', 'pressure-cooker', 'guess-color', 'suited-up', 'high-low'] as const;
const lineup = Array.from({ length: 10 }, (_, i) => (REMOTE ? QUICK[i % QUICK.length] : GAME_IDS[i % GAME_IDS.length]));
for (let i = 0; i < 10; i++) await A.getByLabel(`Stage ${i + 1} game`).selectOption(lineup[i]);
await shot(A, '05-create-stages', true);
await A.getByRole('button', { name: 'Next: Timing' }).click();
for (let i = 0; i < 5; i++) await A.getByRole('button', { name: 'Decrease minimum seconds' }).click();
for (let i = 0; i < 15; i++) await A.getByRole('button', { name: 'Decrease maximum seconds' }).click();
await shot(A, '06-create-timing');
await A.getByRole('button', { name: 'Next: Review' }).click();
await A.getByText('Total prize commitment').waitFor();
await shot(A, '07-create-review', true);
await A.getByRole('button', { name: 'Create tournament' }).click();
await A.waitForURL(/\/t\/t_[a-z0-9]+$/);
const tid = A.url().split('/').pop()!;
const codeEl = A.locator('[aria-label^="Invite code"]');
await codeEl.waitFor();
const code = (await codeEl.textContent())!.trim();
assert.match(code, /^[A-Z2-9]{8}$/);
await shot(A, '08-lobby-host', true);
log('tournament created', tid, 'invite', code);

// ------------------------------------------------------------------ second player joins from the invite

const B = await open('player');
await B.goto(`${APP}/j/${code}`);
await B.getByText(TITLE).waitFor();
await shot(B, '09-invite-signed-out');
await B.getByRole('link', { name: 'Create account to join' }).click();
await signUp(B, `qa_player${sfx}`, NAMES.player);
await B.waitForURL(`${APP}/j/${code}`);
await B.getByRole('button', { name: 'Join tournament' }).click();
await B.waitForURL(`${APP}/t/${tid}`);
log('player joined via invite link');

// third player: a bot over the API
const C = await Client.register(API, `qa_bot${sfx}`, NAMES.bot);
assert.equal((await C.api('POST', '/api/join', { code })).status, 200);
await C.connect(tid);
const peek = () => (server?.env.ROOMS.states.get(tid)?.storage as any)?.snapshot()?.room;
const stopBot = autoplay(C, { peek, skill: 0.5 });

const names = async (p: Page) => (await p.locator('[data-phase="LOBBY"] [data-player]').evaluateAll((els) => els.map((e) => e.getAttribute('data-player') ?? ''))).sort();
await A.getByText('3 of 50').waitFor();
await B.getByText('3 of 50').waitFor();
assert.deepEqual(await names(A), await names(B));
assert.deepEqual(await names(A), [NAMES.host, NAMES.player, NAMES.bot].sort());
await shot(B, '10-lobby-player', true);
log('both see the same player list:', (await names(A)).join(', '));

// chat
await B.getByRole('button', { name: 'Chat' }).click();
await B.getByLabel('Message').fill('Ready when you are.');
await B.getByRole('button', { name: 'Send' }).click();
await A.getByRole('button', { name: /Ready when you are/ }).waitFor();
await shot(B, '11-chat');
await B.getByRole('button', { name: 'Close' }).click();

// ------------------------------------------------------------------ start + countdown

await A.getByRole('button', { name: /Start tournament/ }).click();
await Promise.all([A, B].map((p) => p.locator('[data-phase="COUNTDOWN"]').waitFor()));
const secs = async (p: Page) => Number((await p.getByRole('timer').first().getAttribute('aria-label'))!.split(' ')[0]);
const [ca, cb] = await Promise.all([secs(A), secs(B)]);
assert.ok(Math.abs(ca - cb) <= 1, `countdowns differ: ${ca} vs ${cb}`);
await shot(A, '12-countdown');
log(`countdown on both devices: ${ca}s / ${cb}s`);

// ------------------------------------------------------------------ play every stage through the UI

const rnd = (n: number) => Math.floor(Math.random() * n);

async function act(p: Page, who: string, game: string, smart: boolean) {
  const room = peek();
  switch (game) {
    case 'guess-color': {
      const cans = p.getByRole('radiogroup', { name: 'Colors' }).getByRole('button');
      await cans.nth(rnd(5)).click();
      return p.getByRole('button', { name: /^Lock in/ }).click();
    }
    case 'zero-hour': {
      for (const d of String(10 + rnd(60))) await p.getByRole('group', { name: 'Number pad' }).getByRole('button', { name: d, exact: true }).click();
      return p.getByRole('button', { name: /^Lock in/ }).click();
    }
    case 'high-low': {
      const n = Number(await p.locator('[data-number]').getAttribute('data-number'));
      await p.getByRole('button', { name: n >= 50 ? /^High/ : /^Low/ }).click();
      return p.getByRole('button', { name: /^Lock (High|Low)/ }).click();
    }
    case 'decode': {
      const answer = smart && room?.stage?.game ? DECODE_PUZZLES[room.stage.game.puzzleIndex].answer.toLowerCase() : 'no idea';
      await p.getByLabel('Your guess').fill(answer);
      return p.getByRole('button', { name: 'Guess' }).click();
    }
    case 'suited-up': {
      await p.getByRole('radiogroup', { name: 'Suits' }).getByRole('button').nth(rnd(4)).click();
      return p.getByRole('button', { name: /^Lock in/ }).click();
    }
    case 'pressure-cooker': {
      await p.waitForTimeout(150 + rnd(600));
      const btn = p.getByRole('button', { name: 'Cash out' });
      if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
      return;
    }
    case 'speedrun': {
      const task = room?.stage?.game?.task;
      const answer = smart && task ? String(task.answer) : 'nope';
      const choices = p.getByRole('group', { name: 'Answers' });
      if (await choices.isVisible().catch(() => false)) {
        const opts = choices.getByRole('button');
        const target = smart && task ? choices.getByRole('button', { name: answer, exact: true }) : opts.first();
        return target.click();
      }
      await p.getByLabel('Your answer').fill(answer);
      return p.getByRole('button', { name: 'Submit' }).click();
    }
  }
  void who;
}

async function play(p: Page, who: string, smart: boolean) {
  const acted = new Set<string>();
  for (;;) {
    const phase = await attr(p, 'data-phase');
    const game = (await attr(p, 'data-game')) ?? '';
    const key = `${await attr(p, 'data-stage')}:${await attr(p, 'data-round')}`;
    const status = await attr(p, 'data-status');
    if (phase === 'FINISHED') return;
    if (phase === 'STAGE_INTRO') await shot(p, `20-intro-${game}`);
    if (phase === 'STAGE_RESULT') await shot(p, '30-stage-result');
    if (phase === 'REVEAL') await shot(p, `22-reveal-${game}`);
    if (phase === 'ROUND' && status === 'alive' && !acted.has(key)) {
      acted.add(key);
      await shot(p, `21-play-${game}`);
      try {
        await act(p, who, game, smart);
        await p.waitForTimeout(120);
        await shot(p, `21-play-${game}-locked`);
      } catch (e) {
        // A round can legitimately close mid-action (early close, pressure break). Anything else surfaces in the final checks.
        log(`${who}: action in ${game} ${key} did not complete (${String(e).split('\n')[0].slice(0, 90)})`);
      }
    } else if (phase === 'ROUND' && status === 'out') {
      await shot(p, `23-spectating`);
    }
    await p.waitForTimeout(80);
  }
}

await Promise.all([play(A, 'sponsor', true), play(B, 'player', false)]);
stopBot();
log('tournament finished in the browser');

// ------------------------------------------------------------------ results

for (const p of [A, B]) {
  await p.getByRole('heading', { name: 'Standings' }).waitFor();
  await p.getByRole('heading', { name: 'Prizes' }).waitFor();
}
await shot(A, '40-final-host', true);
await shot(B, '41-final-player', true);

const finalNames = async (p: Page) => (await p.locator('table').first().locator('tbody tr td:nth-child(2)').allTextContents()).sort();
assert.deepEqual(await finalNames(A), [NAMES.host, NAMES.player, NAMES.bot].sort());
assert.deepEqual(await finalNames(A), await finalNames(B));

await A.getByRole('link', { name: 'Full results and stage history' }).click();
await A.getByText('Stage by stage').waitFor();
await shot(A, '42-results', true);
await A.goto(`${APP}/t/${tid}/audit`);
await A.getByText('Event history').waitFor();
await shot(A, '43-audit');

await B.goto(`${APP}/me`);
await B.getByText(TITLE).first().waitFor();
await shot(B, '44-profile', true);
await B.goto(`${APP}/ranks`);
await B.getByText(NAMES.player).first().waitFor();
await shot(B, '45-ranks');
await B.goto(`${APP}/`);
await B.getByText('History').waitFor();
await shot(B, '46-hub-after', true);

const res = await C.api('GET', `/api/tournaments/${tid}/results`);
assert.equal(res.data.tournament.status, 'FINISHED');
assert.equal(res.data.stages.length, 10);
assert.equal(res.data.allocations.reduce((n: number, a: any) => n + a.amount_cents, 0), 500 * 10 + 2000 + 500);

await C.disconnect();
await browser.close();
await server?.close();

if (overflow.length) {
  console.error(`horizontal overflow:\n  ${overflow.join('\n  ')}`);
  errors.push(...overflow);
}
if (errors.length) {
  console.error(`browser errors:\n  ${[...new Set(errors)].join('\n  ')}`);
  process.exit(1);
}
log(`✓ browser acceptance flow passed; ${shots.size} screenshots in screens/`);
process.exit(0);
