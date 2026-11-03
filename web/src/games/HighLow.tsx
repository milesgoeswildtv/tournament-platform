import { useState } from 'react';
import { audio } from '../lib/audio';
import { Button } from '../ui/controls';
import { ActionBar } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

export function HighLowPlay({ mine, me, canAct, pending, act }: PlayProps) {
  const hand = mine as { number: number; first: number; rerolled: boolean; call: 'high' | 'low' | null } | null;
  const [side, setSide] = useState<'high' | 'low' | null>(null);
  const locked = hand?.call ?? null;
  const shown = locked ?? side;
  const live = canAct && !locked && !!hand;
  return (
    <div className={s.play}>
      <div className={s.grow}>
        <div className={s.ticket} aria-live="polite" data-number={hand?.number ?? ''}>
          <div className={s.ticketLabel}>{hand?.rerolled ? `Rerolled from ${hand.first}` : 'Your number'}</div>
          <div className={s.ticketNum}>{hand ? hand.number : '··'}</div>
          <div className={s.ticketFoot}>{hand ? (hand.rerolled ? 'Reroll used. You play this one.' : 'Keep it or reroll once.') : 'Dealt to players still standing'}</div>
        </div>
        <p className={s.hint}>Call whether your number lands above or below the house number (1–100). Matching it is out.</p>
      </div>
      <div className={s.calls} role="radiogroup" aria-label="Your call">
        <button type="button" className={s.call} aria-pressed={shown === 'high'} disabled={!live} onClick={() => { audio.play('tap'); setSide('high'); }}>
          High
          <small>Mine is above</small>
        </button>
        <button type="button" className={s.call} aria-pressed={shown === 'low'} disabled={!live} onClick={() => { audio.play('tap'); setSide('low'); }}>
          Low
          <small>Mine is below</small>
        </button>
      </div>
      <ActionBar
        me={me}
        canAct={canAct && !!hand}
        submitted={!!locked}
        pending={pending}
        ready={!!side}
        label={side ? `Lock ${side === 'high' ? 'High' : 'Low'} on ${hand?.number}` : 'Make your call'}
        lockedText={`Called ${locked === 'high' ? 'High' : 'Low'} on ${hand?.number}`}
        onLock={() => side && act({ type: 'call', side })}
        extra={
          hand && !hand.rerolled ? (
            <Button block icon="refresh" disabled={pending} onClick={() => act({ type: 'reroll' })}>
              Reroll {hand.number} (once)
            </Button>
          ) : null
        }
      />
    </div>
  );
}

export function HighLowReveal({ reveal, myId }: RevealProps) {
  const r = reveal as { comparison: number; hands: Record<string, { number: number | null; call: string | null; rerolled: boolean }> };
  const mine = myId ? r.hands?.[myId] : undefined;
  const all = Object.values(r.hands ?? {});
  const highs = all.filter((h) => h.call === 'high').length;
  const lows = all.filter((h) => h.call === 'low').length;
  return (
    <div className={s.reveal}>
      <div className={s.vs}>
        <div>
          <div className={s.vsLabel}>House</div>
          <div className={s.vsNum} style={{ color: 'var(--sodium)' }}>{r.comparison}</div>
        </div>
        <div className={s.vsLabel}>vs</div>
        <div>
          <div className={s.vsLabel}>{mine ? `You, ${mine.call ?? 'no call'}` : 'You'}</div>
          <div className={s.vsNum}>{mine?.number ?? '—'}</div>
        </div>
      </div>
      <p className={s.hint}>
        {highs} called high, {lows} called low{all.length - highs - lows ? `, ${all.length - highs - lows} made no call` : ''}.
      </p>
    </div>
  );
}
