import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAME_META, type RoomView } from '@shared/client';
import { ApiError, get, post, type TournamentSummary } from '../lib/api';
import { useRoom } from '../lib/room';
import { useWide } from '../lib/media';
import { navigate } from '../lib/router';
import { useLoad } from '../lib/useLoad';
import { audio } from '../lib/audio';
import { music } from '../lib/music';
import { toast } from '../lib/toast';
import { Button, IconButton } from '../ui/controls';
import { Chip, Loading, Stack, StatusScreen, Text, Who } from '../ui/layout';
import { Bill } from '../ui/venue';
import { BILL_STAMP, money, prizeLine } from '../lib/format';
import { Sheet } from '../ui/shell';
import { ChatPanel } from './room/Chat';
import { Lobby } from './room/Lobby';
import { Countdown, StageFloor, StageIntro, StageResult } from './room/Floor';
import { FinalBoard } from './room/Final';
import s from './room/room.module.css';

export function RoomScreen({ id }: { id: string }) {
  const gate = useLoad(() => get<{ tournament: TournamentSummary; member: boolean; isSponsor: boolean }>(`/api/tournaments/${id}`), [id]);
  const [joining, setJoining] = useState(false);
  if (gate.loading && !gate.data) return <Loading label="Opening the room" />;
  if (gate.error) {
    return (
      <StatusScreen
        title={gate.error.status === 404 ? 'No such tournament' : 'Invite only'}
        actions={
          <>
            <Button to="/join" variant="primary" block>
              Enter an invite code
            </Button>
            <Button to="/" variant="ghost" block>
              Back to the hub
            </Button>
          </>
        }
      >
        <Text tone="dust">{gate.error.status === 404 ? 'This link doesn’t point to a tournament. Check it with whoever sent it.' : gate.error.message}</Text>
      </StatusScreen>
    );
  }
  const g = gate.data!;
  if (!g.tournament.myRole) {
    const join = async () => {
      setJoining(true);
      try {
        await post('/api/join', { tournamentId: id });
        await gate.reload();
      } catch (e) {
        toast((e as ApiError).message, 'error');
      } finally {
        setJoining(false);
      }
    };
    const t = g.tournament;
    return (
      <main className={s.gate}>
        <Bill
          presents={`${t.sponsor.name ?? 'A sponsor'} presents`}
          title={t.title}
          stamp={BILL_STAMP[t.status]}
          facts={[
            { label: 'On the line', value: money(t.commitmentCents, t.currency) },
            { label: 'Stages', value: t.stages },
            { label: 'Players', value: `${t.players}/${t.maxPlayers}` },
          ]}
        />
        <Text tone="dust">Open to everyone. {prizeLine(t)}.</Text>
        <Button variant="primary" size="lg" block busy={joining} onClick={join}>
          Join tournament
        </Button>
        <Button to="/" variant="ghost" block>
          Back to the hub
        </Button>
      </main>
    );
  }
  return <Room id={id} />;
}

