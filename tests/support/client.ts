import WebSocket from 'ws';
import type { RoomView, ServerMessage, TournamentConfig, GameId } from '../../shared/src/index';
import { defaultConfig } from '../../shared/src/index';

export interface ApiResult<T = any> {
  status: number;
  data: T;
}

/** A test player: an account plus (optionally) a live room socket. */
export class Client {
  token = '';
  user: any = null;
  ws: WebSocket | null = null;
  view: RoomView | null = null;
  errors: { code: string; ref?: string; at: number }[] = [];
  replies: unknown[] = [];
  views = 0;
  /** Each simulated device gets its own address (the dev server honours cf-connecting-ip; Cloudflare overwrites it in production). */
  readonly ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  private listeners = new Set<() => void>();

  constructor(
    readonly base: string,
    readonly handle: string,
  ) {}

  static async register(base: string, handle: string, displayName = handle.toUpperCase()): Promise<Client> {
    const c = new Client(base, handle);
    const r = await c.api('POST', '/api/auth/register', { handle, password: 'correct-horse-9', displayName });
    if (r.status !== 201) throw new Error(`register ${handle}: ${r.status} ${JSON.stringify(r.data)}`);
    c.token = r.data.token;
    c.user = r.data.user;
    return c;
  }

  async api<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': this.ip, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  connect(tid: string): Promise<RoomView> {
    const url = `${this.base.replace(/^http/, 'ws')}/api/tournaments/${tid}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ['bearer', this.token]);
      this.ws = ws;
      let first = true;
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMessage;
        if (m.t === 'state') {
          this.view = m.view;
          this.views++;
          if (first) {
            first = false;
            resolve(m.view);
          }
        } else if (m.t === 'error') {
          this.errors.push({ code: m.code, ref: m.ref, at: Date.now() });
        } else if (m.t === 'reply') {
          this.replies.push(m.data);
        }
        for (const l of [...this.listeners]) l();
      });
      ws.on('error', (e) => first && reject(e));
      ws.on('unexpected-response', (_req, res) => first && reject(new Error(`ws refused: ${res.statusCode}`)));
      ws.on('open', () => this.send({ t: 'ping', at: Date.now() }));
    });
  }

  /** Calls fn after every server message. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(m: unknown) {
    this.ws?.send(JSON.stringify(m));
  }

  disconnect(): Promise<void> {
    return new Promise((r) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return r();
      this.ws.once('close', () => r());
      this.ws.close(1000);
      this.ws = null;
    });
  }

  /** Resolves when `pred(view)` is true, checking on every message. */
  waitFor(pred: (v: RoomView) => boolean, timeoutMs = 15_000, label = 'condition'): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.view && pred(this.view)) {
          cleanup();
          resolve(this.view);
        }
      };
      const t = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.handle}: timed out waiting for ${label} (phase=${this.view?.phase} stage=${this.view?.currentStage})`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(t);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }

  /** Waits for the next server error with the given code. */
  waitForError(code: string, timeoutMs = 3000): Promise<void> {
    const since = Date.now() - 1;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.errors.some((e) => e.code === code && e.at >= since)) {
          cleanup();
          resolve();
        }
      };
      const t = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.handle}: no ${code} error (got ${this.errors.map((e) => e.code).join(',')})`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(t);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }
}

export function tournamentConfig(over: Partial<TournamentConfig> & { manual?: GameId[] } = {}): TournamentConfig {
  const c = defaultConfig();
  c.title = 'Integration Night';
  const { manual, ...rest } = over;
  const out = { ...c, ...rest } as TournamentConfig;
  if (manual) {
    out.games = { selection: 'MANUAL', manual, pool: [] };
    out.stages = manual.length;
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
