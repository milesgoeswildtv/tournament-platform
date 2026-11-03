import { useState } from 'react';
import { get, useSession } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { Link } from '../lib/router';
import { Segmented } from '../ui/controls';
import { Empty, Loading, Page, PageHead } from '../ui/layout';
import s from './screens.module.css';

type Metric = 'stage_wins' | 'titles' | 'survival' | 'played';
type Period = 'all' | '30d' | '7d';
interface RankRow {
  tag: string;
  name: string;
  stage_wins: number;
  titles: number;
  rounds_survived: number;
  played: number;
  best: number;
}

const METRIC: Record<Metric, { label: string; value: (r: RankRow) => number; unit: string }> = {
  stage_wins: { label: 'Stage wins', value: (r) => r.stage_wins, unit: 'stage wins' },
  titles: { label: 'Titles', value: (r) => r.titles, unit: 'titles' },
  survival: { label: 'Survival', value: (r) => r.rounds_survived, unit: 'rounds' },
  played: { label: 'Played', value: (r) => r.played, unit: 'played' },
};

export function RanksScreen() {
  const session = useSession();
  const [metric, setMetric] = useState<Metric>('stage_wins');
  const [period, setPeriod] = useState<Period>('all');
  const q = useLoad(() => get<{ rows: RankRow[] }>(`/api/leaderboard?metric=${metric}&period=${period}`), [metric, period]);
  const rows = q.data?.rows ?? [];
  const m = METRIC[metric];
  return (
    <Page>
      <PageHead title="Leaderboards" lede="Counted from finished tournaments only." />
      <div className={s.filters}>
        <Segmented label="Ranking" value={metric} onChange={setMetric} options={(Object.keys(METRIC) as Metric[]).map((k) => ({ value: k, label: METRIC[k].label }))} />
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'all', label: 'All time' },
            { value: '30d', label: '30 days' },
            { value: '7d', label: '7 days' },
          ]}
        />
      </div>
      {q.loading && !q.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="No results yet">The board fills in as tournaments finish.</Empty>
      ) : (
        <div>
          {rows.map((r, i) => (
            <Link key={r.tag} to={`/p/${r.tag}`} className={`${s.rankRow} ${i < 3 ? s.rankTop : ''} ${r.tag === session?.user.tag ? s.isMe : ''}`}>
              <span className={s.rankNo}>{i + 1}</span>
              <span>
                <b style={{ fontWeight: 600 }}>{r.name}</b>
                <br />
                <span style={{ fontSize: 13, color: 'var(--ash)' }}>
                  {r.titles} title{r.titles === 1 ? '' : 's'}, {r.played} played
                </span>
              </span>
              <span className={s.rankVal}>
                {m.value(r)}
                <small>{m.unit}</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
