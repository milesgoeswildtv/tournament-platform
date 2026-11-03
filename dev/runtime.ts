/**
 * Local stand-ins for the Cloudflare runtime pieces this project uses, so the
 * real Worker and Durable Object code can run under Node for development and
 * integration tests:
 *
 *   - D1Database      → node:sqlite (same SQL dialect: SQLite)
 *   - Durable Objects → one instance per name, events delivered one at a time,
 *                       storage with structured-clone semantics, alarms via timers
 *   - WebSocketPair   → linked in-memory sockets bridged to real `ws` connections
 *   - Response(101)   → allowed, carrying `webSocket` like the Workers runtime
 *
 * Production never loads this file; it exists because wrangler/workerd cannot
 * be installed in every development environment.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ------------------------------------------------------------------ D1

type Param = string | number | null | bigint | Uint8Array;

function norm(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
}

const plain = <T>(r: unknown): T => (r ? ({ ...(r as object) } as T) : (r as T));

class DevStatement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new DevStatement(this.db, this.sql, values.map(norm));
  }
  private prep() {
    return this.db.prepare(this.sql);
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    return this.firstSync<T>(column);
  }
  firstSync<T>(column?: string): T | null {
    const row = this.prep().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : plain(row)) as T;
  }
  async all<T = Record<string, unknown>>() {
    return this.allSync<T>();
  }
  allSync<T>() {
    const rows = this.prep().all(...this.params).map((r) => plain<T>(r));
    return { success: true, results: rows, meta: { changes: 0, last_row_id: 0 } };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    if (/\breturning\b/i.test(this.sql)) {
      const rows = this.prep().all(...this.params);
      return { success: true, results: rows.map((r) => plain(r)), meta: { changes: rows.length, last_row_id: 0 } };
    }
    const r = this.prep().run(...this.params);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class DevD1 {
  readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql: string) {
    return new DevStatement(this.db, sql);
  }
  async batch(stmts: DevStatement[]) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.runSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1 };
  }
  /** Applies migrations/*.sql in order, once each (like `wrangler d1 migrations apply`). */
  migrate(dir: string) {
    this.db.exec('CREATE TABLE IF NOT EXISTS _dev_migrations (name TEXT PRIMARY KEY, applied_at INTEGER)');
    const done = new Set(this.db.prepare('SELECT name FROM _dev_migrations').all().map((r) => String((r as { name: string }).name)));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      this.db.exec(readFileSync(join(dir, f), 'utf8'));
      this.db.prepare('INSERT INTO _dev_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    }
  }
}

// ------------------------------------------------------------------ WebSockets

type Handler = (data: string) => void;

export class DevSocket {
  readyState = 1;
  peer!: DevSocket;
  /** For the client end: where messages from the server go (the real browser socket). */
  onMessage: Handler | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  state: DevDOState | null = null;
  tags: string[] = [];
  private attachment: unknown = null;
  private pending: string[] = [];

  accept() {}
  send(data: string) {
    if (this.readyState !== 1) throw new Error('WebSocket is not open');
    this.peer.receive(String(data));
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.peer.remoteClose(code, reason);
  }
  serializeAttachment(v: unknown) {
    this.attachment = structuredClone(v);
  }
  deserializeAttachment() {
    return structuredClone(this.attachment);
  }
  /** Called when the peer sent us something. */
  receive(data: string) {
    if (this.state) {
      // Server end, owned by a Durable Object: deliver through its event queue.
      this.state.deliver(() => this.state!.instance.webSocketMessage?.(this, data));
      return;
    }
    if (this.onMessage) this.onMessage(data);
    else this.pending.push(data);
  }
  flushPending() {
    const p = this.pending.splice(0);
    for (const d of p) this.onMessage?.(d);
  }
  remoteClose(code: number, reason: string) {
    if (this.readyState === 3) return;
    if (this.state) {
      this.readyState = 2;
      const st = this.state;
      st.deliver(async () => {
        try {
          await st.instance.webSocketClose?.(this, code, reason, true);
        } finally {
          this.readyState = 3;
          st.sockets.delete(this);
        }
      });
      return;
    }
    this.readyState = 3;
    this.onClose?.(code, reason);
  }
}

export class DevWebSocketPair {
  0: DevSocket;
  1: DevSocket;
  constructor() {
    const a = new DevSocket();
    const b = new DevSocket();
    a.peer = b;
    b.peer = a;
    this[0] = a;
    this[1] = b;
  }
}

// ------------------------------------------------------------------ Durable Objects

