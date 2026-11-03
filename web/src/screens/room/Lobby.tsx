import { useEffect, useState } from 'react';
import { GAME_META, SPECIAL_AWARD_TYPES, totalCommitmentCents, type RoomView } from '@shared/client';
import { get, post, type Invite } from '../../lib/api';
import { STRUCTURE, money, plural, until } from '../../lib/format';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/controls';
import { Chip, Note, Section, Who } from '../../ui/layout';
import { GameMark } from '../../ui/GameMark';
import { ChatPanel } from './Chat';
import s from './room.module.css';

export function PrizeBoard({ view }: { view: RoomView }) {
  const c = view.config;
  const cur = c.currency;
  return (
    <div className={s.prizes}>
      {c.payout.structure !== 'MOST_WINS' && (
        <div className={s.prize}>
          <span>Each stage winner</span>
          <b>{money(c.payout.stageAwardCents, cur)}</b>
        </div>
      )}
      {c.payout.structure !== 'PER_STAGE' && (
        <div className={s.prize}>
          <span>Most stage wins</span>
          <b>{money(c.payout.finalAwardCents, cur)}</b>
        </div>
      )}
      {c.specialAwards.map((a) => (
        <div className={s.prize} key={a.id}>
          <span>
            {a.label}
            <br />
            <small style={{ color: 'var(--ash)' }}>{SPECIAL_AWARD_TYPES[a.type]?.describe(a.stage)}</small>
          </span>
          <b>{money(a.amountCents, cur)}</b>
        </div>
      ))}
      <div className={`${s.prize} ${s.prizeTotal}`}>
        <span>Sponsor commitment</span>
        <b>{money(totalCommitmentCents(c), cur)}</b>
      </div>
    </div>
  );
}

export function Lineup({ view }: { view: RoomView }) {
  return (
    <div className={s.lineup}>
      {view.lineup.map((g, i) => (
        <div key={i} className={s.slot} data-now={view.currentStage === i + 1} data-done={view.currentStage > i + 1} title={g ? GAME_META[g].name : 'Hidden until it starts'}>
          <span className={s.slotNo}>{i + 1}</span>
          <GameMark id={g} size={28} />
        </div>
      ))}
    </div>
  );
}

