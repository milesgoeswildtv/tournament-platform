import { useEffect, useRef, useState } from 'react';
import { GAME_META, type RoomView } from '@shared/client';
import { GAME_UI } from '../../games';
import { audio, haptic } from '../../lib/audio';
import { gameName, ordinal, plural } from '../../lib/format';
import { Button, vars } from '../../ui/controls';
import { Chip } from '../../ui/layout';
import { GAME_ACCENT, GameMark } from '../../ui/GameMark';
import { FieldDots, Hazard, Stamp, TimerBar, useSecondsLeft } from '../../ui/live';
import s from './room.module.css';

type Send = (m: any) => boolean;

// ------------------------------------------------------------------ countdown

export function Countdown({ view, send, serverNow }: { view: RoomView; send: Send; serverNow: () => number }) {
  const left = useSecondsLeft(view.phaseEndsAt, serverNow);
  const prev = useRef(left);
  useEffect(() => {
    if (left !== prev.current && left <= 10 && left > 0) audio.play('tick');
    prev.current = left;
  }, [left]);
  const first = view.lineup[0];
  const competitors = view.players.filter((p) => p.competes && !p.left);
  return (
    <div className={s.count}>
      <Hazard moving />
      <div className={s.countBody}>
        <p className={s.countLabel}>Tournament starts in</p>
        <div key={left} className={`${s.countNum} ${s.slam}`} data-hot={left <= 10} role="timer" aria-live="polite" aria-label={`${left} seconds`}>
          {left}
        </div>
        <div className={s.countNext}>
          <span className={s.countLabel}>Stage 1 of {view.totalStages}</span>
          <GameMark id={first} size={44} />
          <b>{first ? GAME_META[first].name : 'Random game'}</b>
        </div>
      </div>
      <div className={s.countFoot}>
        <p style={{ color: 'var(--dust)' }}>{plural(competitors.length, 'competitor')} locked in. Settings and award criteria are frozen.</p>
        {view.me?.isSponsor ? (
          <Button variant="danger" onClick={() => send({ t: 'abort' })}>
            Stop countdown
          </Button>
        ) : null}
      </div>
      <Hazard moving />
    </div>
  );
}

// ------------------------------------------------------------------ stage intro

