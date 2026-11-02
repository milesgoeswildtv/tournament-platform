import type { RoomView } from './room';

/** Messages a browser may send over the room websocket. */
export type ClientMessage =
  | { t: 'act'; stage: number; round: number; action: unknown }
  | { t: 'chat'; text: string }
  | { t: 'start' }
  | { t: 'abort' }
  | { t: 'cancel' }
  | { t: 'leave' }
  | { t: 'ping'; at: number };

/** Messages the room sends. `state` is always personalised for the receiver. */
export type ServerMessage =
  | { t: 'state'; view: RoomView }
  | { t: 'reply'; data: unknown }
  | { t: 'error'; code: string; ref?: string }
  | { t: 'pong'; at: number; serverNow: number };

export const ERROR_TEXT: Record<string, string> = {
  round_closed: 'This round is closed. Submission not accepted.',
  stale_round: 'That round already ended.',
  already_submitted: 'You already locked in this round.',
  already_rerolled: 'You already used your reroll.',
  eliminated: 'You are out for this stage.',
  not_in_stage: 'You are not playing this stage.',
  not_in_tournament: 'You are not in this tournament.',
  not_sponsor: 'Only the sponsor can do that.',
  not_in_lobby: 'The tournament already left the lobby.',
  not_enough_players: 'At least 2 competitors are needed to start.',
  host_cannot_leave: 'The host cannot leave. Cancel the tournament instead.',
  already_started: 'The tournament has started and can no longer be canceled.',
  too_late: 'Too late — the pressure already broke.',
  rate_limited: 'Slow down.',
  tournament_full: 'This tournament is full.',
  entry_closed: 'Entry is closed — this tournament has started.',
  late_entry_closed: 'The late-entry cutoff has passed.',
  tournament_closed: 'This tournament is over.',
  forfeited: 'You forfeited this tournament.',
  invalid_color: 'Pick one of the five colors.',
  invalid_number: 'Enter a whole number from 0 to 100.',
  invalid_suit: 'Pick a suit.',
  invalid_guess: 'Type a guess first.',
  invalid_answer: 'Enter an answer first.',
  invalid_action: 'That action is not available.',
  bad_message: 'Malformed message.',
  empty_message: 'Message is empty.',
};
