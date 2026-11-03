# SHYST

Sponsors put up prizes and configure a tournament of 10–25 **stages**. Each stage is one **game**, and a game may run several internal **rounds**. Players join with an invite, play every stage live on their phones, and the server decides every outcome. Results, standings and prize allocations are recorded as an append-only audit trail.

SHYST is the product name. Infrastructure identifiers (the `tournament-platform` repository, Cloudflare Pages project, Worker and D1 database, and their URLs) keep their original names so existing deployments, data and links keep working.

> Prize amounts are **sponsor commitments**. The platform records them and calculates who earns them. It does not take deposits, hold money or make payments; every allocation is stored as `COMMITTED_UNPAID`.

## Live

- App: https://tournament-platform-9fd.pages.dev
- API: https://tournament-platform-api.afterdarklabs.workers.dev (`/api/health`)

Every push to `main` tests, migrates D1 and deploys both. See [docs/STATUS.md](docs/STATUS.md) for test results and known limitations, and [docs/DESIGN.md](docs/DESIGN.md) for the design system.

## Stack

| Piece | Tech |
| --- | --- |
| Web app | React 19 + TypeScript, built with esbuild (Vite config included), deployed to **Cloudflare Pages** |
| API | **Cloudflare Worker** (`worker/src`), small router, no framework |
| Live rooms | **Durable Object** `TournamentRoom`, one per tournament: hibernating WebSockets, alarms for every timer |
| Database | **Cloudflare D1** (`migrations/`) |
| Game + tournament engine | Pure TypeScript in `shared/src`, shared by the Worker and tests |
| Telegram | Mini App sign-in (server-side `initData` validation), bot webhook, notifications |

## Architecture

```
browser ──HTTPS──► Worker (worker/src/index.ts)
   │                 ├─ auth.ts        accounts, sessions, Telegram sign-in
   │                 ├─ players.ts     profiles, stats, leaderboards, inbox
   │                 ├─ tournaments.ts create/edit/join/invites/results/audit
   │                 ├─ bot.ts         Telegram webhook (/start, /join, /help)
   │                 └─ notify.ts      in-app + Telegram notifications
   │
   └──WebSocket──► TournamentRoom DO (worker/src/room.ts)
                     ├─ RoomCore (shared/src/room.ts)   phases, timers, eligibility, stages
                     ├─ games (shared/src/games/*)      one module per game, common interface
                     ├─ results (shared/src/results.ts) standings, ties, payouts, special awards
                     └─ persist.ts → D1                 every event, idempotent, append-only
```

The server is the only authority:

- Clients send intents (`{t:'act', stage, round, action}`) and nothing else. The room decides whether a submission is on time, valid and not a duplicate.
- All timers are server deadlines driven by Durable Object alarms: the countdown, stage intro, rounds, reveals and results. A disconnected client cannot extend or skip one.
- Every competitive random draw uses `crypto.getRandomValues` with rejection sampling (`shared/src/rng.ts`). This covers colors, house numbers, rerolls, dealer suits, break points, puzzles, tasks, lineups and stage timers.
- Each player receives a personalised view. Secrets such as the winning color, the break point, other players' numbers and puzzle answers only appear after the round resolves.
- Room state is persisted to Durable Object storage after every change, so a restart resumes mid-round. Events go to D1 through an outbox that retries until written.
- The web bundle never contains puzzle answers or task libraries. `scripts/build-web.mjs` fails the build if any leak in.

### Product rules decided during the build

These were unspecified in the brief. Each is easy to change.

- **Elimination is per stage.** Everyone eligible starts each stage fresh, and the game eliminates players until it names the stage winner. Stage wins accumulate across the tournament.
- **Ties.** Each game states its tie rule (Game library, and the intro screen before every stage). A game that genuinely can't separate players produces a shared stage win, and shared awards split to the cent. Leftover cents go one each to the earliest joiners.
- **Final standings** order players by stage wins, then outright (unshared) stage wins, then rounds survived. Players still level share the place.
- **No wipeouts.** If every remaining player fails a round, the round is void and replays. Each game caps its rounds.
- **The host can compete.** This is a toggle at creation, on by default. When it's off, the host watches and can't win.
- **Late entry** is only offered with *Per stage winner* payouts, up to a sponsor-chosen stage. A late entrant is eligible from the next stage and is never paid for earlier stages.
- **Sponsors can edit settings while the lobby is open.** Every saved version is kept in `config_history`. Settings and award criteria lock when the countdown starts.
- **Lobbies expire** after 72 hours unstarted, and the tournament is marked abandoned. Sponsors can cancel a lobby or stop a countdown. Once stage 1 starts, the tournament always runs to the end, even if the sponsor disconnects.

