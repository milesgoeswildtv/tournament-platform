import { useState } from 'react';
import { SUITS, compareSuits } from '@shared/client';
import { audio } from '../lib/audio';
import { SuitGlyph, type SuitName } from '../ui/GameMark';
import { ActionBar, cap } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const BEATS: Record<SuitName, SuitName> = { spade: 'diamond', diamond: 'club', club: 'heart', heart: 'spade' };

/** The cycle, read left to right: each suit beats the next. */
export function SuitRing({ size = 18 }: { size?: number }) {
  const order: SuitName[] = ['spade', 'diamond', 'club', 'heart', 'spade'];
  return (
    <div className={s.ring} aria-label="Spade beats diamond, diamond beats club, club beats heart, heart beats spade">
      {order.map((x, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <SuitGlyph suit={x} size={size} />
          {i < order.length - 1 && <span aria-hidden>beats</span>}
        </span>
      ))}
    </div>
  );
}

export function SuitedUpPlay({ mine, me, canAct, pending, act }: PlayProps) {
  const locked: SuitName | null = mine?.pick ?? null;
  const [pick, setPick] = useState<SuitName | null>(null);
  const shown = locked ?? pick;
  return (
    <div className={s.play}>
      <SuitRing />
      <p className={s.hint}>The dealer shows two different suits. Win +1, lose −1, anything else 0. Stay at 0 or better.{typeof mine?.total === 'number' && mine.total !== 0 ? ` Running score ${mine.total > 0 ? '+' : ''}${mine.total}.` : ''}</p>
      <div className={s.suits} data-chosen={!!shown} role="radiogroup" aria-label="Suits">
        {(SUITS as readonly SuitName[]).map((x) => (
          <button key={x} type="button" className={s.suit} aria-pressed={shown === x} disabled={!canAct || !!locked} onClick={() => { audio.play('tap'); setPick(x); }}>
            <SuitGlyph suit={x} size={52} />
            {cap(x)}
            <small>beats {BEATS[x]}</small>
          </button>
        ))}
      </div>
      <ActionBar
        me={me}
        canAct={canAct}
        submitted={!!locked}
        pending={pending}
        ready={!!pick}
        label={pick ? `Lock in ${cap(pick)}` : 'Pick a suit'}
        lockedText={`Locked in ${cap(locked ?? '')}. Dealer reveals at the bell.`}
        onLock={() => pick && act({ suit: pick })}
      />
    </div>
  );
}

const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

export function SuitedUpReveal({ reveal, myId }: RevealProps) {
  const r = reveal as { dealer: [SuitName, SuitName]; picks: Record<string, SuitName | null>; scores: Record<string, number | null> };
  const mine = myId ? r.picks?.[myId] : undefined;
  const parts = mine ? r.dealer.map((d) => compareSuits(mine, d)) : null;
  const total = parts ? parts[0] + parts[1] : null;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>Dealer shows</p>
        <div className={s.dealer}>
          {r.dealer.map((d) => (
            <div className={s.card} key={d}>
              <SuitGlyph suit={d} size={60} color={d === 'heart' || d === 'diamond' ? '#c8352a' : '#151513'} />
            </div>
          ))}
        </div>
      </div>
      {mine && parts && (
        <div className={s.score}>
          {r.dealer.map((d, i) => (
            <div key={d}>
              <b className={parts[i] > 0 ? s.plus : parts[i] < 0 ? s.minus : ''}>{fmt(parts[i])}</b>
              <span>
                {cap(mine)} vs {d}
              </span>
            </div>
          ))}
          <div>
            <b className={total! >= 0 ? s.plus : s.minus}>{fmt(total!)}</b>
            <span>Total</span>
          </div>
        </div>
      )}
      {mine === null && <p className={s.hint}>You didn’t pick a suit.</p>}
    </div>
  );
}
