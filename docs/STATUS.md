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
- **Visual identity: the venue** ([DESIGN.md](DESIGN.md)). Four materials (concrete, steel, paper, tape) and a fight-night **bill** for every tournament: on the invite, the lobby, the wizard's review step and the results page. The lobby is a live event: the bill, a players-in count that slams on each arrival, name plates with connection lamps, and a tear-off invite ticket. Each game has its own light and object (paint stripes, a split-flap counter, a ticket, letter tiles, dealer cards, a gauge, a task card). Final standings are a scoreboard with the prize inline. The app icon is the tape mark, rendered from the real fonts.
- **Design-system guard in the build:** undefined CSS-module classes, inline style objects and raw colors outside tokens fail `build:web` (and so CI). There are zero inline style objects in the app.
- Mobile-first with desktop supported. Generated music and sound effects, plus haptics.
- **CI/CD workflow:** tests, then D1 migrations, Worker + Durable Object, Pages, Telegram and a smoke test. Commits tagged `[verify-prod]` then play a full two-player tournament in a phone-sized browser against the live deployment.
- **Deployed on Cloudflare** (deploys from `main` on every push):
  - App (Pages): https://tournament-platform-9fd.pages.dev
  - API (Worker + Durable Object): https://tournament-platform-api.afterdarklabs.workers.dev (`/api/health` reports `telegram: true`)
  - D1 database `tournament-platform` (`313336d1-b81f-4eb3-9aef-cc99cd32fc02`, ENAM)

## Test results (local)

| Suite | Result |
| --- | --- |
| `test:unit`: games, ties, payouts, config, lineups, room state machine, timers, late entry, permissions, duplicates, reconnection state, DO restart, Telegram `initData` | **71 / 71 pass** |
| `test:integration` (18 tests): real Worker + Durable Object over HTTP and WebSocket. Covers accounts, the complete 4-player acceptance tournament (every game, hybrid payout, special awards), invite limits, expiry and regeneration, public/private, player cap, config versioning and locking, abort and cancel, sponsor disconnect, DO restart mid-run, duplicate/late/stale submissions, disconnect without stalling the round, reconnect, late entry and cutoff, all 7 games with 6 simultaneous players, and rate limits, Telegram sign-in + linking + webhook secret | **18 / 18 pass** |
| `test:ui`: Chromium at 390×844, 375×667 and 1280×860. Sponsor signs up and builds the tournament in the wizard; a second player joins from the invite link; both see the same list and countdown; both play all 10 stages by tapping; both devices show the same final standings (rank by rank) and prizes; results, audit, history and leaderboard. No console errors and no horizontal overflow | **pass** |
| `test:telegram-ui`: the Mini App opened the way Telegram opens it (signed `initData` in the URL hash, an invite as the start parameter) → server-validated sign-in → deep link → join | **pass** |
| Web bundle secret check (no Decode answers or Speedrun tasks in client JS) | **pass** |
| Design-system guard (`check:design`): 36 components, every module class defined, no inline style objects, colors from tokens | **pass** |
| Visual review: every screen and every game phase screenshotted at 375×667, 390×844 and 1280×860 and reviewed; static screens also at 430×932 (`npm run shots`) | **done** |
| Typecheck: engine + worker, and web against the real `@types/react` (CI) | **pass** |

All of the above also run in GitHub Actions on every push.

**Production:** the *Verify production* workflow (a full two-player tournament in a phone-sized browser against the live app and API, with fresh QA accounts and real server timers) passed on `b2730de`, the current design, and on `cdd6441` and `ee62760` before it. The live site serves the same stylesheet (by content hash) that was screenshotted and reviewed.

## Known defects and limitations

- **The Mini App hasn't been opened from inside the real Telegram app during the build.** The bot token is configured on the live API, and validation is covered by unit tests with independently signed payloads plus a browser test that opens the app the way Telegram does.
- Players get a bill, tags and a scoreboard sized for up to about 60 visible names; a 200-player lobby scrolls the tag grid (by design) and hides the in-round field dots above 60.
- Prize amounts are **commitments only**, by design. There is no payment processing.
- No password reset or email. Accounts are username + password, or Telegram.
- There's no scheduled start time. Sponsors start manually.
- The HTTP rate limiter uses fixed windows in D1. That's adequate for MVP traffic, but it isn't a global token bucket.
- On iOS, the ring/silent switch mutes WebAudio, so music and effects are silent in silent mode.

## Blockers / required owner actions

None are blocking. Cloudflare and Telegram secrets are in place, and deploys run from `main`.

1. **Recommended:** open the bot in Telegram on your phone, tap the Mini App button and play a short tournament with a second account, to confirm the in-Telegram experience end to end.
2. **Optional:** set `ADMIN_HANDLES` in `wrangler.jsonc` to your username to get the admin page.
3. **Optional:** add the app to your iPhone home screen (Share → Add to Home Screen). It opens standalone with the NAME TBD tape icon.

## Unfinished / next

- A wider Speedrun task library, and more Decode puzzles (currently a controlled MVP set).
- A permanent product name: the tape mark is the placeholder. Swapping the name means replacing `TapeMark` and re-running `npm run icons`.
