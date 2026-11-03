import { useEffect } from 'react';
import { get, post, useSession, type Stats, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { ago, money, ordinal } from '../lib/format';
import { Button } from '../ui/controls';
import { Empty, Loading, Page, Plate, Row, Rows, Section, Stats as StatGrid } from '../ui/layout';
import { TournamentRow } from './HubScreen';
import s from './screens.module.css';

interface Note {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

function StatBlock({ st }: { st: Stats }) {
  return (
    <StatGrid
      items={[
        { label: 'Stage wins', value: st.stageWins },
        { label: 'Titles', value: st.titles },
        { label: 'Tournaments', value: st.tournamentsPlayed },
        { label: 'Stages played', value: st.stagesPlayed },
        { label: 'Rounds survived', value: st.roundsSurvived },
        { label: 'Stage win rate', value: `${Math.round(st.stageWinRate * 100)}%` },
        { label: 'Best finish', value: st.bestFinish ? ordinal(st.bestFinish) : '–' },
        { label: 'Sponsored', value: st.sponsored },
      ]}
    />
  );
}

export function ProfileScreen({ tag }: { tag?: string }) {
  const session = useSession();
  const isMe = !tag || tag.toUpperCase() === session?.user.tag;
  return isMe ? <MyProfile /> : <OtherProfile tag={tag!} />;
}

function MyProfile() {
  const session = useSession();
  const me = useLoad(() => get<{ stats: Stats; telegram: { configured: boolean; linked: boolean } }>('/api/me'));
  const list = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/tournaments?scope=mine'));
  const notes = useLoad(() => get<{ notifications: Note[] }>('/api/me/notifications'));
  const unread = (notes.data?.notifications ?? []).some((n) => !n.read_at);
  useEffect(() => {
    if (window.location.hash === '#inbox') document.getElementById('inbox')?.scrollIntoView();
  }, [notes.data]);
  if (!session) return null;
  const st = me.data?.stats;
  const history = (list.data?.tournaments ?? []).filter((t) => t.status === 'FINISHED');
  return (
    <Page>
      <Plate cut className={s.record}>
        <div className={s.recordTop}>
          <div>
            <h1 className={s.recordName}>{session.user.name}</h1>
            <p className={s.recordTag}>
              Player ID #{session.user.tag}
              {session.user.handle ? `, signs in as ${session.user.handle}` : ''}
            </p>
          </div>
          <Button size="sm" variant="ghost" to="/settings">
            Edit
          </Button>
        </div>
        <p style={{ color: 'var(--ash)', fontSize: 14 }}>Member since {new Date(session.user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
      </Plate>
      {st ? <StatBlock st={st} /> : <Loading />}
      {st && st.prizeAllocations.length > 0 && (
        <p style={{ color: 'var(--dust)' }}>Prize allocations to you: {st.prizeAllocations.map((p) => money(p.cents, p.currency)).join(' + ')} (sponsor commitments, not payments).</p>
      )}
      <Section title="Tournament history" aside={history.length || undefined}>
        {history.length ? (
          <Rows>
            {history.map((t) => (
              <TournamentRow key={t.id} t={t} />
            ))}
          </Rows>
        ) : (
          <Empty title="No finished tournaments yet" action={<Button to="/join">Find one to join</Button>} />
        )}
      </Section>
      <section id="inbox">
        <Section
          title="Inbox"
          aside={
            unread ? (
              <button type="button" style={{ background: 'none', border: 0, color: 'var(--fluoro)', fontFamily: 'var(--f-cond)', fontWeight: 600, minHeight: 32 }} onClick={() => post('/api/me/notifications/read').then(() => notes.reload())}>
                Mark all read
              </button>
            ) : undefined
          }
        >
          {(notes.data?.notifications ?? []).length ? (
            <Rows>
              {notes.data!.notifications.map((n) => (
                <Row key={n.id} to={n.link ?? undefined} title={<span style={{ color: n.read_at ? 'var(--dust)' : undefined }}>{n.title}</span>} meta={<span>{n.body}</span>} end={<span style={{ fontSize: 13 }}>{ago(n.created_at)}</span>} />
              ))}
            </Rows>
          ) : (
            <Empty title="Nothing here">Countdown alerts and final results land here{me.data?.telegram.linked ? ' and in Telegram' : ''}.</Empty>
          )}
        </Section>
      </section>
    </Page>
  );
}

function OtherProfile({ tag }: { tag: string }) {
  const q = useLoad(() => get<{ player: { tag: string; name: string; createdAt: number }; stats: Stats; history: { id: string; title: string; rank: number | null; stage_wins: number | null; finished_at: number }[] }>(`/api/players/${tag}`), [tag]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <Page><Empty title="Player not found">{q.error.message}</Empty></Page>;
  const d = q.data!;
  return (
    <Page>
      <Plate cut className={s.record}>
        <div>
          <h1 className={s.recordName}>{d.player.name}</h1>
          <p className={s.recordTag}>#{d.player.tag}</p>
        </div>
      </Plate>
      <StatBlock st={d.stats} />
      <Section title="Recent tournaments">
        {d.history.length ? (
          <Rows>
            {d.history.map((h) => (
              <Row key={h.id} to={`/t/${h.id}/results`} title={h.title} meta={<span>{h.rank ? `Finished ${ordinal(h.rank)}` : 'Hosted'}{h.stage_wins ? `, ${h.stage_wins} stage wins` : ''}</span>} end={<span style={{ fontSize: 13 }}>{ago(h.finished_at)}</span>} />
            ))}
          </Rows>
        ) : (
          <Empty title="No finished tournaments yet" />
        )}
      </Section>
    </Page>
  );
}
