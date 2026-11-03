import { get, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { STATUS, ago, money, plural, prizeLine } from '../lib/format';
import { Button } from '../ui/controls';
import { Chip, Empty, Loading, Note, Page, PageHead, Row, Rows, Section } from '../ui/layout';
import { Link } from '../lib/router';
import s from './screens.module.css';

function SponsoredRow({ t }: { t: TournamentSummary }) {
  const st = STATUS[t.status];
  return (
    <Row
      to={t.status === 'FINISHED' ? `/t/${t.id}/results` : `/t/${t.id}`}
      title={t.title}
      meta={
        <>
          <span>{prizeLine(t)}</span>
          <span>{plural(t.players, 'player')}</span>
          <span>Created {ago(t.createdAt)}</span>
        </>
      }
      end={
        <Chip tone={st.tone} dot={t.status === 'RUNNING' || t.status === 'COUNTDOWN'}>
          {t.status === 'RUNNING' ? `Stage ${t.currentStage}/${t.stages}` : st.label}
        </Chip>
      }
    />
  );
}

export function SponsorScreen() {
  const q = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/tournaments?scope=sponsored'));
  const list = q.data?.tournaments ?? [];
  const groups: { title: string; items: TournamentSummary[] }[] = [
    { title: 'Live', items: list.filter((t) => t.status === 'RUNNING' || t.status === 'COUNTDOWN') },
    { title: 'Lobbies', items: list.filter((t) => t.status === 'LOBBY') },
    { title: 'Finished', items: list.filter((t) => t.status === 'FINISHED') },
    { title: 'Canceled or expired', items: list.filter((t) => t.status === 'CANCELED' || t.status === 'ABANDONED') },
  ];
  const active = list.filter((t) => t.status !== 'CANCELED' && t.status !== 'ABANDONED');
  const byCurrency = new Map<string, number>();
  for (const t of active) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + t.commitmentCents);

  return (
    <Page>
      <PageHead title="Sponsor" lede="Put up the prizes, set the stages, run the room. Everything you configure is locked the moment the countdown starts.">
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" size="lg" icon="plus" to="/sponsor/new">
            New tournament
          </Button>
        </div>
      </PageHead>

      {q.loading && !q.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="You haven’t sponsored anything yet">Create a tournament, share the invite link, and start it when your players are in.</Empty>
      ) : (
        <>
          <div className={s.totals}>
            <div className={s.recordStat}>
              <b>{active.length}</b>
              <span>Tournaments</span>
            </div>
            <div className={s.recordStat}>
              <b>{[...byCurrency].map(([c, v]) => money(v, c)).join(' + ') || money(0)}</b>
              <span>Prizes committed</span>
            </div>
            <div className={s.recordStat}>
              <b>{active.reduce((n, t) => n + t.players, 0)}</b>
              <span>Players hosted</span>
            </div>
          </div>
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <Section key={g.title} title={g.title} aside={g.items.length}>
                <Rows>
                  {g.items.map((t) => (
                    <SponsoredRow key={t.id} t={t} />
                  ))}
                </Rows>
                {g.title === 'Finished' && (
                  <p style={{ fontSize: 14, color: 'var(--ash)' }}>
                    Every finished tournament has a full audit trail: open it and choose <Link to={`/t/${g.items[0].id}/audit`}>Audit log</Link>.
                  </p>
                )}
              </Section>
            ))}
        </>
      )}
      <Note>Prize commitments are recorded and allocated here; payment happens outside the platform. Nothing in this app is a completed payment.</Note>
    </Page>
  );
}
