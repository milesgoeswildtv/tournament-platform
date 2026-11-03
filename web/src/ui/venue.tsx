/**
 * The venue's objects: the things that make this product look like an
 * underground tournament and not a dashboard.
 *
 *   TapeMark     the NAME TBD placeholder, a strip of gaffer tape over the sign
 *   Bill         a tournament's flyposted fight-night poster (paper)
 *   TicketStub   the invite, as a ticket you tear off (paper)
 *   RoomCount    how many are in, as a stencilled number that slams on change
 *   PlayerTag    a player's name plate in the room, with a connection lamp
 *   Scoreboard   final standings, rank by rank
 *   MemberCard   a player's card: name, ID and record
 *
 * Paper is reserved for things a player would hold; everything else is steel.
 */
import type { ReactNode } from 'react';
import { Link } from '../lib/router';
import { cx } from './controls';
import { initials } from './layout';
import s from './venue.module.css';

export function TapeMark({ size = 'md', to }: { size?: 'md' | 'xl'; to?: string }) {
  const body = (
    <span className={cx(s.tape, size === 'xl' && s.tapeXl)}>
      <span>NAME</span> <span>TBD</span>
    </span>
  );
  return to ? (
    <Link to={to} className={s.tapeLink} aria-label="NAME TBD, back to the hub">
      {body}
    </Link>
  ) : (
    <span role="img" aria-label="NAME TBD">
      {body}
    </span>
  );
}

export interface BillFact {
  label: string;
  value: ReactNode;
}

/** A tournament's poster. Title size follows its length so 60 characters still fit. */
export function Bill({ presents, title, facts, stamp, compact, children }: { presents: ReactNode; title: string; facts: BillFact[]; stamp?: string; compact?: boolean; children?: ReactNode }) {
  const len = title.length;
  const fit = len <= 14 ? 'xl' : len <= 26 ? 'lg' : len <= 42 ? 'md' : 'sm';
  return (
    <article className={cx(s.bill, compact && s.billCompact)} aria-label={`${title}, poster`}>
      <div className={s.billTop}>
        <span className={s.billPresents}>{presents}</span>
        {stamp && <span className={s.billStamp}>{stamp}</span>}
      </div>
      <h1 className={s.billTitle} data-fit={fit}>
        {title}
      </h1>
      <dl className={s.billFacts}>
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </article>
  );
}

/** The invite: code on the ticket, uses left on the stub. */
export function TicketStub({ code, line, stubValue, stubLabel, void: isVoid }: { code: string; line: ReactNode; stubValue: ReactNode; stubLabel: string; void?: boolean }) {
  return (
    <div className={s.ticket} data-void={isVoid || undefined}>
      <div className={s.ticketMain}>
        <span className={s.ticketLabel}>Invite code</span>
        <span className={s.ticketCode} aria-label={`Invite code ${code.split('').join(' ')}`}>
          {code}
        </span>
        <span className={s.ticketLine}>{line}</span>
      </div>
      <div className={s.ticketStub} aria-hidden={false}>
        <b>{stubValue}</b>
        <span>{stubLabel}</span>
      </div>
      {isVoid && <span className={s.ticketVoid}>Void</span>}
    </div>
  );
}

export function RoomCount({ n, label, sub, live }: { n: number; label: string; sub?: ReactNode; live?: boolean }) {
  return (
    <div className={s.count} data-count={n}>
      <span key={n} className={s.countNum}>
        {n}
      </span>
      <span className={s.countText}>
        <b>
          {live && <i className={s.countLamp} aria-hidden />}
          {label}
        </b>
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}

export function TagGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={s.tags} role="list" aria-label={label}>
      {children}
    </div>
  );
}

export function PlayerTag({ name, tag, connected, host, me, left, note, data }: { name: string; tag?: string | null; connected?: boolean; host?: boolean; me?: boolean; left?: boolean; note?: string; data?: string }) {
  return (
    <div role="listitem" className={s.tag} data-player={data ?? name} data-host={host || undefined} data-me={me || undefined} data-left={left || undefined}>
      <span className={s.tagMark} aria-hidden>
        {initials(name)}
      </span>
      <span className={s.tagText}>
        <b>{name}</b>
        <span>{[host ? 'Host' : null, me ? 'You' : null, note ?? null].filter(Boolean).join(', ') || (tag ? `#${tag}` : '')}</span>
      </span>
      <span className={s.lamp} data-on={!!connected} title={connected ? 'Connected' : 'Not connected'}>
        <span className="sr-only">{connected ? 'Connected' : 'Not connected'}</span>
      </span>
    </div>
  );
}

export interface ScoreRow {
  playerId: string;
  name: string;
  rank: number;
  stageWins: number;
  detail: string;
  prize?: string | null;
}

/** Final standings: big rank, name, stage wins, and the prize line beneath. */
export function Scoreboard({ rows, myId, label = 'Final standings' }: { rows: ScoreRow[]; myId: string | null; label?: string }) {
  return (
    <ol className={s.board} aria-label={label}>
      {rows.map((r) => (
        <li key={r.playerId} className={s.boardRow} data-standing={r.name} data-rank={r.rank} data-me={r.playerId === myId || undefined}>
          <span className={s.boardRank}>{r.rank}</span>
          <span className={s.boardWho}>
            <b>{r.name}</b>
            <span>{r.detail}</span>
            {r.prize && <span className={s.boardPrize}>{r.prize}</span>}
          </span>
          <span className={s.boardWins}>
            <b>{r.stageWins}</b>
            <span>{r.stageWins === 1 ? 'win' : 'wins'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A player's card: who they are and their record, on one steel plate. */
export function MemberCard({ name, id, action, stats, children }: { name: string; id: ReactNode; action?: ReactNode; stats: [string, ReactNode][]; children?: ReactNode }) {
  return (
    <header className={s.member}>
      <div className={s.memberTop}>
        <div className={s.memberId}>
          <h1 className={s.memberName}>{name}</h1>
          <span className={s.memberSub}>{id}</span>
        </div>
        {action}
      </div>
      {children}
      <dl className={s.memberStats}>
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
