import { useState } from 'react';
import { audio } from '../lib/audio';
import { ActionBar } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

export function ZeroHourPlay({ pub, mine, me, canAct, pending, act }: PlayProps) {
  const locked: number | null = mine?.value ?? null;
  const [val, setVal] = useState('');
  const shown = locked !== null ? String(locked) : val;
  const press = (k: string) => {
    audio.play('tap');
    setVal((v) => {
      if (k === 'del') return v.slice(0, -1);
      if (k === 'clr') return '';
      const next = (v === '0' ? '' : v) + k;
      return Number(next) > 100 ? v : next.slice(0, 3);
    });
  };
  const disabled = !canAct || locked !== null;
  return (
    <div className={s.play}>
      <div className={s.grow}>
        <p className={s.hint}>
          Target: <b style={{ color: 'var(--sodium)' }}>{pub?.percent ?? 67}%</b> of everyone’s average. Numbers stay hidden until the call.
        </p>
        <div className={s.readout}>
          <span className={s.readoutNum} data-empty={!shown} aria-live="polite">
            {shown || '—'}
          </span>
          <span className={s.small}>Pick a whole number, 0 to 100</span>
        </div>
      </div>
      {!disabled && (
        <div className={s.keypad} role="group" aria-label="Number pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} type="button" className={s.key} onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button type="button" className={`${s.key} ${s.keyAlt}`} onClick={() => press('clr')}>
            Clear
          </button>
          <button type="button" className={s.key} onClick={() => press('0')}>
            0
          </button>
          <button type="button" className={`${s.key} ${s.keyAlt}`} onClick={() => press('del')} aria-label="Delete">
            Delete
          </button>
        </div>
      )}
      <ActionBar
        me={me}
        canAct={canAct}
        submitted={locked !== null}
        pending={pending}
        ready={val !== ''}
        label={val !== '' ? `Lock in ${val}` : 'Enter a number'}
        lockedText={`Locked in ${locked}. Waiting for the call.`}
        onLock={() => val !== '' && act({ value: Number(val) })}
      />
    </div>
  );
}

export function ZeroHourReveal({ reveal, myId, name }: RevealProps) {
  const r = reveal as { values: Record<string, number>; average: number | null; target: number | null; percent: number; winner: string | null };
  const vals = Object.entries(r.values ?? {});
  const mine = myId ? r.values?.[myId] : undefined;
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>
          {r.average === null ? 'Nobody submitted.' : `Average ${r.average.toFixed(2)} × ${r.percent}% =`}
        </p>
        {r.target !== null && <p className={s.big} style={{ color: 'var(--sodium)' }}>Target {r.target.toFixed(2)}</p>}
        {r.winner && <p>Closest: <b>{name(r.winner)}</b> with {r.values[r.winner]}</p>}
        {mine !== undefined && r.target !== null && <p className={s.small}>Yours: {mine}, off by {Math.abs(mine - r.target).toFixed(2)}</p>}
      </div>
      {r.target !== null && (
        <div>
          <div className={s.line}>
            <div className={s.lineAxis} />
            {vals.map(([p, v]) => (
              <span key={p} className={`${s.tick} ${p === r.winner ? s.tickWin : p === myId ? s.tickMe : ''}`} style={{ left: pct(v) }} title={`${name(p)}: ${v}`} />
            ))}
            <span className={`${s.marker} ${s.markerTarget}`} style={{ left: pct(r.target) }}>
              target
            </span>
            {r.average !== null && (
              <span className={`${s.marker} ${s.markerAvg}`} style={{ left: pct(r.average) }}>
                avg
              </span>
            )}
          </div>
          <div className={s.lineEnds}>
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
      )}
    </div>
  );
}
