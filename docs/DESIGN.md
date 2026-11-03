# Design system

**Concept: the venue.** The product is an underground tournament held in a disused industrial space. The hub is the front wall where events are posted. The lobby is the room filling up before the event. The floor is the event itself, under work lights. Results are the scoreboard. Everything is built to be read on a phone in a dark room, mid-round.

**Principle: the locker room and the floor.** The hub, profile, sponsor tools and settings are the locker room: quiet, left-aligned, no decoration. The lobby, countdown, stage intro, gameplay and results are the floor: full-screen takeovers, each built around one focal element, with no tab bar and nothing scrolling during a round.

## Four materials, nothing else

| Material | Where | Built from |
| --- | --- | --- |
| **Concrete** | the ground everything sits on | `body::before`: the work-light falloff, a fine grain, long scuffs and a dark vignette |
| **Steel** | controls and panels | `--char` / `--slab` / `--steel`, with a 1px lit top edge (`--edge`). No drop shadows. Grating (two fine diagonal hatches) on the tab bar and lobby dock, underfoot |
| **Paper** | things a player would hold: the event bill, the invite ticket, the High/Low ticket, dealer cards, Decode letter tiles | `--paper*` plus `--paper-grain`, weathered edges and torn or notched cuts |
| **Tape** | the NAME TBD placeholder only | `--tape`. The product has no name yet, so the sign is literally taped over |

Hazard stripes appear only on the countdown. Stencil type appears only on live moments (see below).

## Tokens: `web/src/styles/tokens.css`

Every color, size, duration and texture comes from here. The build fails if a component stylesheet uses a raw hex color (see *Guard*).

**Light is state:**

| Token | Hex | Means |
| --- | --- | --- |
| `--sodium` | `#F5A23A` | warm work light: live, your move, primary action, prizes |
| `--fluoro` | `#BDE2E4` | cold tube light: information, waiting, locked in, focus ring |
| `--go` | `#86D17A` | still standing |
| `--stop` | `#EE4B3B` | out, destructive, last five seconds |

**Ground:** `--void #060606`, `--char #151513`, `--slab #201F1C`, `--steel #34322D` (lines), `--grit #4B4841`.
**Ink:** `--chalk #ECE7DB` (14.8:1 on char), `--dust #A39E92` (6.8:1), `--ash #8A857C` (5.0:1). Every ink passes WCAG AA for small text on every surface it's used on.
**Paper:** `--paper #E4DCC8`, `--paper-ink #17140F` (14:1), `--paper-mute #5A5446`, `--paper-red #B3352A` (rubber-stamp ink).

**Each game's own light:** `--g-guess-color` (safety yellow), `--g-zero-hour` (fluoro), `--g-high-low` (go), `--g-decode` (chalk), `--g-suited-up` (card red), `--g-pressure-cooker` (sodium), `--g-speedrun` (signal blue). A game's accent marks its emblem, the 2px rule on top of the stage bar, the glow behind its title card, and its rule numbers.

## Type

| Face | Role |
| --- | --- |
| **Big Shoulders Display** 800–900, caps | poster type: page titles, tournament titles on bills, player names on the scoreboard, game names, big numbers |
| **Big Shoulders Stencil** 800 | live moments only: the countdown numerals, rubber stamps (OUT / STANDING / VOID / STAGE WIN / CHAMPION), CASH OUT and the tape mark. The countdown is the only place stencil numerals appear, because the falling sequence makes every digit obvious there. Stage numbers, the room count and ranks use Display, because the stencil 4 reads as a glitch on its own |
| **Barlow** | body and UI text. Inputs are ≥16px so iOS doesn't zoom |
| **Barlow Condensed** 600/700 | section heads (sentence case), buttons, labels, compact data |
| **IBM Plex Mono** | invite codes and player IDs only |

Section heads are deliberately quiet (condensed, sentence case), so the poster caps still hit hard where they appear. The scale is modular at 1.25, spacing is a 4px grid, touch targets are at least 48px, and primary game actions are 60–96px.

## Components

