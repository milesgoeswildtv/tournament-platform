import { useSyncExternalStore } from 'react';

/**
 * API base. Empty means same origin (local dev server). Production builds set
 * VITE_API_URL to the Worker URL.
 */
export const API_BASE: string = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? '').replace(/\/$/, '');

export interface User {
  id: string;
  tag: string;
  handle: string | null;
  name: string;
  isAdmin: boolean;
  telegram: boolean;
  discord: boolean;
  createdAt: number;
}

// ------------------------------------------------------------------ session store

const KEY = 'tp.session.v1';

interface Session {
  token: string;
  user: User;
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let session: Session | null = load();
const subs = new Set<() => void>();

export function setSession(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked (private mode): session lives in memory */
  }
  subs.forEach((f) => f());
}

export function updateUser(user: User) {
  if (session) setSession({ ...session, user });
}

export const getToken = () => session?.token ?? null;

export function useSession(): Session | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => session,
  );
}

// ------------------------------------------------------------------ requests

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field?: string; errors?: { field: string; message: string }[] },
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && session && path !== '/api/auth/login') setSession(null);
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status}).`, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});

export function wsUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/, 'ws') + path;
}

// ------------------------------------------------------------------ shared shapes

export interface TournamentSummary {
  id: string;
  title: string;
  status: 'LOBBY' | 'COUNTDOWN' | 'RUNNING' | 'FINISHED' | 'CANCELED' | 'ABANDONED';
  visibility: 'PUBLIC' | 'PRIVATE';
  stages: number;
  currentStage: number;
  players: number;
  maxPlayers: number;
  commitmentCents: number;
  currency: string;
  structure: 'PER_STAGE' | 'MOST_WINS' | 'HYBRID';
  stageAwardCents: number;
  finalAwardCents: number;
  lateEntry: boolean;
  selection: 'MANUAL' | 'RANDOM';
  timer: { minSeconds: number; maxSeconds: number };
  sponsor: { id: string; name: string | null; tag: string | null };
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  myRole: 'HOST' | 'PLAYER' | null;
  myRank: number | null;
  left: boolean;
}

export interface Invite {
  code: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revoked: boolean;
  link: string;
  telegramLink: string | null;
}

export interface Stats {
  tournamentsJoined: number;
  tournamentsPlayed: number;
  titles: number;
  stageWins: number;
  stagesPlayed: number;
  roundsSurvived: number;
  bestFinish: number | null;
  stageWinRate: number;
  sponsored: number;
  sponsoredCommitmentCents: number;
  prizeAllocations: { currency: string; cents: number }[];
}