class DevStorage {
  private data = new Map<string, unknown>();
  alarmAt: number | null = null;
  constructor(private owner: DevDOState) {}
  async get(key: string | string[]) {
    if (Array.isArray(key)) return new Map(key.filter((k) => this.data.has(k)).map((k) => [k, structuredClone(this.data.get(k))]));
    return this.data.has(key) ? structuredClone(this.data.get(key)) : undefined;
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === 'string') this.data.set(key, structuredClone(value));
    else for (const [k, v] of Object.entries(key)) this.data.set(k, structuredClone(v));
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async setAlarm(t: number) {
    this.alarmAt = t;
    this.owner.scheduleAlarm(t);
  }
  async getAlarm() {
    return this.alarmAt;
  }
  async deleteAlarm() {
    this.alarmAt = null;
    this.owner.scheduleAlarm(null);
  }
  /** Test helper: raw snapshot. */
  snapshot() {
    return structuredClone(Object.fromEntries(this.data));
  }
}

interface DOInstance {
  fetch(req: Request): Promise<Response>;
  alarm?(): Promise<void>;
  webSocketMessage?(ws: DevSocket, data: string): Promise<void>;
  webSocketClose?(ws: DevSocket, code: number, reason: string, wasClean: boolean): Promise<void>;
}

export class DevDOState {
  readonly storage: DevStorage;
  readonly sockets = new Set<DevSocket>();
  instance!: DOInstance;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  closed = false;

  constructor(readonly id: { name: string; toString(): string }) {
    this.storage = new DevStorage(this);
  }
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const p = fn();
    this.ready = this.ready.then(() => p);
    return p;
  }
  acceptWebSocket(ws: DevSocket, tags: string[] = []) {
    ws.state = this;
    ws.tags = tags;
    this.sockets.add(ws);
  }
  getWebSockets(tag?: string) {
    return [...this.sockets].filter((s) => s.readyState < 3 && (!tag || s.tags.includes(tag)));
  }
  waitUntil(p: Promise<unknown>) {
    p.catch((e) => console.error('[do waitUntil]', e));
  }
  /** Runs one event at a time, like a Durable Object's input gate. */
  deliver<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(() => this.ready).then(fn);
    this.queue = run.catch((e) => console.error('[do event]', e));
    return run;
  }
  scheduleAlarm(t: number | null) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (t === null || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.storage.alarmAt !== t) return;
      this.storage.alarmAt = null;
      this.deliver(() => this.instance.alarm?.());
    }, Math.max(0, t - Date.now()));
  }
  shutdown() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

export class DevDONamespace {
  readonly states = new Map<string, DevDOState>();
  constructor(
    private Klass: new (state: DevDOState, env: unknown) => DOInstance,
    private env: () => unknown,
  ) {}
  idFromName(name: string) {
    return { name, toString: () => name };
  }
  get(id: { name: string }) {
    return {
      fetch: (input: Request | string, init?: RequestInit) => {
        const st = this.stateFor(id.name);
        const req = input instanceof Request ? input : new Request(input, init);
        return st.deliver(() => st.instance.fetch(req));
      },
    };
  }
  stateFor(name: string): DevDOState {
    let st = this.states.get(name);
    if (!st) {
      st = new DevDOState(this.idFromName(name));
      st.instance = new this.Klass(st, this.env());
      this.states.set(name, st);
    }
    return st;
  }
  /** Simulates eviction: the instance is rebuilt from storage, as after a restart. */
  evict(name: string) {
    const st = this.states.get(name);
    if (!st) return;
    st.instance = new this.Klass(st, this.env());
  }
  shutdown() {
    for (const s of this.states.values()) s.shutdown();
  }
}

// ------------------------------------------------------------------ globals

let installed = false;

/** Lets `new Response(null, { status: 101, webSocket })` work under Node, as in Workers. */
export function installRuntimeGlobals() {
  if (installed) return;
  installed = true;
  const Base = globalThis.Response;
  class WorkerResponse extends Base {
    webSocket?: DevSocket | null;
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: DevSocket | null }) {
      if (init?.status === 101) {
        super(null, { ...init, status: 200 });
        Object.defineProperty(this, 'status', { value: 101 });
        this.webSocket = init.webSocket ?? null;
      } else {
        super(body, init);
      }
    }
  }
  (globalThis as { Response: unknown }).Response = WorkerResponse;
  (globalThis as { WebSocketPair: unknown }).WebSocketPair = DevWebSocketPair;
}
