import { useEffect, useRef, type RefObject } from 'react';
import { audio, haptic } from '../lib/audio';
import { Chip } from '../ui/layout';
import { Icon } from '../ui/Icon';
import { Spectating } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const MAX = 12;
const angleFor = (m: number) => 180 - (Math.min(1, Math.log(Math.max(1, m)) / Math.log(MAX)) * 180);
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)];
};
const arc = (from: number, to: number, r: number) => {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

function Gauge({ needle }: { needle: RefObject<SVGLineElement | null> }) {
  const ticks = [1, 1.5, 2, 3, 5, 8, 12];
  return (
    <div className={s.gauge} aria-hidden>
      <svg viewBox="0 -6 200 116">
        <path d={arc(180, 0, 84)} stroke="var(--steel)" strokeWidth="14" fill="none" />
        <path d={arc(180, angleFor(2), 84)} stroke="var(--fluoro-dim)" strokeWidth="14" fill="none" />
        <path d={arc(angleFor(2), angleFor(5), 84)} stroke="var(--sodium-dim)" strokeWidth="14" fill="none" />
        <path d={arc(angleFor(5), 0, 84)} stroke="var(--stop-dim)" strokeWidth="14" fill="none" />
        {ticks.map((t) => {
          const a = angleFor(t);
          const [x1, y1] = polar(a, 70);
          const [x2, y2] = polar(a, 76);
          const [lx, ly] = polar(a, 58);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--dust)" strokeWidth="2" />
              <text x={lx} y={ly + 4} fill="var(--ash)" fontSize="10" fontFamily="var(--f-cond)" fontWeight="600" textAnchor="middle">
                {t}×
              </text>
            </g>
          );
        })}
        <line ref={needle} x1="100" y1="100" x2="100" y2="22" stroke="var(--chalk)" strokeWidth="4" strokeLinecap="square" style={{ transformOrigin: '100px 100px' }} />
        <circle cx="100" cy="100" r="8" fill="var(--chalk)" />
      </svg>
    </div>
  );
}

export function PressurePlay({ pub, mine, me, canAct, pending, act, serverNow, name }: PlayProps) {
  const needle = useRef<SVGLineElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const mineCash: number | null = mine?.cashout ?? null;
  const broken: boolean = !!pub?.broken;
  const startedAt: number = pub?.startedAt ?? 0;
  const growth: number = pub?.growth ?? 0.07;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const m = broken && pub?.breakAt ? pub.breakAt : Math.floor(100 * Math.exp((growth * Math.max(0, serverNow() - startedAt)) / 1000)) / 100;
      if (label.current) label.current.textContent = `${m.toFixed(2)}×`;
      if (needle.current) needle.current.style.transform = `rotate(${90 - angleFor(m)}deg)`;
      if (!broken) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [broken, startedAt, growth, serverNow, pub?.breakAt]);

  useEffect(() => {
    if (broken) {
      audio.play('burst');
      haptic('heavy');
    }
  }, [broken]);

  const others = Object.entries((pub?.cashouts ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);

  return (
    <div className={s.play}>
      <div className={s.grow}>
        <Gauge needle={needle} />
        <div className={s.mult} ref={label} data-burst={broken} aria-live="off">
          1.00×
        </div>
        <p className={s.hint}>{broken ? `Burst at ${Number(pub.breakAt).toFixed(2)}×.` : 'The break point is hidden. The server records the moment it receives your tap.'}</p>
        <div className={s.ticker}>
          {others.slice(0, 8).map(([p, v]) => (
            <Chip key={p} tone="go">
              {name(p)} {v.toFixed(2)}×
            </Chip>
          ))}
        </div>
      </div>
      <div className={s.action}>
        {mineCash !== null ? (
          <div className={s.locked} role="status" style={{ borderColor: 'var(--go-dim)', color: 'var(--go)' }}>
            <Icon name="lock" size={20} />
            <span>Cashed out at {mineCash.toFixed(2)}×</span>
          </div>
        ) : canAct && !broken ? (
          <button
            type="button"
            className={s.cashBtn}
            disabled={pending}
            onClick={() => {
              audio.play('cash');
              haptic('heavy');
              act({ type: 'cashout' });
            }}
          >
            Cash out
          </button>
        ) : canAct && broken ? (
          <div className={s.locked} role="status" style={{ borderColor: 'var(--stop-dim)', color: 'var(--stop)' }}>
            Burst before you cashed out
          </div>
        ) : (
          <Spectating me={me} />
        )}
      </div>
    </div>
  );
}

export function PressureReveal({ reveal, myId, name }: RevealProps) {
  const r = reveal as { breakAt: number; cashouts: Record<string, number | null>; winner: string | null; voided: boolean };
  const rows = Object.entries(r.cashouts ?? {}).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
  const mine = myId ? r.cashouts?.[myId] : undefined;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>Pressure broke at</p>
        <p className={s.big} style={{ color: 'var(--stop)' }}>{r.breakAt.toFixed(2)}×</p>
        {r.voided ? <p>Everyone got burned. The run replays.</p> : r.winner && <p>Highest lock: <b>{name(r.winner)}</b> at {(r.cashouts[r.winner] ?? 0).toFixed(2)}×</p>}
        {mine !== undefined && <p className={s.small}>{mine === null ? 'You didn’t cash out in time.' : `You locked ${mine.toFixed(2)}×.`}</p>}
      </div>
      <div className={s.list}>
        {rows.map(([p, v]) => (
          <div className={s.listRow} key={p}>
            <b>{name(p)}</b>
            <span className={v === null ? s.bad : s.ok}>{v === null ? 'Burned' : `${v.toFixed(2)}×`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