| File | Contents |
| --- | --- |
| `ui/venue.tsx` | **The objects that make it the venue.** `TapeMark` (brand), `Bill` (a tournament's fight-night poster: "X presents", title fitted to its length, a status stamp, three facts), `TicketStub` (the invite, with uses left on the stub and VOID when it can't be used), `RoomCount` (players in, slams on change), `PlayerTag` + `TagGrid` (name plates with a connection lamp; the host's is lit sodium), `Scoreboard` (final standings with the prize inline), `MemberCard` (name, ID, record) |
| `ui/controls.tsx` | `Button` (primary / secondary / ghost / danger; sm / md / lg; busy), `IconButton`, `TextInput` (code, mono, prefix), `Field`, `Segmented`, `Toggle`, `Stepper`, `vars()` |
| `ui/layout.tsx` | `Page`, `PageHead`, `Section`, `Stack` (gap on the 4px grid), `Text` (size × ink), `StatusScreen` (gates and closed rooms), `Plate`, `Rows`/`Row`, `Chip`, `Stats`, `Who`, `Spec`, `Empty`, `Loading`, `Note` |
| `ui/shell.tsx` | `AppShell` (phone: top bar + grating tab bar with a lamp over the active tab; desktop: side rail), `Sheet`, `Toasts`, `OfflineBanner`, `MusicButton` |
| `ui/live.tsx` | `TimerBar` (server clock, rAF), `Stamp`, `Hazard`, `FieldDots`, `useSecondsLeft` |
| `ui/GameMark.tsx` | per-game emblem + accent, `SuitGlyph` |
| `ui/Icon.tsx` | 24px icon set: 2px stroke, square caps, mitred joins, drawn like stencilled signage |

**Button hierarchy:** one primary per screen, the sodium plate with a cut corner, for the action that moves you forward (Join, Start, Lock in, Cash out). Secondary is a steel plate. Ghost is for way-outs (Back to the hub, Leave). Danger is outlined red and always behind a confirmation sheet when it can't be undone.

## Where the bill appears

The same poster follows a tournament everywhere it's presented to players, so it becomes recognizable: the invite page (`/j/:code`), the public join gate, the lobby, the wizard's review step (stamped *Draft*: "this is the poster your players see"), and the results page (stamped *Final*).

## The floor

- **Countdown:** hazard tape top and bottom, one work light sweeping, the stencil number slamming each second, and the first game on a plate.
- **Stage intro:** the game's title card. The stage number is set huge in the game's accent, and its light glows from the top-left. It compacts on phones under 740px tall, so the rules and the timer fit on one screen.
- **Round:** the stage bar (round, standing count, server timer, who's locked in), then the game's board, which fills the rest of the screen. Nothing scrolls.
- **Reveal:** the rubber stamp lands (OUT / STANDING / VOID) and the room's light turns red or green (`body[data-light]`), then the game's own reveal plays.
- **Stage result and final:** the winner's name slams in, a Stage Win or Champion stamp, and the Scoreboard.

**Game objects:** Guess the Color has brushed paint stripes. Zero Hour has a split-flap counter with dim leading zeros. Trust Yourself has a paper ticket. Decode has paper letter tiles sized to the longest word, flipping on reveal. Suited Up has suit plates and paper dealer cards dealt in. Pressure Cooker has a gauge and the stencil CASH OUT plate. Speedrun has a task card with a stopwatch.

## Motion

Motion is mechanical and short (120–360ms) and always answers something: the countdown slam, the room count when someone walks in, the stamp landing, tiles flipping, cards dealing in, the needle climbing. There are no decorative entrance animations. `prefers-reduced-motion` and the in-app *Reduce motion* setting turn all of it off.

## Sound

`web/src/lib/audio.ts` synthesizes everything with WebAudio, so there are no audio files and nothing to license. Music is a low drone, room tone, a slow kick and a shaker; it's off by default and toggled in the top bar or Settings. Effects play for taps, lock-ins, the last-five-second ticks, reveals, out, standing, cash-out and burst. Haptics use `navigator.vibrate`, or Telegram's HapticFeedback inside the Mini App.

## App icon

`npm run icons` (or `node --import tsx scripts/icons.ts`) renders `web/public/icon-*.png` from the real fonts: the tape mark on concrete under the work light, plus a maskable variant inside the 80% safe zone. Theme and Telegram header color: `#0E0E0C`, matching the top of the concrete.

## Guard

`scripts/check-css.mjs` runs at the start of every web build, including CI. The build fails on:

1. a CSS-module class a component uses that isn't defined (a typo would otherwise render unstyled);
2. an inline `style={{…}}` object (only data-driven values are allowed: CSS variables through `vars()`, and positions plotted on an axis);
3. a raw hex color in a component stylesheet (colors come from tokens; a short allow-list covers physical-object shades).

## Visual QA

- `npm run shots -- --size=se,phone,max,desk` renders every static screen and the lobby sheets to `screens/` at 375×667, 390×844, 430×932 and 1280×860. It saves both what fits on the screen and the full scroll, and reports any horizontal overflow.
- `npm run test:ui` plays a full tournament in Chromium and screenshots every phase of every game. It fails on console errors or horizontal overflow. Run it with `VIEWPORT=375x667` for the smallest supported phone, or `VIEWPORT=1280x860` for desktop.
