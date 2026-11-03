import type { ReactNode } from 'react';
import { Link } from '../lib/router';
import { cx } from './controls';
import s from './layout.module.css';

type Gap = 1 | 2 | 3 | 4 | 6 | 8;

/** Vertical rhythm without one-off margins: children spaced on the 4px grid. */
export function Stack({ gap = 3, row, center, push, as: Tag = 'div', className, children }: { gap?: Gap; row?: boolean; center?: boolean; push?: boolean; as?: 'div' | 'section' | 'footer' | 'header'; className?: string; children: ReactNode }) {
  return <Tag className={cx(row ? s.stackRow : s.stack, s[`g${gap}`], center && s.stackCenter, push && s.stackPush, className)}>{children}</Tag>;
}

export type Ink = 'chalk' | 'dust' | 'ash' | 'sodium' | 'fluoro' | 'go' | 'stop';

/** Body copy in one of the system's sizes and inks. */
export function Text({ tone = 'chalk', size = 'md', cond, center, as: Tag = 'p', role, className, children }: { tone?: Ink; size?: 'xs' | 'sm' | 'md' | 'lg'; cond?: boolean; center?: boolean; as?: 'p' | 'span' | 'div'; role?: string; className?: string; children: ReactNode }) {
  return (
    <Tag role={role} className={cx(s.text, s[`t_${size}`], s[`c_${tone}`], cond && s.cond, center && s.center, className)}>
      {children}
    </Tag>
  );
}

/** Full-screen message for gates and closed rooms: what happened, then where to go. */
export function StatusScreen({ title, chip, children, actions }: { title: ReactNode; chip?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <main className={s.status}>
      {chip}
      <h1 className={s.statusTitle}>{title}</h1>
      {children}
      {actions && <div className={s.statusActions}>{actions}</div>}
    </main>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cx(s.page, wide && s.wide)}>{children}</main>;
}

export function PageHead({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className={s.pageHead}>
      <h1 className={s.title}>{title}</h1>
      {lede && <p className={s.lede}>{lede}</p>}
      {children}
    </header>
  );
}

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className={s.section} aria-labelledby={id}>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle} id={id}>
          {title}
        </h2>
        {aside && <div className={s.sectionAside}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Plate({ children, cut, live, className }: { children: ReactNode; cut?: boolean; live?: boolean; className?: string }) {
  return <div className={cx(s.plate, cut && s.plateCut, live && s.plateLive, className)}>{children}</div>;
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className={s.rows}>{children}</div>;
}

export function Row({ to, title, meta, end, lead }: { to?: string; title: ReactNode; meta?: ReactNode; end?: ReactNode; lead?: ReactNode }) {
  const body = (
    <>
      <div className={s.who}>
        {lead}
        <div className={s.rowMain}>
          <div className={s.rowTitle}>{title}</div>
          {meta && <div className={s.rowMeta}>{meta}</div>}
        </div>
      </div>
      {end !== undefined && <div className={s.rowEnd}>{end}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={s.row}>
      {body}
    </Link>
  ) : (
    <div className={s.row}>{body}</div>
  );
}

export type Tone = 'live' | 'info' | 'go' | 'stop' | 'muted';

export function Chip({ tone = 'muted', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx(s.chip, s[`tone_${tone}`])}>
      {dot && <i aria-hidden />}
      {children}
    </span>
  );
}

export function Stats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className={s.stats}>
      {items.map((it) => (
        <div className={s.stat} key={it.label}>
          <span className={s.statValue}>{it.value}</span>
          <span className={s.statLabel}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Who({ name, tag, small, to, children }: { name: string; tag?: string | null; small?: boolean; to?: string; children?: ReactNode }) {
  const inner = (
    <>
      <span className={cx(s.mark, small && s.markSm)} aria-hidden>
        {initials(name)}
      </span>
      <span className={s.whoText}>
        <span className={s.whoName}>{name}</span>
        {tag && <span className={s.whoTag}>#{tag}</span>}
        {children}
      </span>
    </>
  );
  return to ? (
    <Link to={to} className={s.who}>
      {inner}
    </Link>
  ) : (
    <span className={s.who}>{inner}</span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={s.loading} role="status" aria-live="polite">
      <div className={s.bar} />
      <span>{label}</span>
    </div>
  );
}

export function Spec({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={s.spec}>
      {items.map(([k, v], i) => (
        <div key={i} className={s.specRow}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className={s.note}>{children}</p>;
}

export const layoutStyles = s;
