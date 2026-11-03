import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '../lib/audio';
import { cx } from './controls';
import s from './live.module.css';

/**
 * Server-timed bar. Animates with requestAnimationFrame against the server
 * clock, so it shows exactly the deadline the server will enforce.
 */
export function TimerBar({ startsAt, endsAt, serverNow, ticks = true, label = 'Time left', calm = false }: { startsAt: number; endsAt: number; serverNow: () => number; ticks?: boolean; label?: string; calm?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  const [secs, setSecs] = useState(() => Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)));
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const span = Math.max(1, endsAt - startsAt);
    const loop = () => {
      const left = Math.max(0, endsAt - serverNow());
      if (fill.current) fill.current.style.transform = `scaleX(${left / span})`;
      const sec = Math.ceil(left / 1000);
      setSecs((p) => (p === sec ? p : sec));
      if (ticks && sec <= 5 && sec > 0 && lastTick.current !== sec) {
        lastTick.current = sec;
        audio.play('tick');
      }
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [startsAt, endsAt, serverNow, ticks]);
  return (
    <div className={s.timer} data-urgent={!calm && secs <= 5} data-warm={!calm && secs <= 10} data-calm={calm} role="timer" aria-label={`${label}: ${secs} seconds`}>
      <div className={s.track}>
        <div className={s.fill} ref={fill} />
      </div>
      <span className={s.secs} aria-hidden>
        {secs}
      </span>
    </div>
  );
}

/** Seconds remaining until a server deadline, updated a few times a second. */
export function useSecondsLeft(endsAt: number | null, serverNow: () => number): number {
  const [left, setLeft] = useState(() => (endsAt ? Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)) : 0));
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [endsAt, serverNow]);
  return left;
}

export function Stamp({ tone, children }: { tone: 'go' | 'stop' | 'info' | 'live'; children: ReactNode }) {
  return <span className={cx(s.stamp, s[`stamp_${tone}`])}>{children}</span>;
}

export function Hazard({ moving }: { moving?: boolean }) {
  return <div className={cx(s.hazard, moving && s.hazardMove)} aria-hidden />;
}

export function FieldDots({ dots }: { dots: { id: string; state: 'alive' | 'done' | 'out'; me?: boolean; name: string }[] }) {
  if (dots.length > 60) return null;
  return (
    <div className={s.field} aria-hidden>
      {dots.map((d) => (
        <span key={d.id} title={d.name} className={cx(s.dot, s[`dot_${d.state}`], d.me && s.dot_me)} />
      ))}
    </div>
  );
}
