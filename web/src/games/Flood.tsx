import { useState } from 'react';
import { audio } from '../lib/audio';
import { vars } from '../ui/controls';
import { ActionBar } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const cols = (n: number) => (n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5);

export function FloodPlay({ pub, mine, me, canAct, pending, act }: PlayProps) {
  const platforms: number = pub?.platforms ?? 0;
  const lastFlood = new Set<number>(pub?.lastFlood ?? []);
  const locked: number | null = mine?.platform ?? null;
  const [pick, setPick] = useState<number | null>(null);
  const shown = locked ?? pick;
  return (
    <div className={s.play}>
      <p className={s.floodHint}>
        <b>{pub?.floods ?? 0}</b> of {platforms} platforms flood this tide.{lastFlood.size ? ' Tide lines mark last tide’s flood.' : ''}
      </p>
      <div className={s.platforms} style={vars({ '--cols': cols(platforms) })} data-chosen={shown !== null} role="radiogroup" aria-label="Platforms">
        {Array.from({ length: platforms }, (_, i) => (
          <button
            key={i}
            type="button"
            className={s.platform}
            aria-pressed={shown === i}
            aria-label={`Platform ${i + 1}${lastFlood.has(i) ? ', flooded last tide' : ''}`}
            data-tideline={lastFlood.has(i) || undefined}
            disabled={!canAct || locked !== null}
            onClick={() => {
              audio.play('tap');
              setPick(i);
            }}
          >
            <span className={s.platformNo}>{i + 1}</span>
            {lastFlood.has(i) && <span className={s.tideNote}>wet last tide</span>}
          </button>
        ))}
      </div>
      <ActionBar
        me={me}
        canAct={canAct}
        submitted={locked !== null}
        pending={pending}
        ready={pick !== null}
        label={pick !== null ? `Stand on platform ${pick + 1}` : 'Pick a platform'}
        lockedText={`On platform ${(locked ?? 0) + 1}. The water comes at the bell.`}
        onLock={() => pick !== null && act({ platform: pick })}
      />
    </div>
  );
}

export function FloodReveal({ reveal, myId }: RevealProps) {
  const r = reveal as { platforms: number; flooded: number[]; occupancy: number[]; picks: Record<string, number | null> };
  const wet = new Set(r.flooded);
  const mine = myId ? r.picks?.[myId] : undefined;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>Flooded this tide</p>
        <p className={`${s.big} ${s.inFlood}`}>{r.flooded.map((p) => p + 1).join(', ')}</p>
        {mine !== undefined && <p className={s.small}>{mine === null ? 'You didn’t pick a platform.' : `You stood on ${mine + 1}.`}</p>}
      </div>
      <div className={`${s.platforms} ${s.platformsReveal}`} style={vars({ '--cols': cols(r.platforms) })}>
        {Array.from({ length: r.platforms }, (_, i) => (
          <div key={i} className={s.platform} data-wet={wet.has(i) || undefined} data-mine={mine === i || undefined} aria-label={`Platform ${i + 1}: ${wet.has(i) ? 'flooded' : 'dry'}, ${r.occupancy[i]} standing`}>
            <span className={s.platformNo}>{i + 1}</span>
            <span className={s.occupancy}>{r.occupancy[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
