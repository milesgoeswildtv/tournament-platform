import { useEffect } from 'react';
import { get, post, useSession, type Stats, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { ago, money, ordinal } from '../lib/format';
import { Button } from '../ui/controls';
import { Empty, Loading, Page, Row, Rows, Section, Text } from '../ui/layout';
import { MemberCard } from '../ui/venue';
import { TournamentRow } from './HubScreen';

interface Note {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: number;
  read_at: number | null;
}

function record(st: Stats | undefined): [string, string | number][] {
  const v = <T,>(f: (x: Stats) => T) => (st ? f(st) : '–');
  return [
    ['Stage wins', v((x) => x.stageWins)],
    ['Titles', v((x) => x.titles)],
    ['Tournaments', v((x) => x.tournamentsPlayed)],
    ['Best finish', v((x) => (x.bestFinish ? ordinal(x.bestFinish) : '–'))],
    ['Stages played', v((x) => x.stagesPlayed)],
    ['Rounds survived', v((x) => x.roundsSurvived)],
    ['Win rate', v((x) => `${Math.round(x.stageWinRate * 100)}%`)],
    ['Sponsored', v((x) => x.sponsored)],
  ] as [string, string | number][];
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
      <MemberCard
        name={session.user.name}
        id={`Player #${session.user.tag}${session.user.handle ? `, signs in as ${session.user.handle}` : ''}. Member since ${new Date(session.user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`}
        stats={record(st)}
        action={
          <Button size="sm" variant="ghost" to="/settings">
            Edit
          </Button>
        }
      />
      {st && st.prizeAllocations.length > 0 && (
        <Text tone="dust">Prize allocations to you: {st.prizeAllocations.map((p) => money(p.cents, p.currency)).join(' + ')} (sponsor commitments, not payments).</Text>
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
              <Button size="sm" variant="ghost" onClick={() => post('/api/me/notifications/read').then(() => notes.reload())}>
                Mark all read
              </Button>
            ) : undefined
          }
        >
          {(notes.data?.notifications ?? []).length ? (
            <Rows>
              {notes.data!.notifications.map((n) => (
                <Row
                  key={n.id}
                  to={n.link ?? undefined}
                  title={
                    <Text as="span" tone={n.read_at ? 'dust' : 'chalk'} size="lg">
                      {n.title}
                    </Text>
                  }
                  meta={<span>{n.body}</span>}
                  end={
                    <Text as="span" tone="ash" size="sm">
                      {ago(n.created_at)}
                    </Text>
                  }
                />
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
      <MemberCard name={d.player.name} id={`Player #${d.player.tag}`} stats={record(d.stats)} />
      <Section title="Recent tournaments">
        {d.history.length ? (
          <Rows>
            {d.history.map((h) => (
              <Row key={h.id} to={`/t/${h.id}/results`} title={h.title} meta={<span>{h.rank ? `Finished ${ordinal(h.rank)}` : 'Hosted'}{h.stage_wins ? `, ${h.stage_wins} stage wins` : ''}</span>} end={<Text as="span" tone="ash" size="sm">{ago(h.finished_at)}</Text>} />
            ))}
          </Rows>
        ) : (
          <Empty title="No finished tournaments yet" />
        )}
      </Section>
    </Page>
  );
}
