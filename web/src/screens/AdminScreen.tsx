import { get, useSession, type TournamentSummary } from '../lib/api';
import { Link } from '../lib/router';
import { useLoad } from '../lib/useLoad';
import { STATUS, dateTime, money } from '../lib/format';
import { Chip, Empty, Loading, Page, PageHead, Row, Rows } from '../ui/layout';

export function AdminScreen() {
  const session = useSession();
  const q = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/admin/tournaments'));
  if (!session?.user.isAdmin) return <Page><Empty title="Admins only">This page lists every tournament for fair-play review.</Empty></Page>;
  if (q.loading && !q.data) return <Loading />;
  return (
    <Page>
      <PageHead title="Admin" lede="Every tournament on the platform. Open one to see its full audit trail." />
      <p><Link to="/admin/bots">Open bot lab →</Link></p>
      <Rows>
        {(q.data?.tournaments ?? []).map((t) => (
          <Row
            key={t.id}
            to={`/t/${t.id}/audit`}
            title={t.title}
            meta={
              <>
                <span>{t.sponsor.name}</span>
                <span>{dateTime(t.createdAt)}</span>
                <span>{t.players} players</span>
                <span>{money(t.commitmentCents, t.currency)}</span>
              </>
            }
            end={<Chip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Chip>}
          />
        ))}
      </Rows>
    </Page>
  );
}
