import { money, ordinal } from '../../lib/format';
import { Note, Section, layoutStyles as l } from '../../ui/layout';
import { Stamp } from '../../ui/live';
import sc from '../screens.module.css';

export interface FinalRow {
  playerId: string;
  name: string;
  rank: number;
  stageWins: number;
  outrightWins: number;
  roundsSurvived: number;
  stagesPlayed: number;
}

export interface FinalAllocation {
  kind: string;
  label: string;
  playerId: string | null;
  name: string | null;
  amountCents: number;
  status: string;
  note: string;
}

export function FinalBoard({ rows, allocations, currency, myId }: { rows: FinalRow[]; allocations: FinalAllocation[]; currency: string; myId: string | null }) {
  const champs = rows.filter((r) => r.rank === 1 && r.stageWins > 0);
  const mine = rows.find((r) => r.playerId === myId);
  const totals = new Map<string, { name: string; cents: number }>();
  for (const a of allocations) {
    if (!a.playerId || a.status !== 'COMMITTED_UNPAID') continue;
    const t = totals.get(a.playerId) ?? { name: a.name ?? '?', cents: 0 };
    t.cents += a.amountCents;
    totals.set(a.playerId, t);
  }
  const unawarded = allocations.filter((a) => a.status === 'UNAWARDED').reduce((n, a) => n + a.amountCents, 0);
  const myPrize = myId ? totals.get(myId)?.cents ?? 0 : 0;
  return (
    <>
      <div className={sc.champion}>
        <p style={{ color: 'var(--dust)' }}>{champs.length > 1 ? 'Shared title' : champs.length ? 'Tournament winner' : 'No stage winners'}</p>
        <h1 className={sc.championName}>{champs.length ? champs.map((c) => c.name).join(' + ') : 'Nobody'}</h1>
        {mine && (
          <p>
            You finished <b>{ordinal(mine.rank)}</b> with {mine.stageWins} stage win{mine.stageWins === 1 ? '' : 's'}
            {myPrize > 0 ? `, allocated ${money(myPrize, currency)}` : ''}.
          </p>
        )}
        {mine && mine.rank === 1 && mine.stageWins > 0 && <Stamp tone="live">Champion</Stamp>}
      </div>

      <Section title="Standings" aside="By stage wins">
        <div className={l.tableWrap}>
          <table className={l.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className={l.num}>Wins</th>
                <th className={l.num}>Outright</th>
                <th className={l.num}>Rounds</th>
                <th className={l.num}>Stages</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId} className={r.playerId === myId ? l.me : undefined}>
                  <td>{r.rank}</td>
                  <td>{r.name}</td>
                  <td className={l.num}>{r.stageWins}</td>
                  <td className={l.num}>{r.outrightWins}</td>
                  <td className={l.num}>{r.roundsSurvived}</td>
                  <td className={l.num}>{r.stagesPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: 'var(--ash)', fontSize: 13 }}>Ties on stage wins are broken by outright (unshared) stage wins, then rounds survived. Still level means a shared place.</p>
      </Section>

      <Section title="Prizes" aside="Committed, not paid">
        {totals.size > 0 && (
          <div className={l.tableWrap}>
            <table className={l.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th className={l.num}>Allocated</th>
                </tr>
              </thead>
              <tbody>
                {[...totals.entries()]
                  .sort((a, b) => b[1].cents - a[1].cents)
                  .map(([id, t]) => (
                    <tr key={id} className={id === myId ? l.me : undefined}>
                      <td>{t.name}</td>
                      <td className={l.num}>{money(t.cents, currency)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--dust)', fontFamily: 'var(--f-cond)', fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center' }}>Every line item ({allocations.length})</summary>
          <div className={l.tableWrap}>
            <table className={l.table}>
              <thead>
                <tr>
                  <th>Award</th>
                  <th>To</th>
                  <th className={l.num}>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a, i) => (
                  <tr key={i}>
                    <td>
                      {a.label}
                      {a.note ? <span style={{ color: 'var(--ash)' }}> ({a.note})</span> : null}
                    </td>
                    <td>{a.name ?? '—'}</td>
                    <td className={l.num}>{money(a.amountCents, currency)}</td>
                    <td>{a.status === 'COMMITTED_UNPAID' ? 'Committed' : 'Unawarded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {unawarded > 0 && <p style={{ color: 'var(--dust)', fontSize: 14 }}>{money(unawarded, currency)} went unawarded (no eligible winner) and stays with the sponsor.</p>}
        <Note>These are sponsor commitments calculated by the platform. Payment, if any, happens between the sponsor and players outside this app.</Note>
      </Section>
    </>
  );
}
