import { useState, type FormEvent } from 'react';
import { get, useSession, type Stats, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { navigate, Link } from '../lib/router';
import { STATUS, ago, money, ordinal, plural, prizeLine } from '../lib/format';
import { Button, TextInput } from '../ui/controls';
import { Chip, Empty, Page, Row, Rows, Section, Text } from '../ui/layout';
import { Hazard } from '../ui/live';
import { MemberCard } from '../ui/venue';
import { Icon } from '../ui/Icon';
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

export function TournamentRow({ t, mine = true }: { t: TournamentSummary; mine?: boolean }) {
  const st = STATUS[t.status];
  const live = t.status === 'RUNNING' || t.status === 'COUNTDOWN';
  const to = t.status === 'FINISHED' ? `/t/${t.id}/results` : `/t/${t.id}`;
  return (
    <Row
      to={to}
      title={t.title}
      meta={
        <>
          <span>{t.status === 'RUNNING' ? `Stage ${t.currentStage} of ${t.stages}` : plural(t.stages, 'stage')}</span>
          <span>{prizeLine(t)}</span>
          <span>{plural(t.players, 'player')}</span>
          {mine && t.myRole === 'HOST' && <span>You host</span>}
          {t.status === 'FINISHED' && t.myRank && <span>Finished {ordinal(t.myRank)}</span>}
        </>
      }
      end={
        <>
          <Chip tone={st.tone} dot={live}>
            {st.label}
          </Chip>
          <Icon name="next" size={18} />
        </>
      }
    />
  );
}

function Door({ to, icon, title, children }: { to: string; icon: 'sponsor' | 'library' | 'ranks'; title: string; children: string }) {
  return (
    <Link to={to} className={s.door}>
      <Icon name={icon} size={26} />
      <span className={s.doorText}>
        <b>{title}</b>
        <span>{children}</span>
      </span>
    </Link>
  );
}

export function HubScreen() {
  const session = useSession();
  const me = useLoad(() => get<{ stats: Stats; unread: number }>('/api/me'));
  const mine = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/tournaments?scope=mine'));
  const pub = useLoad(() => get<{ tournaments: TournamentSummary[] }>('/api/tournaments?scope=public'));
  const notes = useLoad(() => get<{ notifications: Note[] }>('/api/me/notifications'));
  const [code, setCode] = useState('');

  const list = (mine.data?.tournaments ?? []).filter((t) => !t.left);
  const live = list.filter((t) => t.status === 'RUNNING' || t.status === 'COUNTDOWN');
  const upcoming = list.filter((t) => t.status === 'LOBBY');
  const history = list.filter((t) => t.status === 'FINISHED').slice(0, 8);
  const mineIds = new Set(list.map((t) => t.id));
  const open = (pub.data?.tournaments ?? []).filter((t) => !mineIds.has(t.id) && t.status !== 'FINISHED').slice(0, 5);
  const unread = (notes.data?.notifications ?? []).filter((n) => !n.read_at).slice(0, 3);
  const st = me.data?.stats;

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) navigate(`/j/${c}`);
  };

  const stats: [string, string | number][] = [
    ['Stage wins', st?.stageWins ?? '–'],
    ['Titles', st?.titles ?? '–'],
    ['Played', st?.tournamentsPlayed ?? '–'],
    ['Best finish', st?.bestFinish ? ordinal(st.bestFinish) : '–'],
  ];

  return (
    <Page>
      <MemberCard
        name={session?.user.name ?? ''}
        id={`Player #${session?.user.tag}`}
        stats={stats}
        action={
          <Button size="sm" variant="ghost" to="/me">
            Profile
          </Button>
        }
      />

      {live.map((t) => (
        <Link key={t.id} to={`/t/${t.id}`} className={s.liveNow}>
          <Hazard />
          <span className={s.liveBody}>
            <Chip tone="live" dot>
              {t.status === 'COUNTDOWN' ? 'Starting now' : `Live: stage ${t.currentStage} of ${t.stages}`}
            </Chip>
            <span className={s.liveTitle}>{t.title}</span>
            <Text tone="dust" size="sm">
              {prizeLine(t)}, {plural(t.players, 'player')}
            </Text>
            <span className={s.liveGo}>
              Enter the room <Icon name="next" size={20} />
            </span>
          </span>
        </Link>
      ))}

      <Section title="Join with a code">
        <form className={s.quickJoin} onSubmit={join}>
          <TextInput
            aria-label="Invite code"
            placeholder="8-character code"
            value={code}
            maxLength={12}
            mono
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" variant="primary" disabled={code.trim().length < 6}>
            Join
          </Button>
        </form>
      </Section>

      {unread.length > 0 && (
        <Section title="Inbox" aside={<Link to="/me#inbox">All</Link>}>
          <Rows>
            {unread.map((n) => (
              <Row key={n.id} to={n.link ?? undefined} title={n.title} meta={<span>{n.body}</span>} end={<Text as="span" tone="ash" size="sm">{ago(n.created_at)}</Text>} />
            ))}
          </Rows>
        </Section>
      )}

      <Section title="Your lobbies" aside={upcoming.length ? plural(upcoming.length, 'open') : undefined}>
        {upcoming.length ? (
          <Rows>
            {upcoming.map((t) => (
              <TournamentRow key={t.id} t={t} />
            ))}
          </Rows>
        ) : (
          <Empty title="No lobbies yet">Enter an invite code above, or sponsor a tournament and invite your crew.</Empty>
        )}
      </Section>

      {open.length > 0 && (
        <Section title="Open to everyone">
          <Rows>
            {open.map((t) => (
              <TournamentRow key={t.id} t={t} mine={false} />
            ))}
          </Rows>
        </Section>
      )}

      <nav className={s.doors} aria-label="More">
        <Door to="/sponsor" icon="sponsor" title="Sponsor a tournament">
          Put up the prize, pick the games, run the room.
        </Door>
        <Door to="/games" icon="library" title="Game library">
          Seven games. Learn the rules before they count.
        </Door>
      </nav>

      <Section title="History">
        {history.length ? (
          <Rows>
            {history.map((t) => (
              <TournamentRow key={t.id} t={t} />
            ))}
          </Rows>
        ) : (
          <Empty title="Nothing finished yet">Your results land here after your first tournament.</Empty>
        )}
        {st && st.prizeAllocations.length > 0 && (
          <Text tone="dust" size="sm">
            Prize allocations to you: {st.prizeAllocations.map((p) => money(p.cents, p.currency)).join(' + ')} in sponsor commitments (not payments).
          </Text>
        )}
      </Section>
    </Page>
  );
}