export function StageIntro({ view, serverNow }: { view: RoomView; serverNow: () => number }) {
  const st = view.stage!;
  const meta = GAME_META[st.gameId];
  const me = view.me;
  const inStage = me?.status === 'alive';
  useEffect(() => {
    audio.play('start');
  }, [st.index]);
  return (
    <div className={s.intro} style={vars({ '--accent': GAME_ACCENT[st.gameId] })}>
      <div className={s.introStage}>
        <span className={s.introNo}>{st.index}</span>
        <span className={s.introOf}>
          Stage
          <br />
          of {view.totalStages}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <GameMark id={st.gameId} size={64} />
        </span>
      </div>
      <div>
        <h1 className={s.introName}>{meta.name}</h1>
        <p className={s.introTag}>{meta.tagline}</p>
      </div>
      <ol className={s.introRules}>
        {meta.instructions.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
      <div className={s.introFacts}>
        <Chip tone="info">Round timer {Math.round(st.durationMs / 1000)}s</Chip>
        <Chip>Up to {plural(meta.maxRounds, meta.roundNoun.toLowerCase())}</Chip>
        <Chip>{plural(st.participantCount, 'player')}</Chip>
      </div>
      <div className={s.introFoot}>
        <p style={{ color: 'var(--dust)', fontSize: 14 }}>
          <b style={{ color: 'var(--chalk)' }}>Win:</b> {meta.winRule} <b style={{ color: 'var(--chalk)' }}>Ties:</b> {meta.tieRule}
        </p>
        {!inStage && <Chip tone="muted">{me?.status === 'waiting' ? `You’re in from stage ${me.eligibleFrom}` : me?.status === 'host' ? 'You’re hosting this one' : 'Watching'}</Chip>}
        {view.phaseEndsAt && <TimerBar startsAt={view.phaseStartedAt} endsAt={view.phaseEndsAt} serverNow={serverNow} ticks={false} calm label="Stage starts in" />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ round / reveal

export function StageFloor({ view, send, serverNow, name }: { view: RoomView; send: Send; serverNow: () => number; name: (id: string) => string }) {
  const st = view.stage!;
  const meta = GAME_META[st.gameId];
  const ui = GAME_UI[st.gameId];
  const me = view.me;
  const round = view.phase === 'ROUND';
  const canAct = round && me?.status === 'alive' && !me.left;
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const lastView = useRef(view);

  // Any fresh view from the server answers an outstanding action.
  useEffect(() => {
    if (lastView.current !== view) setPendingSince(null);
    lastView.current = view;
  }, [view]);

  const act = (action: unknown) => {
    if (send({ t: 'act', stage: st.index, round: st.round, action })) {
      setPendingSince(Date.now());
      audio.play('lock');
      haptic('light');
    }
  };

  // verdict for me after a round
  const lr = st.lastRound;
  const myId = me?.id ?? null;
  const out = !!(lr && myId && lr.eliminated.some((e) => e.playerId === myId));
  const safe = !!(lr && myId && !out && lr.survivors.includes(myId));
  const outWhy = lr?.eliminated.find((e) => e.playerId === myId)?.reason;

  useEffect(() => {
    if (view.phase !== 'REVEAL') return;
    audio.play('reveal');
    const t = window.setTimeout(() => {
      if (out) {
        audio.play('out');
        haptic('error');
      } else if (safe) {
        audio.play('safe');
        haptic('success');
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [view.phase, st.round, out, safe]);

  useEffect(() => {
    document.body.dataset.light = view.phase === 'REVEAL' ? (out ? 'out' : safe ? 'standing' : '') : '';
    return () => {
      document.body.dataset.light = '';
    };
  }, [view.phase, out, safe]);

  const dots = view.players
    .filter((p) => p.status === 'alive' || p.status === 'out')
    .map((p) => ({ id: p.id, name: p.name, me: p.id === myId, state: (p.status === 'out' ? 'out' : p.submitted ? 'done' : 'alive') as 'alive' | 'done' | 'out' }));

  return (
    <>
      <div className={s.stageBar} style={vars({ '--accent': GAME_ACCENT[st.gameId] })}>
        <div className={s.stageLine}>
          <span>
            <b>{meta.roundNoun} {st.round}</b> of up to {st.maxRounds}
          </span>
          <span className={s.standing}>
            <b>{st.aliveCount}</b> of {st.participantCount} standing
          </span>
        </div>
        {round ? (
          <TimerBar startsAt={st.roundStartedAt} endsAt={Math.min(st.roundEndsAt, view.phaseEndsAt ?? st.roundEndsAt)} serverNow={serverNow} ticks={canAct && !me?.submitted} />
        ) : (
          <div className={s.stageLine}>
            <span className={s.revealLabel}>{lr?.voided ? `Void ${meta.roundNoun.toLowerCase()}` : `${meta.roundNoun} ${st.round} result`}</span>
            <span>{lr ? `${plural(lr.eliminated.length, 'player')} out` : ''}</span>
          </div>
        )}
        {round && <FieldDots dots={dots} />}
      </div>
      <div className={s.board}>
        {round ? (
          <ui.Play stage={st} pub={st.public} mine={me?.private ?? null} me={me} canAct={!!canAct} pending={pendingSince !== null} act={act} serverNow={serverNow} name={name} />
        ) : (
          <>
            <div className={s.verdict} aria-live="assertive">
              {lr?.voided ? (
                <Stamp tone="info">Void</Stamp>
              ) : out ? (
                <Stamp tone="stop">Out</Stamp>
              ) : safe ? (
                <Stamp tone="go">Standing</Stamp>
              ) : null}
              {out && outWhy && <p className={s.verdictWhy}>{outWhy}</p>}
              {lr?.voided && <p className={s.verdictWhy}>Nobody passed, so nobody goes out. Same players, next {meta.roundNoun.toLowerCase()}.</p>}
            </div>
            {st.reveal ? <ui.Reveal stage={st} reveal={st.reveal} me={me} myId={myId} name={name} /> : null}
          </>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ stage result

export function StageResult({ view, serverNow, name }: { view: RoomView; serverNow: () => number; name: (id: string) => string }) {
  const rec = view.lastStage;
  const myId = view.me?.id;
  if (!rec) return null;
  const place = myId ? rec.ranking.indexOf(myId) : -1;
  const iWon = !!myId && rec.winners.includes(myId);
  const next = view.currentStage < view.totalStages ? view.lineup[view.currentStage] : undefined;
  const table = view.players
    .filter((p) => p.competes)
    .sort((a, b) => b.stageWins - a.stageWins)
    .slice(0, 6);
  return (
    <div className={s.result}>
      <div className={s.resultWin}>
        <Chip tone="live">
          Stage {rec.index} of {view.totalStages}: {GAME_META[rec.gameId].name}
        </Chip>
        {rec.winners.length ? (
          <>
            <p style={{ color: 'var(--dust)' }}>{rec.winners.length > 1 ? 'Shared win' : 'Stage winner'}</p>
            <h1 className={s.resultName}>{rec.winners.map(name).join(' + ')}</h1>
          </>
        ) : (
          <h1 className={s.resultName} style={{ color: 'var(--dust)' }}>
            No winner
          </h1>
        )}
        <p className={s.resultNone}>{rec.summary}</p>
        {iWon ? <Stamp tone="live">Stage win</Stamp> : place >= 0 ? <p>You placed {ordinal(place + 1)} of {rec.participants.length}.</p> : null}
      </div>
      <div className={s.tally}>
        <p style={{ fontFamily: 'var(--f-cond)', fontWeight: 600, color: 'var(--ash)', marginBottom: 4 }}>Stage wins so far</p>
        {table.map((p, i) => (
          <div className={s.tallyRow} key={p.id} data-me={p.id === myId}>
            <span className={s.tallyNo}>{i + 1}</span>
            <span>{p.name}</span>
            <span className={s.tallyVal}>{p.stageWins}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', display: 'grid', gap: 12 }}>
        {next !== undefined ? (
          <p style={{ color: 'var(--dust)' }}>
            Next: stage {view.currentStage + 1}, <b style={{ color: 'var(--chalk)' }}>{gameName(next)}</b>
          </p>
        ) : (
          <p style={{ color: 'var(--dust)' }}>That was the last stage. Final standings next.</p>
        )}
        {view.phaseEndsAt && <TimerBar startsAt={view.phaseStartedAt} endsAt={view.phaseEndsAt} serverNow={serverNow} ticks={false} calm label="Next stage in" />}
      </div>
    </div>
  );
}
