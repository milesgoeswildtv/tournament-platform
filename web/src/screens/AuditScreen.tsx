import { useState } from 'react';
import { get, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { clockTime, dateTime } from '../lib/format';
import { Button, Segmented } from '../ui/controls';
import { Empty, Loading, Note, Page, PageHead, Section, layoutStyles as l } from '../ui/layout';
import { Link } from '../lib/router';
import s from './screens.module.css';

interface Audit {
  tournament: TournamentSummary;
  sequence: string[];
  events: { seq: number; type: string; actor_id: string | null; payload: Record<string, unknown>; created_at: number }[];
  submissions: { stage: number; round: number; user_id: string; name: string; action_json: string; accepted: number; reject_reason: string | null; received_at: number }[];
  eliminations: { stage: number; round: number; user_id: string; name: string; reason: string; created_at: number }[];
  participants: { user_id: string; name: string; tag: string; role: string; competes: number; eligible_from: number; via_invite: string | null; joined_at: number; left_at: number | null }[];
  configHistory: { id: number; actor_id: string; config_hash: string; reason: string; created_at: number; config_json: string }[];
  disconnections: { type: string; actor_id: string; created_at: number; payload: Record<string, unknown> }[];
}

type Tab = 'events' | 'submissions' | 'eliminations' | 'players' | 'connections' | 'config';

const ms = (t: number) => `${clockTime(t)}.${String(t % 1000).padStart(3, '0')}`;
const human = (type: string) => type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');

export function AuditScreen({ id }: { id: string }) {
  const q = useLoad(() => get<Audit>(`/api/tournaments/${id}/audit`), [id]);
  const [tab, setTab] = useState<Tab>('events');
  if (q.loading && !q.data) return <Loading />;
  if (q.error)
    return (
      <Page>
        <Empty title="Audit log unavailable" action={<Button to="/">Back to the hub</Button>}>
          {q.error.message}
        </Empty>
      </Page>
    );
  const d = q.data!;
  const who = new Map(d.participants.map((p) => [p.user_id, p.name]));
  const nm = (uid: string | null) => (uid ? who.get(uid) ?? uid : 'Server');

  return (
    <Page wide>
      <PageHead title="Audit log" lede={<>Every server decision for <Link to={`/t/${id}`}>{d.tournament.title}</Link>, in order. Rows are append-only; the database refuses edits.</>} />
      <div className={s.tabsRow}>
        <Segmented<Tab>
          label="Audit section"
          scroll
          value={tab}
          onChange={setTab}
          options={[
            { value: 'events', label: `Events ${d.events.length}` },
            { value: 'submissions', label: `Submissions ${d.submissions.length}` },
            { value: 'eliminations', label: `Out ${d.eliminations.length}` },
            { value: 'players', label: `Players ${d.participants.length}` },
            { value: 'connections', label: `Links ${d.disconnections.length}` },
            { value: 'config', label: `Config ${d.configHistory.length}` },
          ]}
        />
      </div>

      <Section title={{ events: 'Event history', submissions: 'Submissions', eliminations: 'Eliminations', players: 'Participation', connections: 'Disconnects and reconnects', config: 'Sponsor configuration history' }[tab]}>
        <div className={l.tableWrap}>
          {tab === 'events' && (
            <ol className={s.log}>
              {d.events.map((e) => (
                <li key={e.seq} className={s.logRow}>
                  <span className={s.logSeq}>{e.seq}</span>
                  <div className={s.logMain}>
                    <b>{human(e.type)}</b>
                    <span>
                      {ms(e.created_at)}, {nm(e.actor_id)}
                    </span>
                    <details>
                      <summary>
                        <code>{e.type}</code>
                      </summary>
                      <pre className={s.payload}>{JSON.stringify(e.payload, null, 2)}</pre>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {tab === 'submissions' && (
            <table className={l.table}>
              <thead>
                <tr><th>Received</th><th>Stage</th><th>Round</th><th>Player</th><th>Action</th><th>Result</th></tr>
              </thead>
              <tbody>
                {d.submissions.map((x, i) => (
                  <tr key={i}>
                    <td className={s.nowrap}>{ms(x.received_at)}</td>
                    <td>{x.stage}</td>
                    <td>{x.round}</td>
                    <td>{x.name}</td>
                    <td><code className={s.payload}>{x.action_json}</code></td>
                    <td className={x.accepted ? s.ok : s.bad}>{x.accepted ? 'Accepted' : `Rejected: ${x.reject_reason}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'eliminations' && (
            <table className={l.table}>
              <thead>
                <tr><th>Time</th><th>Stage</th><th>Round</th><th>Player</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {d.eliminations.map((x, i) => (
                  <tr key={i}>
                    <td className={s.nowrap}>{ms(x.created_at)}</td>
                    <td>{x.stage}</td>
                    <td>{x.round}</td>
                    <td>{x.name}</td>
                    <td>{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'players' && (
            <table className={l.table}>
              <thead>
                <tr><th>Player</th><th>Role</th><th>Joined</th><th>Eligible from</th><th>Invite</th><th>Left</th></tr>
              </thead>
              <tbody>
                {d.participants.map((p) => (
                  <tr key={p.user_id}>
                    <td>
                      {p.name} <span className={s.dim}>#{p.tag}</span>
                    </td>
                    <td>{p.role === 'HOST' ? (p.competes ? 'Host (playing)' : 'Host') : 'Player'}</td>
                    <td>{dateTime(p.joined_at)}</td>
                    <td>Stage {p.eligible_from}</td>
                    <td>{p.via_invite ?? '—'}</td>
                    <td>{p.left_at ? dateTime(p.left_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'connections' && (
            <table className={l.table}>
              <thead>
                <tr><th>Time</th><th>Player</th><th>Change</th><th>Phase</th><th>Stage / round</th></tr>
              </thead>
              <tbody>
                {d.disconnections.map((x, i) => (
                  <tr key={i}>
                    <td className={s.nowrap}>{ms(x.created_at)}</td>
                    <td>{nm(x.actor_id)}</td>
                    <td className={x.type === 'PLAYER_DISCONNECTED' ? s.bad : s.ok}>{x.type === 'PLAYER_DISCONNECTED' ? 'Disconnected' : 'Connected'}</td>
                    <td>{String(x.payload.phase ?? '')}</td>
                    <td>{String(x.payload.stage ?? 0)} / {String(x.payload.round ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'config' && (
            <table className={l.table}>
              <thead>
                <tr><th>Saved</th><th>Why</th><th>Fingerprint</th><th>Settings</th></tr>
              </thead>
              <tbody>
                {d.configHistory.map((c) => (
                  <tr key={c.id}>
                    <td>{dateTime(c.created_at)}</td>
                    <td>{c.reason}</td>
                    <td><code className={s.payload}>{c.config_hash.slice(0, 16)}</code></td>
                    <td><details><summary className={s.summary}>View</summary><pre className={s.payload}>{JSON.stringify(JSON.parse(c.config_json), null, 2)}</pre></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>
      <Note>Stage lineup as generated by the server: {d.sequence.join(', ')}.</Note>
    </Page>
  );
}
