# Adding a game

The tournament engine (`shared/src/room.ts`) runs stages, rounds, timers, eligibility, eliminations and results without knowing how any game works. A game is one module implementing `GameDefinition` (`shared/src/games/common.ts`), plus one UI component pair. Nothing else changes.

## 1. Rules text: `shared/src/games/meta.ts`

Add an entry to `GAME_META_DATA` and the id to `GAME_IDS` in `shared/src/types.ts`:

```ts
'odd-one-out': {
  id: 'odd-one-out',
  name: 'Odd One Out',
  tagline: 'Pick what nobody else picks.',
  description: 'Choose a number 1–9. Unique picks survive.',
  instructions: ['…', '…'],          // shown on the stage intro and in the library
  minPlayers: 1, maxPlayers: 1000,
  maxRounds: 5,                      // hard cap on internal rounds for one stage
  roundNoun: 'Round',                // what one round is called ("Draw", "Hand", "Run")
  winRule: 'Last player standing wins the stage.',
  tieRule: 'Still tied after 5 rounds: shared stage win.',   // always explicit
},
```

Rules text lives here, apart from the logic, so the browser can show it without bundling game internals.

## 2. Logic: `shared/src/games/oddOneOut.ts`

```ts
export const oddOneOut: GameDefinition<S> = {
  meta: GAME_META_DATA['odd-one-out'],
  init(players, ctx)             // new stage: build state for these participants
  startRound(s, timing, ctx)     // a round opens (deal private numbers here, not at resolve)
  act(s, playerId, action, ctx)  // validate one player action → { ok, state } | { ok:false, error }
  roundReady(s)                  // true when every alive player is done → round closes early
  resolveRound(s, ctx)           // timer expired or all done: draw outcomes, return eliminations + reveal
  outcome(s)                     // stage over: winners (may be shared or empty), full ranking, metrics
  publicView(s)                  // what everyone may see DURING a round — no secrets
  playerView(s, playerId)        // what this player may see (their own pick, hand, …)
  // optional: internalDeadline(s) / onInternalDeadline(s) for a server event mid-round
}
```

Rules of the road:

- **Pure functions.** Take `ctx.now` and `ctx.rng` from the engine. Never read the clock or call `Math.random`. The engine passes the secure RNG in production and a seeded one in tests.
- **Validate everything** in `act`: types, ranges, one submission per round (`already_submitted`). The engine already rejects late, stale, eliminated and non-member actions, so don't repeat those checks.
- **Draw secrets as late as possible** (usually in `resolveRound`) and never return them from `publicView` while a round is open.
- Use `applySurvival(s, verdicts, reveal)` for pass/fail rounds. It applies the shared *no wipeout* rule, the round cap and the bookkeeping. Use `survivalRanking` for the standard ranking.
- Return useful `metrics` (`roundsSurvived` at minimum) so special awards and standings can read them.
- Add error messages for any new error codes to `ERROR_TEXT` in `shared/src/protocol.ts`.

Register it in `shared/src/games/index.ts` (`GAMES`).

## 3. UI: `web/src/games/OddOneOut.tsx`

Export `Play` and `Reveal` components (`PlayProps` and `RevealProps` in `web/src/games/types.ts`), then register them in `web/src/games/index.ts`. Use `ActionBar` for the lock-in button and confirmation, and `Spectating` for players who aren't in the round. The room supplies the timer, standing count, verdict stamp and layout. Draw only your board, and fit a 375×667 screen without scrolling.

Add an emblem and accent in `web/src/ui/GameMark.tsx`.

## 4. Tests

- Rules: add a `describe` block to `tests/games.test.ts` (valid/invalid actions, duplicates, the tie rule, the reveal not leaking secrets).
- Full runs: the `10 stages of <game> …` loop in `tests/room.test.ts` and `each game resolves correctly with simultaneous players` in `tests/integration.test.ts` pick up every id in `GAME_IDS` automatically. Teach the bots (`tests/helpers.ts` and `tests/support/bots.ts`) one valid action.
- Browser: add a case to `act()` in `scripts/e2e-ui.ts`.

If the game has an answer library, add a probe for it to `scripts/build-web.mjs` so a leak fails the build.
