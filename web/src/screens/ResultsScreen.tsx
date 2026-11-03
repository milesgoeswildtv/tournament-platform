import { GAME_META, type GameId, type StageRecord, type TournamentConfig } from '@shared/client';
import { get, useSession, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { STRUCTURE, dateTime, money } from '../lib/format';
import { Button } from '../ui/controls';
import { Empty, Loading, Page, PageHead, Section, Spec, Stack, Text, layoutStyles as l } from '../ui/layout';
import { Bill } from '../ui/venue';
import { GameMark } from '../ui/GameMark';
import { FinalBoard } from './room/Final';
import s from './screens.module.css';

interface Results {
  tournament: TournamentSummary;
  config: TournamentConfig;
  configHash: string;
  standings: { user_id: string; rank: number; stage_wins: number; outright_wins: number; rounds_survived: number; stages_played: number; name: string; tag: string }[];
  allocations: { kind: string; label: string; user_id: string | null; amount_cents: number; status: string; note: string; name: string | null }[];
  awards: { award_id: string; criteria: { label: string; type: string; amountCents: number }; winners: string[]; evidence: Record<string, unknown> }[];
  stages: (StageRecord & { finishedAt: number })[];
  players: { user_id: string; name: string; tag: string; eligible_from: number; left_at: number | null }[];
}

export function ResultsScreen({ id }: { id: string }) {
  const session = useSession();
  const q = useLoad(() => get<Results>(`/api/tournaments/${id}/results`), [id]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error)
    return (
      <Page>
        <Empty title="Results unavailable" action={<Button to="/">Back to the hub</Button>}>
          {q.error.message}
        </Empty>
      </Page>
    );
  const d = q.data!;
  const t = d.tournament;
  const names = new Map(d.players.map((p) => [p.user_id, p.name]));
  const nm = (uid: string) => names.get(uid) ?? 'Player';
  const myId = session?.user.id ?? null;

  if (t.status !== 'FINISHED') {
    return (
      <Page>
        <PageHead title={t.title} lede={t.status === 'CANCELED' || t.status === 'ABANDONED' ? 'This tournament closed before it finished. Nothing was recorded.' : 'Results appear here when the last stage ends.'} />
        <Button to={`/t/${id}`} variant="primary">
          Go to the room
        </Button>
      </Page>
    );
  }

  return (
    <Page wide>
      <div className={s.resultsHead}>
        <Bill
          compact
          presents={`${t.sponsor.name ?? 'A sponsor'} presents`}
          title={t.title}
          stamp="Final"
          facts={[
            { label: 'On the line', value: money(t.commitmentCents, t.currency) },
            { label: 'Stages', value: t.stages },
            { label: 'Players', value: d.standings.length },
          ]}
        />
        <Text tone="ash" size="sm">
          Finished {t.finishedAt ? dateTime(t.finishedAt) : ''}. Results are final and recorded in the audit log.
        </Text>
      </div>
      <div className={l.split}>
        <Stack gap={8}>
          <FinalBoard
            rows={d.standings.map((r) => ({ playerId: r.user_id, name: r.name, rank: r.rank, stageWins: r.stage_wins, outrightWins: r.outright_wins, roundsSurvived: r.rounds_survived, stagesPlayed: r.stages_played }))}
            allocations={d.allocations.map((a) => ({ kind: a.kind, label: a.label, playerId: a.user_id, name: a.name, amountCents: a.amount_cents, status: a.status, note: a.note }))}
            currency={t.currency}
            myId={myId}
          />
        </Stack>
        <Stack gap={8}>
          {d.awards.length > 0 && (
            <Section title="Special awards">
              <Spec items={d.awards.map((a) => [a.criteria.label, a.winners.length ? `${a.winners.map(nm).join(' + ')} (${money(a.criteria.amountCents, t.currency)})` : 'Not awarded'] as [string, string])} />
            </Section>
          )}
          <Section title="Settings used" aside="Locked at start">
            <Spec
              items={[
                ['Payout', STRUCTURE[d.config.payout.structure].label],
                ['Stages', String(d.config.stages)],
                ['Round timer', `${d.config.timer.minSeconds}–${d.config.timer.maxSeconds}s`],
                ['Games', d.config.games.selection === 'RANDOM' ? 'Random' : 'Picked by sponsor'],
                ['Fingerprint', <code key="h" className={s.hash}>{d.configHash.slice(0, 16)}</code>],
              ]}
            />
          </Section>
        </Stack>
      </div>

      <Section title="Stage by stage">
        <div className={s.stagePlates}>
          {d.stages.map((st) => (
            <div className={s.stagePlate} key={st.index}>
              <div className={s.stagePlateHead}>
                <span className={s.stagePlateNo}>{st.index}</span>
                <GameMark id={st.gameId as GameId} size={28} />
              </div>
              <span className={s.stagePlateGame}>
                {GAME_META[st.gameId as GameId].name}, {st.rounds} {GAME_META[st.gameId as GameId].roundNoun.toLowerCase()}
                {st.rounds === 1 ? '' : 's'}
              </span>
              <span className={s.stagePlateWin} data-me={st.winners.includes(myId ?? '') || undefined}>
                {st.winners.length ? st.winners.map(nm).join(' + ') : 'No winner'}
              </span>
              <Text as="span" tone="ash" size="xs">
                {st.summary}
              </Text>
            </div>
          ))}
        </div>
      </Section>
      {t.myRole === 'HOST' && (
        <Button icon="log" to={`/t/${id}/audit`}>
          Open the audit log
        </Button>
      )}
    </Page>
  );
}
