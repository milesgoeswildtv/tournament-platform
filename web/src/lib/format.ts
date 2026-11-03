import { formatMoney, GAME_META, type GameId, type PayoutStructure } from '@shared/client';
import type { Tone } from '../ui/layout';
import type { TournamentSummary } from './api';

export const money = (cents: number, currency = 'USD') => formatMoney(cents, currency);

export function ago(ts: number, now = Date.now()): string {
  const d = Math.round((now - ts) / 1000);
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 14) return `${Math.round(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function until(ts: number, now = Date.now()): string {
  const d = Math.max(0, Math.round((ts - now) / 1000));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m`;
  return `${Math.floor(d / 86400)}d ${Math.floor((d % 86400) / 3600)}h`;
}

export const clockTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dateTime = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const STATUS: Record<TournamentSummary['status'], { label: string; tone: Tone }> = {
  LOBBY: { label: 'Lobby open', tone: 'info' },
  COUNTDOWN: { label: 'Starting', tone: 'live' },
  RUNNING: { label: 'Live', tone: 'live' },
  FINISHED: { label: 'Finished', tone: 'muted' },
  CANCELED: { label: 'Canceled', tone: 'stop' },
  ABANDONED: { label: 'Expired', tone: 'muted' },
};

export const STRUCTURE: Record<PayoutStructure, { label: string; describe: string }> = {
  PER_STAGE: { label: 'Per stage winner', describe: 'Every stage pays its winner.' },
  MOST_WINS: { label: 'Most stage wins', describe: 'One final award for the player with the most stage wins.' },
  HYBRID: { label: 'Hybrid', describe: 'Every stage pays its winner, plus a final award for most stage wins.' },
};

export const gameName = (id: GameId | null) => (id ? GAME_META[id].name : 'Hidden until it starts');

export function prizeLine(t: Pick<TournamentSummary, 'structure' | 'stageAwardCents' | 'finalAwardCents' | 'currency'>): string {
  const stage = money(t.stageAwardCents, t.currency);
  const fin = money(t.finalAwardCents, t.currency);
  if (t.structure === 'PER_STAGE') return `${stage} per stage`;
  if (t.structure === 'MOST_WINS') return `${fin} to the most stage wins`;
  return `${stage} per stage + ${fin} final`;
}

export const ordinal = (n: number) => {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suf}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
