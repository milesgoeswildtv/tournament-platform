import { useEffect, useState } from 'react';
import { GAME_META, SPECIAL_AWARD_TYPES, totalCommitmentCents, type RoomView } from '@shared/client';
import { get, post, type Invite } from '../../lib/api';
import { STRUCTURE, money, plural, until } from '../../lib/format';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/controls';
import { Note, Section, Text } from '../../ui/layout';
import { GameMark } from '../../ui/GameMark';
import { Bill, PlayerTag, RoomCount, TagGrid, TicketStub } from '../../ui/venue';
import { ChatPanel } from './Chat';
import { useWide } from '../../lib/media';
import { Icon } from '../../ui/Icon';
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
            <small>{SPECIAL_AWARD_TYPES[a.type]?.describe(a.stage)}</small>
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
  const left = Math.max(0, inv.maxUses - inv.uses);
  return (
    <Section title="Invite" aside={phase === 'LOBBY' ? 'Share it to fill the room' : 'Late entry'}>
      <div className={s.invite}>
        <TicketStub
          code={inv.code}
          void={expired || usedUp}
          line={expired ? 'Expired. Make a new invite below.' : usedUp ? 'Every use is taken. Make a new invite below.' : `Expires in ${until(inv.expiresAt)}, ${inv.uses} of ${inv.maxUses} used`}
          stubValue={left}
          stubLabel={left === 1 ? 'use left' : 'uses left'}
        />
        <div className={s.inviteBtns}>
          <Button icon="share" onClick={share} disabled={expired || usedUp}>
            Share link
          </Button>
          <Button icon="copy" onClick={() => copy(inv.code, 'Code')} disabled={expired || usedUp}>
            Copy code
          </Button>
        </div>
        <div className={s.inviteMore}>
          {inv.telegramLink && (
            <Button size="sm" variant="ghost" icon="telegram" onClick={() => copy(inv.telegramLink!, 'Telegram link')}>
              Copy Telegram link
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="refresh" busy={busy} onClick={regen}>
            New invite (old code stops working)
          </Button>
        </div>
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
  const wide = useWide();

  const actions = isHost ? (
    <>
      <Button variant="primary" size="lg" block disabled={!canStart} onClick={() => send({ t: 'start' })}>
        {canStart ? `Start tournament (${competitors.length} players)` : 'Need 2 players to start'}
      </Button>
      <div className={s.dockRow}>
        <Button icon="edit" to={`/t/${view.id}/edit`}>
          Edit settings
        </Button>
        <Button variant="danger" onClick={onLeave}>
          Cancel
        </Button>
      </div>
    </>
  ) : (
    <div className={s.waitRow}>
      <p className={s.waiting}>
        <i className={s.waitLamp} aria-hidden />
        Waiting for {view.sponsorName} to start. You get a 60-second countdown.
      </p>
      <Button variant="ghost" size="sm" onClick={onLeave}>
        Leave
      </Button>
    </div>
  );

  const total = totalCommitmentCents(c);
  const facts = [
    { label: 'On the line', value: money(total, c.currency) },
    { label: 'Stages', value: c.stages },
    { label: 'Payout', value: STRUCTURE[c.payout.structure].short },
  ];

  return (
    <>
      <div className={s.lobby}>
        <div className={s.lobbyMain}>
          <Bill presents={`${view.sponsorName} presents`} title={view.title} stamp="Lobby open" facts={facts} />

          <section className={s.roomBlock} aria-label="Players">
            <RoomCount n={competitors.length} label={competitors.length === 1 ? 'player in' : 'players in'} sub={`${competitors.length} of ${c.entry.maxPlayers} places taken`} live />
            <TagGrid label="Players in the lobby">
              {present.map((p) => (
                <PlayerTag
                  key={p.id}
                  name={p.name}
                  tag={p.tag}
                  connected={p.connected}
                  host={p.role === 'HOST'}
                  me={p.id === me?.id}
                  note={p.role === 'HOST' && !p.competes ? 'not playing' : p.eligibleFrom > 1 ? `from stage ${p.eligibleFrom}` : undefined}
                />
              ))}
            </TagGrid>
            {!canStart && <Text tone="ash" size="sm">The sponsor can start once two players are in.</Text>}
          </section>

          {isHost && !wide && <InvitePanel tid={view.id} title={view.title} phase={view.phase} />}

          <Section title="Prizes" aside={STRUCTURE[c.payout.structure].label}>
            <PrizeBoard view={view} />
            <Text tone="dust" size="sm">
              {STRUCTURE[c.payout.structure].describe}
            </Text>
          </Section>

          <Section title="Stages" aside={c.games.selection === 'RANDOM' ? 'Random, revealed as you go' : plural(c.stages, 'stage')}>
            <Lineup view={view} />
            <Text tone="dust" size="sm">
              Each stage is one game and may run several rounds. Rounds last {c.timer.minSeconds}–{c.timer.maxSeconds}s, drawn per stage by the server.
              {c.entry.lateEntry ? ` Late entry is open until stage ${c.entry.lateEntryUntilStage} starts.` : ' Entry closes when the tournament starts.'}
            </Text>
          </Section>

          {!wide && (
            <button type="button" className={s.ticker} onClick={openChat}>
              <Icon name="chat" size={18} />
              {last ? (
                <>
                  <b>{last.system ? 'Room' : last.name}</b>
                  <span>{last.text}</span>
                </>
              ) : (
                <span>Open chat</span>
              )}
            </button>
          )}

          <Note>Prizes are the sponsor’s commitment. The platform calculates who earns them; it doesn’t move money.</Note>
        </div>
        {wide && (
          <aside className={s.lobbySide}>
            <div className={s.sideActions}>{actions}</div>
            {isHost && <InvitePanel tid={view.id} title={view.title} phase={view.phase} />}
            <Section title="Chat">
              <div className={s.sideChat}>
                <ChatPanel view={view} onSend={(text) => send({ t: 'chat', text })} />
              </div>
            </Section>
          </aside>
        )}
      </div>

      {!wide && (
        <div className={s.dock}>
          <div className={s.dockInner}>{actions}</div>
        </div>
      )}
    </>
  );
}
