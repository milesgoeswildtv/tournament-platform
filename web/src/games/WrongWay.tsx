import { useState, type ReactNode } from 'react';
import { audio } from '../lib/audio';
import { Icon, type IconName } from '../ui/Icon';
import { ActionBar } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const ROUTES = ['left', 'up', 'right', 'down', 'through'] as const;
const LABEL: Record<string, string> = { left: 'Left', up: 'Ahead', right: 'Right', down: 'Back', through: 'Hatch' };
const ICON: Record<string, IconName> = { left: 'back', up: 'up', right: 'next', down: 'down', through: 'hatch' };

/** A top-down junction: the player in the middle, a door on each side, a hatch underfoot in the endgame. */
function Junction({ routes, render }: { routes: number; render: (r: (typeof ROUTES)[number]) => ReactNode }) {
  return (
    <div className={s.junction} data-routes={routes}>
      {ROUTES.slice(0, routes).map((r) => (
        <div key={r} className={s.junctionSlot} data-route={r}>
          {render(r)}
        </div>
      ))}
      {routes < 5 && <div className={s.junctionHub} aria-hidden><span>You</span></div>}
    </div>
  );
}

export function WrongWayPlay({ pub, mine, me, canAct, pending, act }: PlayProps) {
  const routes: number = pub?.routes ?? 4;
  const locked: string | null = mine?.route ?? null;
  const [pick, setPick] = useState<string | null>(null);
  const shown = locked ?? pick;
  return (
    <div className={s.play}>
      <p className={s.wayHint}>
        <span className={s.wayLine}>
          <b>{pub?.safeCount ?? 0}</b> of {routes} routes {pub?.safeCount === 1 ? 'is' : 'are'} safe
        </span>
        <span className={s.wayField}>
          {pub?.alive ?? 0} of {pub?.start ?? 0} still in
        </span>
      </p>
      <div className={s.wayFrame} data-chosen={!!shown} role="radiogroup" aria-label="Routes">
        <Junction
          routes={routes}
          render={(r) => (
            <button
              type="button"
              className={s.door}
              aria-pressed={shown === r}
              aria-label={LABEL[r]}
              disabled={!canAct || !!locked}
              onClick={() => {
                audio.play('tap');
                setPick(r);
              }}
            >
              <Icon name={ICON[r]} size={30} />
              <span>{LABEL[r]}</span>
            </button>
          )}
        />
      </div>
      <ActionBar
        me={me}
        canAct={canAct}
        submitted={!!locked}
        pending={pending}
        ready={!!pick}
        label={pick ? `Go ${LABEL[pick].toLowerCase()}` : 'Pick a route'}
        lockedText={`Going ${LABEL[locked ?? 'up']?.toLowerCase()}. Routes open at the bell.`}
        onLock={() => pick && act({ route: pick })}
      />
    </div>
  );
}

export function WrongWayReveal({ reveal, myId }: RevealProps) {
  const r = reveal as { routes: number; safe: string[]; tally: Record<string, number>; picks: Record<string, string | null> };
  const safe = new Set(r.safe);
  const mine = myId ? r.picks?.[myId] : undefined;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>{r.safe.length === 1 ? 'The way out' : 'Open routes'}</p>
        <p className={`${s.big} ${s.inWay}`}>{r.safe.map((x) => LABEL[x]).join(', ')}</p>
        {mine !== undefined && <p className={s.small}>{mine === null ? 'You didn’t pick a route.' : `You went ${LABEL[mine].toLowerCase()}.`}</p>}
      </div>
      <div className={`${s.wayFrame} ${s.wayReveal}`}>
        <Junction
          routes={r.routes}
          render={(x) => (
            <div className={s.door} data-safe={safe.has(x) || undefined} data-dead={!safe.has(x) || undefined} data-mine={mine === x || undefined}>
              <Icon name={ICON[x]} size={22} />
              <span>{safe.has(x) ? 'Open' : 'Dead end'}</span>
              <b>{r.tally?.[x] ?? 0}</b>
            </div>
          )}
        />
      </div>
    </div>
  );
}
