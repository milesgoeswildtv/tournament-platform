# SHYST music library

Music is intentionally separate from the synthesized game sound effects.

## Add a track

1. Put the audio file in the matching folder below.
2. Add one entry to `web/src/lib/music.ts` in `MUSIC_LIBRARY`.
3. Commit the audio file and manifest entry together.

Supported categories:

- `underground` — industrial hip-hop, experimental trap and dark electronic.
- `drift` — atmospheric, spacious and downtempo electronic.
- `oddity` — offbeat synths, elastic bass and strange electronic grooves.

Example manifest entry:

```ts
{ id: 'underground-01', title: 'Track title', category: 'underground', src: '/music/underground/track-title.mp3' }
```

Files are served from these public paths:

- `web/public/music/underground/`
- `web/public/music/drift/`
- `web/public/music/oddity/`

The player, screen routing, settings and controls do not need to change when tracks are added or removed. The manifest is the playlist source of truth. Category choices are saved per device and independently for pre-game/lobby and gameplay.

Keep the global Music switch off until at least one track is added. Missing or unreadable tracks are skipped for the current page session.
