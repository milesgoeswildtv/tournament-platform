import type { ReactNode } from 'react';
import { Button } from '../ui/controls';
import { Icon } from '../ui/Icon';
import type { MeView } from './types';
import s from './games.module.css';

/** Bottom of every game: the lock-in button, then the confirmation once the server accepts. */
export function ActionBar({
  me,
  canAct,
  submitted,
  pending,
  lockedText,
  label,
  onLock,
  ready,
  extra,
}: {
  me: MeView | null;
  canAct: boolean;
  submitted: boolean;
  pending: boolean;
  lockedText: ReactNode;
  label: ReactNode;
  onLock: () => void;
  ready: boolean;
  extra?: ReactNode;
}) {
  if (submitted) {
    return (
      <div className={s.action}>
        <div className={s.locked} role="status">
          <Icon name="lock" size={20} />
          <span>{lockedText}</span>
        </div>
      </div>
    );
  }
  if (!canAct) return <div className={s.action}><Spectating me={me} /></div>;
  return (
    <div className={s.action}>
      {extra}
      <Button variant="primary" size="lg" block onClick={onLock} disabled={!ready} busy={pending}>
        {label}
      </Button>
    </div>
  );
}

export function Spectating({ me }: { me: MeView | null }) {
  let text = 'Watching this stage';
  if (me?.status === 'out') text = `Out this stage${me.outReason ? `: ${me.outReason}` : ''}. Back in next stage.`;
  else if (me?.status === 'waiting') text = `You’re in from stage ${me.eligibleFrom}. Watching until then.`;
  else if (me?.status === 'host') text = 'You’re hosting. Watching the floor.';
  else if (me?.status === 'left') text = 'You forfeited this tournament.';
  return (
    <div className={s.locked} style={{ borderColor: 'var(--steel)', color: 'var(--dust)' }} role="status">
      <Icon name="eye" size={20} />
      <span>{text}</span>
    </div>
  );
}

export const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
