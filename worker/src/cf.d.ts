/**
 * Minimal Cloudflare Workers runtime declarations used by this project.
 * Kept local so the worker typechecks without @cloudflare/workers-types.
 */
interface D1Result<T = unknown> {
  success: boolean;
  results?: T[];
  meta: { changes: number; last_row_id: number; duration?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T> & { results: T[] }>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<unknown>;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(time: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  waitUntil(p: Promise<unknown>): void;
}
interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface WebSocket {
  accept(): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
interface ResponseInit {
  webSocket?: WebSocket | null;
}
