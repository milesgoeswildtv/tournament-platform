# Status

Last updated: 2026-11-03.

## Completed

- **Engine:** the tournament state machine runs lobby → 60s countdown → stage intro → rounds → reveal → stage result → finish, plus cancel, abandon and countdown abort. Every timer is a server deadline. It also handles stage eligibility, late entry with a cutoff, forfeits, disconnects and reconnects. Stages and game rounds are separate concepts.
- **Seven games, fully playable:** Guess the Color, Zero Hour (configurable %), Trust Yourself (High/Low with one reroll), Decode (3 rounds, clues, masked board), Suited Up (exact cycle and scoring), Pressure Cooker (server-held break point, server-time cash-outs) and Randomizer Speedrun (controlled task library across 7 task kinds, with a configurable elimination schedule: 1 / 1–2 / 1–3).
- **Common game interface** and docs ([ADDING_A_GAME.md](ADDING_A_GAME.md)). The engine loads games by id only.
- **Results:** stage winners, shared wins, standings with explicit tie-breakers, PER_STAGE / MOST_WINS / HYBRID payouts, 7 special-award criteria, cent-exact splits, unawarded lines, and late-entrant exclusion. Nothing is ever marked paid.
- **Accounts:** username and password (PBKDF2-SHA256, 100k iterations), bearer sessions stored hashed, logout, profile, public player ID, stats, history, leaderboards (4 metrics × 3 periods) and an in-app inbox.
- **Sponsor tools:** a 5-step creation wizard with live validation (shared with the server), lineup editing while in the lobby (versioned), invites with expiry, use limits and regeneration, start, abort, cancel, and a sponsor dashboard.
- **Live lobby:** players, host marker, connection dots, chat, invite panel and a sponsor-only Start.
- **Gameplay room:** stage/round/timer bar, standing count, field dots, submission confirmation, verdict stamps, per-game reveals, rules sheet, players sheet and forfeit.
- **Audit:** append-only `tournament_events` (gapless sequence), submissions with server receive times, eliminations with reasons, disconnects and reconnects, config history, and stage results. Database triggers refuse UPDATE/DELETE. There's an audit page for the sponsor and an admin page for everything.
- **Fair play:** server-side validation of every action, duplicate/late/stale rejection, rate limits (D1 for HTTP, a token bucket for WebSockets), invite-use accounting that returns a use when a join is refused, sponsor-only controls, and the player cap enforced inside the room.
- **Telegram:** `initData` HMAC validation, Mini App sign-in and account linking, bot webhook (`/start [code]`, `/join CODE`, `/help`), notifications for countdown and final results, and the setup script.
- **Design system and every screen**, mobile-first with desktop supported; see [DESIGN.md](DESIGN.md). Generated music and sound effects, plus haptics.
- **CI/CD workflow:** tests, then D1 migrations, Worker + Durable Object, Pages, Telegram and a smoke test.
- **Created in Cloudflare:** D1 database `tournament-platform` (`313336d1-b81f-4eb3-9aef-cc99cd32fc02`, ENAM).

## Test results (local)

| Suite | Result |
| --- | --- |
| `test:unit`: games, ties, payouts, config, lineups, room state machine, timers, late entry, permissions, duplicates, reconnection state, DO restart, Telegram `initData` | **71 / 71 pass** |
| `test:integration` (18 tests): real Worker + Durable Object over HTTP and WebSocket. Covers accounts, the complete 4-player acceptance tournament (every game, hybrid payout, special awards), invite limits, expiry and regeneration, public/private, player cap, config versioning and locking, abort and cancel, sponsor disconnect, DO restart mid-run, duplicate/late/stale submissions, disconnect without stalling the round, reconnect, late entry and cutoff, all 7 games with 6 simultaneous players, and rate limits, Telegram sign-in + linking + webhook secret | **18 / 18 pass** |
| `test:ui`: Chromium at 390×844 and 375×667. Sponsor signs up and builds the tournament in the wizard; a second player joins from the invite link; both see the same list and countdown; both play all 10 stages by tapping; final standings and prizes; results, audit, history and leaderboard. No console errors and no horizontal overflow | **pass** |
| Web bundle secret check (no Decode answers or Speedrun tasks in client JS) | **pass** |

## Known defects and limitations

- The **web typecheck** was verified locally only against a minimal React type shim, because the npm registry was unreachable from the build environment. CI checks against the real `@types/react`, so the first run may surface type-only errors. They don't affect the build: esbuild strips types.
- **Not yet run on real Cloudflare.** The Worker and Durable Object were exercised on a faithful Node stand-in (`dev/runtime.ts`) because the Cloudflare API was blocked from the build environment. The first CI deploy is the first run on workerd.
- **Telegram has never been tested against live Telegram** (no bot token yet). Validation is covered by unit tests with independently signed payloads.
- Prize amounts are **commitments only**, by design. There is no payment processing.
- No password reset or email. Accounts are username + password, or Telegram.
- The lobby on desktop is a single centered column. It works, but doesn't use the extra width.
- There's no scheduled start time. Sponsors start manually.
- The HTTP rate limiter uses fixed windows in D1. That's adequate for MVP traffic, but it isn't a global token bucket.
- On iOS, the ring/silent switch mutes WebAudio, so music and effects are silent in silent mode.

## Blockers / required owner actions

1. **Add GitHub repo secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; README › Deployment lists the token permissions. Then run *Actions → CI / Deploy → Run workflow*. Deployment is blocked until then.
2. **Optional:** create a bot with @BotFather and add `TELEGRAM_BOT_TOKEN`, then re-run the workflow.
3. **Optional:** set `ADMIN_HANDLES` in `wrangler.jsonc` to your username before registering, to get the admin page.

## Unfinished / next

- Verify the deployed app end to end on a phone once secrets are in place. CI smoke-tests the health endpoint, the page and CORS.
- A wider Speedrun task library, and more Decode puzzles (currently a controlled MVP set).
- A two-column desktop lobby with inline chat.