function Room({ id }: { id: string }) {
  const { view, status, send, serverNow } = useRoom(id);
  const wide = useWide();
  const [sheet, setSheet] = useState<null | 'chat' | 'players' | 'menu' | 'confirm-leave'>(null);
  const seenChat = useRef(0);
  const [, force] = useState(0);
  const prevPhase = useRef<string | null>(null);

  const name = useCallback((pid: string) => view?.players.find((p) => p.id === pid)?.name ?? 'Player', [view]);
  const lastChatId = view?.chat.length ? view.chat[view.chat.length - 1].id : 0;
  if (sheet === 'chat' && seenChat.current !== lastChatId) seenChat.current = lastChatId;
  const unread = view ? view.chat.filter((m) => !m.system && m.id > seenChat.current && m.playerId !== view.me?.id).length : 0;
  useEffect(() => {
    if (view && seenChat.current === 0) {
      seenChat.current = lastChatId;
      force((n) => n + 1);
    }
  }, [view, lastChatId]);

  useEffect(() => {
    if (!view) return;
    music.setScreen(view.phase === 'LOBBY' ? 'lobby' : 'gameplay');
    if (prevPhase.current && prevPhase.current !== view.phase) {
      if (view.phase === 'COUNTDOWN') audio.play('start');
      if (view.phase === 'FINISHED') audio.play('safe');
    }
    prevPhase.current = view.phase;
  }, [view]);

  if (!view) {
    return status === 'refused' ? (
      <StatusScreen
        title="Can’t enter the room"
        actions={
          <Button to="/" variant="primary" block>
            Back to the hub
          </Button>
        }
      >
        <Text tone="dust">You’re not on this tournament’s list, or your session ended. Join again from an invite.</Text>
      </StatusScreen>
    ) : (
      <Loading label={status === 'reconnecting' ? 'Reconnecting' : 'Entering the room'} />
    );
  }

  const me = view.me;
  const phase = view.phase;
  const onFloor = phase === 'ROUND' || phase === 'REVEAL';
  const stage = view.stage;

  const leaveOrCancel = () => setSheet('confirm-leave');
  const confirmLeave = () => {
    if (me?.isSponsor) send({ t: 'cancel' });
    else {
      send({ t: 'leave' });
      navigate('/');
    }
    setSheet(null);
  };

  const inStage = stage && (phase === 'STAGE_INTRO' || onFloor || phase === 'STAGE_RESULT');
  const barTitle = inStage ? GAME_META[stage.gameId].name : phase === 'LOBBY' ? 'Lobby' : phase === 'COUNTDOWN' ? 'Countdown' : phase === 'FINISHED' ? 'Final results' : 'Closed';
  const barSub = inStage ? `Stage ${stage.index} of ${view.totalStages}, ${view.title}` : view.title;

  const bar = (
    <header className={s.bar}>
      <IconButton icon="back" label="Back to the hub" onClick={() => navigate('/')} />
      <div className={s.barMid}>
        <span className={s.barTitle}>{barTitle}</span>
        <span className={s.barSub}>{barSub}</span>
      </div>
      <div className={s.barActions}>
        <IconButton icon="users" label="Players" onClick={() => setSheet('players')} />
        {!(wide && phase === 'LOBBY') && <IconButton icon="chat" label="Chat" badge={unread} onClick={() => setSheet('chat')} />}
        {(onFloor || phase === 'STAGE_INTRO' || phase === 'STAGE_RESULT') && <IconButton icon="info" label="Rules and options" onClick={() => setSheet('menu')} />}
      </div>
    </header>
  );

  let body;
  switch (phase) {
    case 'LOBBY':
      body = <Lobby view={view} send={send} openChat={() => setSheet('chat')} onLeave={leaveOrCancel} />;
      break;
    case 'COUNTDOWN':
      body = <Countdown view={view} send={send} serverNow={serverNow} />;
      break;
    case 'STAGE_INTRO':
      body = <StageIntro view={view} serverNow={serverNow} />;
      break;
    case 'ROUND':
    case 'REVEAL':
      body = <StageFloor view={view} send={send} serverNow={serverNow} name={name} />;
      break;
    case 'STAGE_RESULT':
      body = <StageResult view={view} serverNow={serverNow} name={name} />;
      break;
    case 'FINISHED':
      body = <Finished view={view} name={name} />;
      break;
    default:
      body = (
        <StatusScreen
          chip={<Chip tone="stop">{phase === 'CANCELED' ? 'Canceled' : 'Expired'}</Chip>}
          title={phase === 'CANCELED' ? 'Tournament canceled' : 'Lobby expired'}
          actions={
            <Button to="/" variant="primary" block>
              Back to the hub
            </Button>
          }
        >
          <Text tone="dust">{view.endedReason ?? 'This tournament closed before it started.'} No results or prizes were recorded.</Text>
        </StatusScreen>
      );
  }

  return (
    <div className={onFloor ? s.floor : s.room} data-phase={phase} data-stage={stage?.index ?? 0} data-round={stage?.round ?? 0} data-game={stage?.gameId ?? ''} data-status={me?.status ?? ''}>
      {bar}
      {status !== 'open' && <div className={s.conn}>{status === 'reconnecting' ? 'Connection lost. Reconnecting — the server keeps time either way.' : 'Connecting…'}</div>}
      {body}

      <Sheet open={sheet === 'chat'} title="Chat" onClose={() => setSheet(null)} tall>
        <ChatPanel view={view} onSend={(text) => send({ t: 'chat', text })} />
      </Sheet>
      <Sheet open={sheet === 'players'} title={`Players (${view.players.filter((p) => !p.left).length})`} onClose={() => setSheet(null)}>
        <PlayersList view={view} />
      </Sheet>
      <Sheet open={sheet === 'menu'} title="Rules" onClose={() => setSheet(null)}>
        {stage && (
          <Stack gap={4}>
            <h3 className={s.sheetGame}>{GAME_META[stage.gameId].name}</h3>
            <ol className={s.sheetRules}>
              {GAME_META[stage.gameId].instructions.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
            <Text tone="dust" size="sm">
              <b>Win:</b> {GAME_META[stage.gameId].winRule} <b>Ties:</b> {GAME_META[stage.gameId].tieRule}
            </Text>
            <Text tone="ash" size="sm">
              A tournament stage is one game. Its rounds happen inside the stage; everyone eligible starts each new stage fresh.
            </Text>
            {me && me.competes && !me.left && (
              <Button variant="danger" block onClick={() => setSheet('confirm-leave')}>
                Forfeit the tournament
              </Button>
            )}
          </Stack>
        )}
      </Sheet>
      <Sheet open={sheet === 'confirm-leave'} title={me?.isSponsor ? 'Cancel tournament?' : phase === 'LOBBY' ? 'Leave lobby?' : 'Forfeit?'} onClose={() => setSheet(null)}>
        <Stack gap={3}>
          <Text tone="dust">
            {me?.isSponsor
              ? 'Everyone in the lobby is notified. No results or prizes are recorded. This can’t be undone.'
              : phase === 'LOBBY'
                ? 'You can join again with a valid invite.'
                : 'You’ll be out of every remaining stage and can’t rejoin this tournament.'}
          </Text>
          <Button variant="danger" block onClick={confirmLeave}>
            {me?.isSponsor ? 'Cancel tournament' : phase === 'LOBBY' ? 'Leave lobby' : 'Forfeit'}
          </Button>
          <Button variant="ghost" block onClick={() => setSheet(null)}>
            Keep going
          </Button>
        </Stack>
      </Sheet>
    </div>
  );
}

function PlayersList({ view }: { view: RoomView }) {
  const label: Record<string, string> = { alive: 'Standing', out: 'Out', waiting: 'Joins later', ready: 'Ready', host: 'Hosting', left: 'Left' };
  const tone: Record<string, 'go' | 'stop' | 'muted' | 'info' | 'live'> = { alive: 'go', out: 'stop', waiting: 'muted', ready: 'info', host: 'live', left: 'muted' };
  const rows = [...view.players].sort((a, b) => b.stageWins - a.stageWins || Number(a.left) - Number(b.left));
  return (
    <div className={s.players}>
      {rows.map((p) => (
        <div className={s.player} key={p.id} data-left={p.left}>
          <Who name={p.name} tag={p.tag}>
            <Text as="span" tone="ash" size="xs">
              {p.stageWins} stage win{p.stageWins === 1 ? '' : 's'}
              {p.submitted && view.phase === 'ROUND' ? ', locked in' : ''}
            </Text>
          </Who>
          <div className={s.playerEnd}>
            <Chip tone={tone[p.status]}>{label[p.status]}</Chip>
            <span className={s.conDot} data-on={p.connected} title={p.connected ? 'Connected' : 'Not connected'} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Finished({ view, name }: { view: RoomView; name: (id: string) => string }) {
  const f = view.final;
  const rows = useMemo(
    () =>
      (f?.standings ?? []).map((r) => ({ ...r, name: name(r.playerId) })),
    [f, name],
  );
  if (!f) return <Loading />;
  return (
    <div className={s.final}>
      <FinalBoard
        rows={rows}
        allocations={f.allocations.map((a) => ({ ...a, name: a.playerId ? name(a.playerId) : null }))}
        currency={view.config.currency}
        myId={view.me?.id ?? null}
      />
      <Stack gap={2}>
        <Button variant="primary" to={`/t/${view.id}/results`}>
          Full results and stage history
        </Button>
        {view.me?.isSponsor && (
          <Button icon="log" to={`/t/${view.id}/audit`}>
            Audit log
          </Button>
        )}
        <Button variant="ghost" to="/">
          Back to the hub
        </Button>
      </Stack>
    </div>
  );
}
