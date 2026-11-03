import { randomCode, secureRng } from '../../shared/src/rng';
import type { Env } from './env';
import { HttpError } from './http';

const enc = new TextEncoder();

export const now = () => Date.now();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

export function newId(prefix: string): string {
  return `${prefix}_${b64url(randomBytes(12)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14).padEnd(14, '0')}`;
}

export const newTag = () => randomCode(secureRng, 6);
export const newInviteCode = () => randomCode(secureRng, 8);

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** PBKDF2-SHA256, 100k iterations (the Workers runtime maximum). */
export async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : randomBytes(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/**
 * Fixed-window rate limiter stored in D1. Returns silently when allowed,
 * throws 429 otherwise.
 */
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const win = nowSec - (nowSec % windowSec); // window start, in epoch seconds
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, win)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.');
  if (Math.random() < 0.02) {
    // Windows are at most an hour long; anything older than two hours is dead.
    await env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(nowSec - 7200).run();
  }
}
