import { useState } from 'react';
import { COLORS } from '@shared/client';
import { audio } from '../lib/audio';
import { ActionBar, cap } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const CAN: Record<string, string> = {
  red: 'var(--can-red)',
  yellow: 'var(--can-yellow)',
  green: 'var(--can-green)',
  blue: 'var(--can-blue)',
  white: 'var(--can-white)',
};

export function GuessColorPlay({ mine, me, canAct, pending, act }: PlayProps) {
  const locked: string | null = mine?.pick ?? null;
  const [pick, setPick] = useState<string | null>(null);
  const shown = locked ?? pick;
  return (
    <div className={s.play}>
      <p className={s.hint}>{locked ? 'Locked. The house draws when time runs out.' : 'One of these is live. Pick a can.'}</p>
      <div className={s.cans} data-chosen={!!shown} role="radiogroup" aria-label="Colors">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={s.can}
            style={{ ['--c' as string]: CAN[c] }}
            aria-pressed={shown === c}
            disabled={!canAct || !!locked}
            onClick={() => {
              audio.play('tap');
              setPick(c);
            }}
          >
            <span className={s.swatch} aria-hidden />
            <span className={s.canName}>{c}</span>
          </button>
        ))}
      </div>
      <ActionBar
        me={me}
        canAct={canAct}
        submitted={!!locked}
        pending={pending}
        ready={!!pick}
        label={pick ? `Lock in ${cap(pick)}` : 'Pick a color'}
        lockedText={`Locked in ${cap(locked ?? '')}`}
        onLock={() => pick && act({ color: pick })}
      />
    </div>
  );
}

export function GuessColorReveal({ reveal, myId }: RevealProps) {
  const r = reveal as { winning: string; tally: Record<string, number>; picks: Record<string, string | null>; voided: boolean };
  const mine = myId ? r.picks?.[myId] : null;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>The house drew</p>
        <p className={s.big} style={{ color: CAN[r.winning] }}>
          {r.winning}
        </p>
        {mine !== undefined && <p className={s.small}>{mine ? `You picked ${cap(mine)}` : 'You didn’t pick'}</p>}
      </div>
      <div className={s.cans}>
        {COLORS.map((c) => (
          <div key={c} className={s.can} style={{ ['--c' as string]: CAN[c], maxHeight: 56 }} data-win={c === r.winning}>
            <span className={s.swatch} aria-hidden />
            <span className={s.canName} style={{ fontSize: 'var(--t-xl)' }}>
              {c}
            </span>
            <span className={s.count}>{r.tally?.[c] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