## Repository layout

```
shared/src/        engine: types, config validation, rng, room state machine, results/payouts
shared/src/games/  one file per game + meta.ts (rules text) + common.ts (the game interface)
worker/src/        Cloudflare Worker + Durable Object
migrations/        D1 schema (with immutability triggers on audit tables)
web/               React app (src/), static assets (public/), index.html
dev/               local Workers runtime (D1 on node:sqlite, DOs, WebSockets) + dev server
tests/             unit tests, multiplayer integration tests, test bots
scripts/           web build, browser E2E, screenshots, Telegram setup
docs/              ADDING_A_GAME.md, STATUS.md, DESIGN.md
```

## Run it locally

Requirements: Node 22.5+.

```bash
npm install
npm run build:web
npm run dev:local                    # API + rooms + web on http://localhost:8787
TIME_SCALE=0.2 npm run dev:local     # same, with every room timer 5× faster (dev only)
```

`dev:local` runs the real Worker and Durable Object code on a Node stand-in for the Workers runtime (`dev/runtime.ts`), with D1 on `node:sqlite`. It needs no Cloudflare account and no network.

To use Cloudflare's own runtime instead, run `npm run dev:api` (wrangler, `--env dev`) and `npm run dev:web` (Vite on :5173, which proxies `/api`).

To make an account an admin, register it with a handle listed in `ADMIN_HANDLES` (`admin` locally). Admins see `/admin` and every audit log.

## Tests

```bash
npm run test:unit          # 71 tests: every game's rules, ties, payouts, config, lineups, room state machine
npm run test:integration   # 18 tests: real Worker + DO over HTTP/WebSocket, multiple simultaneous players
npm run build:web && npm run test:ui   # browser E2E at phone size: full tournament through the UI
npm run shots              # screenshots of the main screens into screens/
```

Test results and coverage are summarised in [docs/STATUS.md](docs/STATUS.md).

## Deployment

CI (`.github/workflows/ci.yml`) runs every test on each push. On `main` it then deploys:

1. Creates the Pages project `tournament-platform` if needed, then resolves the Pages URL and the account's `workers.dev` subdomain.
2. Applies D1 migrations to `tournament-platform` (id `313336d1-b81f-4eb3-9aef-cc99cd32fc02`, already created).
3. Deploys the Worker `tournament-platform-api` (API + Durable Object) with `APP_URL` set to the Pages URL.
4. Sets the Telegram secrets and configures the bot, if a bot token is present.
5. Builds the web app with `VITE_API_URL` pointing at the Worker, deploys it to Pages, and smoke-tests both.

### Required secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Required | What |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | yes | API token with **Workers Scripts: Edit**, **D1: Edit**, **Cloudflare Pages: Edit**, **Account Settings: Read** (the "Edit Cloudflare Workers" template plus D1 and Pages) |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Your Cloudflare account ID (Workers & Pages → right sidebar) |
| `TELEGRAM_BOT_TOKEN` | no | From @BotFather. Without it, everything works in the browser; Telegram sign-in returns "not configured". |

No secret is stored in the repo. The Worker's Telegram secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`) are written by CI with `wrangler secret put`. The webhook secret is derived from the bot token.

Optional Worker vars, set in `wrangler.jsonc`: `ADMIN_HANDLES` (comma-separated login names that become admins at registration), `ALLOWED_ORIGINS` (extra CORS origins such as a custom domain) and `TELEGRAM_MINIAPP_SHORTNAME` (if you register a named Mini App with BotFather `/newapp`, invite links become `t.me/<bot>/<name>?startapp=CODE`).

### Telegram bot

1. In Telegram, message **@BotFather**: `/newbot`, then pick a name and a username. Copy the token.
2. Add it as the `TELEGRAM_BOT_TOKEN` repo secret and re-run the workflow (Actions → CI / Deploy → Run workflow).
3. CI registers the webhook, the `/start` `/join` `/help` commands and a **Play** menu button that opens the Mini App.
4. Optional: `/setdomain` in BotFather with your Pages domain, and `/newapp` to get a direct `t.me/<bot>/<app>` link.

Sign-in inside Telegram uses the Mini App's signed `initData`. The Worker verifies its HMAC with the bot token and rejects anything older than 24 hours. A signed-in browser account that then opens the Mini App gets the Telegram account linked to it.
