import type { ReactNode } from 'react';
import { GAME_IDS, GAME_META, type GameId } from '@shared/client';
import { Link } from '../lib/router';
import { Icon } from '../ui/Icon';
import { GAME_ACCENT, GameMark, SuitGlyph } from '../ui/GameMark';
import { Button, vars } from '../ui/controls';
import { Chip, Page, PageHead, Section, Spec, Stack, Text } from '../ui/layout';
import { NotFound } from './NotFound';
import s from './screens.module.css';

export function LibraryScreen() {
  return (
    <Page>
      <PageHead title="Game library" lede="Every tournament stage is one of these. A game can run several rounds inside its stage; the stage ends when the game names its winner." />
      <div className={s.games}>
        {GAME_IDS.map((id) => (
          <Link key={id} to={`/games/${id}`} className={s.gameRow} style={vars({ '--accent': GAME_ACCENT[id] })}>
            <GameMark id={id} size={48} />
            <div>
              <div className={s.gameName}>{GAME_META[id].name}</div>
              <div className={s.gameTag}>{GAME_META[id].tagline}</div>
            </div>
            <Icon name="next" size={18} />
          </Link>
        ))}
      </div>
    </Page>
  );
}

const EXTRA: Partial<Record<GameId, () => ReactNode>> = {
  'suited-up': () => (
    <Section title="The suit cycle">
      <div className={s.cycle}>
        {(['spade', 'diamond', 'club', 'heart'] as const).map((x, i, all) => (
          <div key={x}>
            <SuitGlyph suit={x} size={40} />
            <span>beats {all[(i + 1) % 4]}</span>
          </div>
        ))}
      </div>
      <Text tone="dust" size="sm">
        Spade vs club and diamond vs heart are neutral, as is the same suit. You can never beat both dealer suits, and you can lose to at most one.
      </Text>
    </Section>
  ),
  speedrun: () => (
    <Section title="Elimination schedule">
      <Spec items={[['Tasks 1–5', 'At least 1 cut'], ['Tasks 6–10', '1–2 cut'], ['Tasks 11+', '1–3 cut']]} />
      <Text tone="dust" size="sm">Wrong and missing answers always go first. If that doesn’t meet the cut, the slowest correct answers fill it. Tasks come from a fixed library: math, wordplay, reading, observation, general knowledge, directions and look-ups from a reference sheet.</Text>
    </Section>
  ),
};

export function GameDetailScreen({ id }: { id: string }) {
  const meta = GAME_META[id as GameId];
  if (!meta) return <NotFound />;
  const Extra = EXTRA[id as GameId];
  return (
    <Page>
      <div className={s.gameHero} style={vars({ '--accent': GAME_ACCENT[meta.id] })}>
        <GameMark id={meta.id} size={72} />
        <PageHead title={meta.name} lede={meta.description} />
        <Stack row gap={2}>
          <Chip>Up to {meta.maxRounds} {meta.roundNoun.toLowerCase()}{meta.maxRounds === 1 ? '' : 's'}</Chip>
          <Chip tone="info">Server decides every outcome</Chip>
        </Stack>
      </div>
      <Section title="How it plays">
        <ol className={s.rules} style={vars({ '--accent': GAME_ACCENT[meta.id] })}>
          {meta.instructions.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </Section>
      <Section title="Winning and ties">
        <Spec items={[['Winner', meta.winRule], ['Ties', meta.tieRule]]} />
      </Section>
      {Extra && <Extra />}
      <Button to="/games" variant="ghost" icon="back">
        All games
      </Button>
    </Page>
  );
}
