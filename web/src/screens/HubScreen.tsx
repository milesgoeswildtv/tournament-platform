import { useState, type FormEvent } from 'react';
import { get, useSession, type Stats, type TournamentSummary } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { navigate, Link } from '../lib/router';
import { STATUS, ago, money, ordinal, plural, prizeLine } from '../lib/format';
import { Button, TextInput } from '../ui/controls';
import { Chip, Empty, Page, Plate, Row, Rows, Section } from '../ui/layout';
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

  return (
    <Page>
      <Plate cut className={s.record}>
        <div className={s.recordTop}>
          <div>
            <h1 className={s.recordName}>{session?.user.name}</h1>
            <p className={s.recordTag}>#{session?.user.tag}</p>
          </div>
          <Button size="sm" variant="ghost" to="/me">
            Profile
          </Button>
        </div>
        <div className={s.recordLine}>
          <div className={s.recordStat}>
            <b>{st?.stageWins ?? '–'}</b>
            <span>Stage wins</span>
          </div>
          <div className={s.recordStat}>
            <b>{st?.titles ?? '–'}</b>
            <span>Titles</span>
          </div>
          <div className={s.recordStat}>
            <b>{st?.tournamentsPlayed ?? '–'}</b>
            <span>Played</span>
          </div>
          <div className={s.recordStat}>
            <b>{st?.bestFinish ? ordinal(st.bestFinish) : '–'}</b>
            <span>Best finish</span>
          </div>
        </div>
      </Plate>

      {live.map((t) => (
        <Plate key={t.id} live cut>
          <div className={s.liveCard}>
            <Chip tone="live" dot>
              {t.status === 'COUNTDOWN' ? 'Starting now' : `Live: stage ${t.currentStage} of ${t.stages}`}
            </Chip>
            <h2 className={s.liveTitle}>{t.title}</h2>
            <p className={s.liveMeta}>
              <span>{prizeLine(t)}</span>
              <span>{plural(t.players, 'player')}</span>
            </p>
            <Button variant="primary" block size="lg" to={`/t/${t.id}`}>
              Enter the room
            </Button>
          </div>
        </Plate>
      ))}

      <Section title="Join with a code">
        <form className={s.quickJoin} onSubmit={join}>
          <TextInput
            aria-label="Invite code"
            placeholder="Invite code"
            value={code}
            maxLength={12}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ fontFamily: 'var(--f-code)', letterSpacing: '0.18em' }}
          />
          <Button type="submit" variant="secondary" disabled={code.trim().length < 6}>
            Join
          </Button>
        </form>
      </Section>

      {unread.length > 0 && (
        <Section title="Inbox" aside={<Link to="/me#inbox">All</Link>}>
          <Rows>
            {unread.map((n) => (
              <Row key={n.id} to={n.link ?? undefined} title={n.title} meta={<span>{n.body}</span>} end={<span style={{ fontSize: 13 }}>{ago(n.created_at)}</span>} />
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
          <Empty title="No lobbies yet">Join with an invite code, or sponsor a tournament and invite your crew.</Empty>
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

      <nav className={s.hubNav} aria-label="Sections">
        <Link to="/sponsor">
          <Icon name="sponsor" />
          <b>Sponsor</b>
        </Link>
        <Link to="/join">
          <Icon name="join" />
          <b>Join</b>
        </Link>
        <Link to="/games">
          <Icon name="library" />
          <b>Game library</b>
        </Link>
        <Link to="/ranks">
          <Icon name="ranks" />
          <b>Leaderboards</b>
        </Link>
        <Link to="/me">
          <Icon name="profile" />
          <b>Profile</b>
        </Link>
        <Link to="/settings">
          <Icon name="settings" />
          <b>Settings</b>
        </Link>
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
          <p style={{ color: 'var(--dust)', fontSize: 14 }}>
            Prize allocations to you: {st.prizeAllocations.map((p) => money(p.cents, p.currency)).join(' + ')} in sponsor commitments (not payments).
          </p>
        )}
      </Section>
    </Page>
  );
}
