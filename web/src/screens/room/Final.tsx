import { money, ordinal, plural } from '../../lib/format';
import { Note, Section, Text, layoutStyles as l } from '../../ui/layout';
import { Stamp } from '../../ui/live';
import { Scoreboard, type ScoreRow } from '../../ui/venue';
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
  const board: ScoreRow[] = rows.map((r) => ({
    playerId: r.playerId,
    name: r.name,
    rank: r.rank,
    stageWins: r.stageWins,
    detail: `${plural(r.outrightWins, 'outright win')}, ${plural(r.roundsSurvived, 'round')} survived`,
    prize: totals.get(r.playerId) ? `${money(totals.get(r.playerId)!.cents, currency)} allocated` : null,
  }));
  return (
    <>
      <div className={sc.champion}>
        <Text tone="dust" cond>
          {champs.length > 1 ? 'Shared title' : champs.length ? 'Tournament winner' : 'No stage winners'}
        </Text>
        <h1 className={sc.championName}>{champs.length ? champs.map((c) => c.name).join(' + ') : 'Nobody'}</h1>
        {mine && (
          <Text>
            You finished <b>{ordinal(mine.rank)}</b> with {plural(mine.stageWins, 'stage win')}
            {myPrize > 0 ? `, allocated ${money(myPrize, currency)}` : ''}.
          </Text>
        )}
        {mine && mine.rank === 1 && mine.stageWins > 0 && <Stamp tone="live">Champion</Stamp>}
      </div>

      <Section title="Standings" aside="By stage wins">
        <Scoreboard rows={board} myId={myId} />
        <Text tone="ash" size="sm">
          Ties on stage wins are broken by outright (unshared) stage wins, then rounds survived. Still level means a shared place.
        </Text>
      </Section>

      <Section title="Prizes" aside="Committed, not paid">
        <details className={sc.lineItems}>
          <summary>Every line item ({allocations.length})</summary>
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
                      {a.note ? <span className={sc.dim}> ({a.note})</span> : null}
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
        {unawarded > 0 && (
          <Text tone="dust" size="sm">
            {money(unawarded, currency)} went unawarded (no eligible winner) and stays with the sponsor.
          </Text>
        )}
        <Note>These are sponsor commitments calculated by the platform. Payment, if any, happens between the sponsor and players outside this app.</Note>
      </Section>
    </>
  );
}