function InvitePanel({ tid, title, phase }: { tid: string; title: string; phase: string }) {
  const [inv, setInv] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ invite: Invite | null }>(`/api/tournaments/${tid}/invite`).then((r) => setInv(r.invite)).catch(() => {});
  }, [tid]);
  const regen = async () => {
    setBusy(true);
    try {
      const r = await post<{ invite: Invite }>(`/api/tournaments/${tid}/invite`);
      setInv(r.invite);
      toast('New invite ready. The old code no longer works.', 'good');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, 'good');
    } catch {
      toast('Copy failed. Press and hold the code to copy it.', 'error');
    }
  };
  const share = async () => {
    if (!inv) return;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Join ${title} — code ${inv.code}`, url: inv.link });
        return;
      } catch {
        /* dismissed */
      }
    }
    void copy(inv.link, 'Invite link');
  };
  if (!inv) return null;
  const expired = inv.expiresAt <= Date.now();
  const usedUp = inv.uses >= inv.maxUses;
  return (
    <Section title="Invite" aside={phase === 'LOBBY' ? undefined : 'Late entry'}>
      <div className={s.invite}>
        <div className={s.code} aria-label={`Invite code ${inv.code.split('').join(' ')}`}>
          {inv.code}
        </div>
        <div className={s.inviteMeta}>
          <Chip tone={expired ? 'stop' : 'info'}>{expired ? 'Expired' : `Expires in ${until(inv.expiresAt)}`}</Chip>
          <Chip tone={usedUp ? 'stop' : 'muted'}>
            {inv.uses} of {inv.maxUses} used
          </Chip>
        </div>
        <div className={s.inviteBtns}>
          <Button icon="share" onClick={share} disabled={expired || usedUp}>
            Share link
          </Button>
          <Button icon="copy" onClick={() => copy(inv.code, 'Code')}>
            Copy code
          </Button>
        </div>
        {inv.telegramLink && (
          <Button size="sm" variant="ghost" icon="telegram" onClick={() => copy(inv.telegramLink!, 'Telegram link')}>
            Copy Telegram link
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="refresh" busy={busy} onClick={regen}>
          Make a new invite (old one stops working)
        </Button>
      </div>
    </Section>
  );
}

export function Lobby({ view, send, openChat, onLeave }: { view: RoomView; send: (m: any) => boolean; openChat: () => void; onLeave: () => void }) {
  const me = view.me;
  const isHost = !!me?.isSponsor;
  const competitors = view.players.filter((p) => p.competes && !p.left);
  const present = view.players.filter((p) => !p.left);
  const canStart = competitors.length >= 2;
  const last = [...view.chat].reverse().find((m) => !m.system) ?? view.chat[view.chat.length - 1];
  const c = view.config;

  const actions = (
    <>
          {isHost ? (
            <>
              <Button variant="primary" size="lg" block disabled={!canStart} onClick={() => send({ t: 'start' })}>
                {canStart ? `Start tournament (${competitors.length} players)` : 'Need 2 competitors to start'}
              </Button>
              <div className={s.dockRow}>
                <Button icon="edit" to={`/t/${view.id}/edit`}>
                  Edit settings
                </Button>
                <Button variant="danger" onClick={onLeave}>
                  Cancel tournament
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className={s.waiting}>Waiting for {view.sponsorName} to start. You’ll get a 60-second countdown.</p>
              <Button variant="ghost" onClick={onLeave}>
                Leave lobby
              </Button>
            </>
          )}
    </>
  );

  return (
    <>
      <div className={s.lobby}>
        <header className={s.lobbyHead}>
          <Chip tone="info" dot>
            Lobby open
          </Chip>
          <h1 className={s.lobbyTitle}>{view.title}</h1>
          <p className={s.host}>
            Hosted by <b>{view.sponsorName}</b>. {STRUCTURE[c.payout.structure].describe}
          </p>
        </header>

        <div className={s.lobbyMain}>
        <PrizeBoard view={view} />

        {isHost && <div className={s.phoneOnly}><InvitePanel tid={view.id} title={view.title} phase={view.phase} /></div>}

        <Section title="Players" aside={`${competitors.length} of ${c.entry.maxPlayers}`}>
          <div className={s.players}>
            {present.map((p) => (
              <div className={s.player} key={p.id} data-player={p.name}>
                <Who name={p.name} tag={p.tag} />
                <div className={s.playerEnd}>
                  {p.role === 'HOST' && <Chip tone="live">{p.competes ? 'Host, playing' : 'Host'}</Chip>}
                  {p.eligibleFrom > 1 && <Chip>From stage {p.eligibleFrom}</Chip>}
                  {p.id === me?.id && <Chip tone="info">You</Chip>}
                  <span className={s.conDot} data-on={p.connected} title={p.connected ? 'Connected' : 'Not connected'} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Stages" aside={c.games.selection === 'RANDOM' ? 'Random, revealed as you go' : plural(c.stages, 'stage')}>
          <Lineup view={view} />
          <p style={{ color: 'var(--dust)', fontSize: 14 }}>
            Each stage is one game and may run several rounds. Round timer {c.timer.minSeconds}–{c.timer.maxSeconds}s, drawn per stage by the server.
            {c.entry.lateEntry ? ` Late entry is open until stage ${c.entry.lateEntryUntilStage} starts.` : ' Entry closes when the tournament starts.'}
          </p>
        </Section>

        <button type="button" className={`${s.ticker} ${s.phoneOnly}`} onClick={openChat}>
          {last ? (
            <>
              <b>{last.system ? 'Room' : last.name}</b>
              <span>{last.text}</span>
            </>
          ) : (
            <span>Open chat</span>
          )}
        </button>

        <Note>Prizes are the sponsor’s commitment. The platform calculates who earns them; it doesn’t move money.</Note>
        </div>
        <aside className={s.lobbySide}>
          <div className={s.sideActions}>{actions}</div>
          {isHost && <InvitePanel tid={view.id} title={view.title} phase={view.phase} />}
          <Section title="Chat">
            <div className={s.sideChat}>
              <ChatPanel view={view} onSend={(text) => send({ t: 'chat', text })} />
            </div>
          </Section>
        </aside>
      </div>

      <div className={`${s.dock} ${s.phoneOnly}`}>
        <div className={s.dockInner}>{actions}</div>
      </div>
    </>
  );
}
