# Design system

The direction is an underground competitive venue: poured concrete, steel, and two kinds of work light. It is built to be read on a phone in a dark room, mid-round.

**Principle: the locker room and the floor.** The hub, profile, sponsor tools and settings are the locker room. They are quiet, left-aligned lists and plates with no decoration. The lobby, countdown, stage intro, gameplay and results are the floor. They are full-screen takeovers, each built around one focal element, with no bottom navigation and nothing scrolling during a round.

## Tokens: `web/src/styles/tokens.css`

All colors, type sizes, spacing, radii and motion come from here.

**Light is state:**

| Token | Hex | Means |
| --- | --- | --- |
| `--sodium` | `#F5A23A` | warm work light: live, your move, primary action, prizes |
| `--fluoro` | `#BDE2E4` | cold tube light: information, waiting, locked in, focus ring |
| `--go` | `#86D17A` | still standing |
| `--stop` | `#EE4B3B` | out, destructive, last five seconds |

**Ground:** `--void #060606`, `--char #151513`, `--slab #201F1C`, `--steel #34322D` (lines), `--grit #4B4841`.
**Ink:** `--chalk #ECE7DB`, `--dust #A39E92`, `--ash #75716A`.

The page background is one radial "work light" from the top over a fine concrete grain. It shifts red when you're eliminated and green when you survive a reveal (`body[data-light]`).

**Type:**

- **Big Shoulders Display**: headings and big numerals, set in caps.
- **Big Shoulders Stencil**: reserved for live moments only (countdown numbers, stage numbers, rubber-stamp verdicts, the CASH OUT plate). Never used for names or numbers that must be read precisely.
- **Barlow**: body and UI text. Inputs are ≥16px so iOS doesn't zoom.
- **Barlow Condensed**: labels, buttons and compact data, in sentence case.
- **IBM Plex Mono**: invite codes and player IDs only.

The scale is modular at 1.25. Spacing is a 4px grid. Touch targets are at least 48px, and primary game actions are 60–96px.

**Edges:** primary actions and key plates are steel plates with one cut corner. Controls get a 3px radius, status chips are round, and nothing has a drop shadow. Elevation comes from a 1px lit top edge (`--edge`).

**Motion** is mechanical and short (120–360ms). The memorable moments are the countdown digit "slam", the rubber stamp landing on OUT / STANDING / VOID, tiles flipping on a Decode reveal, and the dealer's cards dealing in. `prefers-reduced-motion` and the in-app "Reduce motion" setting turn all of it off.

## Components: `web/src/ui`

| File | Contents |
| --- | --- |
| `controls.tsx` | `Button` (primary / secondary / ghost / danger; sm / md / lg; busy), `IconButton`, `TextInput` (code, prefix), `Field`, `Segmented`, `Toggle`, `Stepper`, `vars()` |
| `layout.tsx` | `Page`, `PageHead`, `Section`, `Plate` (cut / live), `Rows`/`Row`, `Chip` (live / info / go / stop / muted), `Stats`, `Who`, `Spec`, `Empty`, `Loading`, `Note` |
| `shell.tsx` | `AppShell` (phone: top bar + bottom tabs; desktop: side rail), `Sheet` (bottom sheet / side panel), `Toasts`, `OfflineBanner`, `MusicButton` |
| `live.tsx` | `TimerBar` (server-clock, rAF-driven), `Stamp`, `Hazard`, `FieldDots`, `useSecondsLeft` |
| `GameMark.tsx` | per-game emblem + accent, `SuitGlyph` |
| `Icon.tsx` | 24px icon set: 2px stroke, square caps, mitred joins |

Each game owns its board under `web/src/games/*` and inherits the room's frame: the stage bar, timer, standing count, verdict and chat. Each game has its own accent (`GAME_ACCENT`) and object language: paint cans, a keypad and number line, a ticket, letter tiles, suit tokens and dealer cards, a pressure gauge, and a task card with a stopwatch.

## Sound

`web/src/lib/audio.ts` synthesizes everything with WebAudio, so there are no audio files and nothing to license. Music is a low drone, room tone, a slow kick and a shaker; it's off by default and can be turned on in the top bar or Settings. Effects play for taps, lock-ins, the last-five-second ticks, reveals, out, standing, cash-out and burst. Haptics use `navigator.vibrate`, or Telegram's HapticFeedback inside the Mini App.

## QA

`npm run test:ui` plays a full tournament in Chromium at phone size and screenshots every screen to `screens/`. It fails on console errors or any horizontal overflow. Run it with `VIEWPORT=375x667` to check the smallest supported phone; every game fits without scrolling there. `npm run shots` (add `--desktop` for desktop) renders the static screens.
