import type { ComponentType } from 'react';
import type { GameId, RoomView } from '@shared/client';

export type StageView = NonNullable<RoomView['stage']>;
export type MeView = NonNullable<RoomView['me']>;

/**
 * What the gameplay room hands a game. The room owns timers, eliminations
 * and layout; a game only draws its own board and sends actions.
 */
export interface PlayProps {
  stage: StageView;
  pub: any;
  mine: any;
  me: MeView | null;
  /** True when this player is alive in the stage and the round is open. */
  canAct: boolean;
  /** An action was sent and the server hasn't answered yet. */
  pending: boolean;
  act: (action: unknown) => void;
  serverNow: () => number;
  name: (id: string) => string;
}

export interface RevealProps {
  stage: StageView;
  reveal: any;
  me: MeView | null;
  myId: string | null;
  name: (id: string) => string;
}

export interface GameUI {
  Play: ComponentType<PlayProps>;
  Reveal: ComponentType<RevealProps>;
}

export type GameUIRegistry = Record<GameId, GameUI>;
