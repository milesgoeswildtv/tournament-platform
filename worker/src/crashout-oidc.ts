/**
 * CRASHOUT OIDC bridge for SHYST.
 * All OAuth secrets, PKCE verifiers, ID-token verification and destination
 * adapter calls remain inside the Worker. Browser receives only a one-use
 * session ticket after a successful sign-in.
 */
import type { Env } from './env';
import { createSession, optionalUser, publicUser, requireUser, uniqueTag, type UserRow } from './auth';
import { HttpError, json, readJson, clientIp, type RouteCtx } from './http';
import { b64url, newId, now, randomBytes, rateLimit, sha256Hex } from './security';

const TX_TTL = 10 * 60_000;
const TICKET_TTL = 2 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const enc = new TextEncoder();
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(decode(s)));
const origin = (env: Env) => env.CRASHOUT_OIDC_ISSUER!.replace(/\/$/, '');
const callbackUri = (env: Env, req: Request) => env.CRASHOUT_OIDC_REDIRECT_URI || new URL('/api/auth/crashout/callback', req.url).toString();

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
async function discovery(env: Env): Promise<Discovery> {
  if (!env.CRASHOUT_OIDC_ISSUER || !env.CRASHOUT_OIDC_CLIENT_ID || !env.CRASHOUT_OIDC_CLIENT_SECRET || !env.CRASHOUT_SHYST_ADAPTER_KEY) {
    throw new HttpError(503, 'crashout_sso_not_configured', 'CRASHOUT sign-in is not configured on this SHYST environment yet.');
  }
  const issuer = origin(env);
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new HttpError(503, 'crashout_oidc_unavailable', 'CRASHOUT identity discovery is unavailable.');
  const d = await res.json() as Discovery;
  if (d.issuer !== issuer || !d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) {
    throw new HttpError(503, 'crashout_oidc_invalid_discovery');
  }
  for (const endpoint of [d.authorization_endpoint, d.token_endpoint, d.jwks_uri]) {
    if (new URL(endpoint).origin !== new URL(issuer).origin) throw new HttpError(503, 'crashout_oidc_invalid_discovery');
  }
  return d;
}

async function createTransaction(env: Env, purpose: 'legacy_claim' | 'sign_in', userId: string | null) {
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  const t = now();
  await env.DB.prepare('INSERT INTO crashout_oidc_transactions (state_hash,user_id,nonce_hash,code_verifier,purpose,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(await sha256Hex(state), userId, await sha256Hex(nonce), verifier, purpose, t, t + TX_TTL).run();
  return { state, nonce, challenge };
}

export async function crashoutStart(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `crashout-oidc-start:${clientIp(c.req)}`, 20, 600);
  const body = await readJson(c.req, 2048);
  const purpose = body.purpose === 'link' ? 'legacy_claim' : 'sign_in';
  const user = purpose === 'legacy_claim' ? await requireUser(c) : null;
  if (user && user.merged_into) throw new HttpError(409, 'account_unavailable');
  const d = await discovery(c.env);
  const tx = await createTransaction(c.env, purpose, user?.id ?? null);
  const q = new URLSearchParams({
    client_id: c.env.CRASHOUT_OIDC_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: callbackUri(c.env, c.req),
    scope: 'openid',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: tx.challenge,
    code_challenge_method: 'S256',
  });
  return json({ url: `${d.authorization_endpoint}?${q}`, expiresIn: TX_TTL / 1000 });
}

type Transaction = { user_id: string | null; nonce_hash: string; code_verifier: string; purpose: string };
async function consumeTransaction(env: Env, state: string): Promise<Transaction | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return null;
  return env.DB.prepare(`UPDATE crashout_oidc_transactions SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
    RETURNING user_id,nonce_hash,code_verifier,purpose`)
    .bind(now(), await sha256Hex(state), now()).first<Transaction>();
}

async function exchangeCode(env: Env, req: Request, code: string, verifier: string, d: Discovery): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUri(env, req),
    code_verifier: verifier,
  });
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      authorization: `Basic ${btoa(`${env.CRASHOUT_OIDC_CLIENT_ID}:${env.CRASHOUT_OIDC_CLIENT_SECRET}`)}`,
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`oidc_token_exchange_${res.status}`);
  const tokens = await res.json() as { id_token?: unknown };
  if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16_000) throw new Error('oidc_missing_id_token');
  return tokens.id_token;
}

async function verifyIdToken(token: string, d: Discovery, env: Env, nonceHash: string): Promise<string> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !p)) throw new Error('bad_jwt');
  const header = decodeJson(parts[0]) as { alg?: string; kid?: string };
  const claims = decodeJson(parts[1]) as Record<string, unknown>;
  if (!['RS256', 'ES256'].includes(header.alg ?? '') || typeof header.kid !== 'string') throw new Error('bad_jwt_header');
  const jwksRes = await fetch(d.jwks_uri, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!jwksRes.ok) throw new Error('jwks_unavailable');
  const jwks = await jwksRes.json() as { keys?: JsonWebKey[] };
  const jwk = (jwks.keys ?? []).find(k => (k as JsonWebKey & { kid?: string; alg?: string }).kid === header.kid) as (JsonWebKey & { alg?: string }) | undefined;
  if (!jwk) throw new Error('unknown_signing_key');
  const alg = header.alg!;
  if (jwk.alg && jwk.alg !== alg) throw new Error('key_algorithm_mismatch');
  const key = alg === 'RS256'
    ? await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    : await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signatureValid = await crypto.subtle.verify(
    alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
    key, decode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
  );
  const aud = claims.aud;
  const audienceOk = aud === env.CRASHOUT_OIDC_CLIENT_ID || (Array.isArray(aud) && aud.includes(env.CRASHOUT_OIDC_CLIENT_ID));
  const current = Math.floor(Date.now() / 1000);
  const nonce = typeof claims.nonce === 'string' ? claims.nonce : '';
  if (!signatureValid || claims.iss !== d.issuer || !audienceOk || typeof claims.sub !== 'string' || !UUID.test(claims.sub)
      || typeof claims.exp !== 'number' || claims.exp <= current - 5 || claims.exp > current + 3600
      || typeof claims.iat !== 'number' || claims.iat > current + 5 || claims.iat < current - 600
      || (typeof claims.nbf === 'number' && claims.nbf > current + 5)
      || await sha256Hex(nonce) !== nonceHash) throw new Error('oidc_claim_validation_failed');
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== env.CRASHOUT_OIDC_CLIENT_ID) throw new Error('oidc_azp_invalid');
  return claims.sub;
}

async function callCrashout(env: Env, path: 'claim-destination-identity' | 'resolve-destination-identity', body: Record<string, unknown>) {
  const base = env.CRASHOUT_IDENTITY_API_URL || 'https://qcmfnkuyinhfdxnuvneb.supabase.co/functions/v1';
  const res = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-crashout-adapter-key': env.CRASHOUT_SHYST_ADAPTER_KEY! },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (res.status === 409) throw new HttpError(409, 'crashout_identity_conflict', 'This CRASHOUT account is already linked to another SHYST player, or the destination is not ready.');
    if (res.status === 401 || res.status === 403) throw new HttpError(503, 'crashout_adapter_rejected', 'The server-to-server CRASHOUT connection needs configuration.');
    throw new HttpError(503, 'crashout_identity_unavailable', 'CRASHOUT could not verify the identity mapping.');
  }
  return await res.json() as { linked?: boolean; external_player_id?: string | null };
}

async function putTicket(env: Env, userId: string): Promise<string> {
  const ticket = b64url(randomBytes(32));
  const t = now();
  await env.DB.prepare('INSERT INTO auth_flows (token_hash,kind,user_id,payload,created_at,expires_at) VALUES (?,?,?,?,?,?)')
    .bind(await sha256Hex(ticket), 'session_ticket', userId, null, t, t + TICKET_TTL).run();
  return ticket;
}

async function finishSignIn(c: RouteCtx, subject: string, idToken: string, nonce: string): Promise<Response> {
  const mapping = await callCrashout(c.env, 'resolve-destination-identity', { game_key: 'shyst', crashout_user_id: subject });
  let user: UserRow | null = null;
  if (mapping.linked && mapping.external_player_id) {
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND merged_into IS NULL').bind(mapping.external_player_id).first<UserRow>();
    if (!user) throw new HttpError(409, 'shyst_player_missing', 'The linked SHYST player could not be found. Contact support; no account was changed.');
  } else {
    // No identity match means a genuinely new SHYST player. Never search by email or handle.
    const id = newId('u');
    const t = now();
    const tag = await uniqueTag(c.env);
    await c.env.DB.prepare('INSERT INTO users (id,tag,handle,display_name,is_admin,created_at,updated_at) VALUES (?,?,NULL,?,0,?,?)')
      .bind(id, tag, 'CRASHOUT Player', t, t).run();
    try {
      await callCrashout(c.env, 'claim-destination-identity', {
        game_key: 'shyst', external_player_id: id, id_token: idToken, nonce,
      });
    } catch (e) {
      // The new account has no sessions or gameplay rows yet; remove only this just-created row.
      await c.env.DB.prepare('DELETE FROM users WHERE id = ? AND created_at = ?').bind(id, t).run();
      throw e;
    }
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  }
  if (!user) throw new HttpError(500, 'shyst_account_creation_failed');
  const ticket = await putTicket(c.env, user.id);
  return redirect(`${c.env.APP_URL.replace(/\/$/, '')}/auth/crashout#ticket=${encodeURIComponent(ticket)}`);
}

export async function crashoutCallback(c: RouteCtx): Promise<Response> {
  const q = c.url.searchParams;
  const state = q.get('state') ?? '';
  const tx = await consumeTransaction(c.env, state);
  const app = c.env.APP_URL.replace(/\/$/, '');
  if (!tx) return redirect(`${app}/auth?crashout=expired`);
  const back = tx.purpose === 'legacy_claim' ? `${app}/settings?crashout=` : `${app}/auth?crashout=`;
  if (q.get('error')) return redirect(back + (q.get('error') === 'access_denied' ? 'denied' : 'failed'));
  const code = q.get('code');
  if (!code || code.length > 2048) return redirect(back + 'failed');
  try {
    const d = await discovery(c.env);
    const idToken = await exchangeCode(c.env, c.req, code, tx.code_verifier, d);
    // The nonce is stored only as a hash; verify locally and pass the original nonce
    // to CRASHOUT's independent verifier by deriving it from the verified token.
    const claims = decodeJson(idToken.split('.')[1]) as { nonce?: unknown };
    if (typeof claims.nonce !== 'string' || await sha256Hex(claims.nonce) !== tx.nonce_hash) throw new Error('nonce_mismatch');
    const subject = await verifyIdToken(idToken, d, c.env, tx.nonce_hash);
    if (tx.purpose === 'legacy_claim') {
      if (!tx.user_id) throw new Error('claim_transaction_missing_user');
      const owner = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? AND merged_into IS NULL').bind(tx.user_id).first<{ id: string }>();
      if (!owner) throw new Error('claim_owner_unavailable');
      const result = await callCrashout(c.env, 'claim-destination-identity', {
        game_key: 'shyst', external_player_id: tx.user_id, id_token: idToken, nonce: claims.nonce,
      });
      return redirect(`${app}/settings?crashout=${result.linked ? 'linked' : 'linked'}`);
    }
    return await finishSignIn(c, subject, idToken, claims.nonce);
  } catch (e) {
    console.error('CRASHOUT OIDC callback failed:', e instanceof Error ? e.message : 'unknown');
    return redirect(back + 'failed');
  }
}

export async function crashoutExchange(c: RouteCtx): Promise<Response> {
  await rateLimit(c.env, `crashout-oidc-exchange:${clientIp(c.req)}`, 30, 600);
  const body = await readJson(c.req, 2048);
  if (typeof body.ticket !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(body.ticket)) throw new HttpError(400, 'invalid_ticket');
  const row = await c.env.DB.prepare(`UPDATE auth_flows SET used_at = ?
    WHERE token_hash = ? AND kind = 'session_ticket' AND used_at IS NULL AND expires_at > ?
    RETURNING user_id`)
    .bind(now(), await sha256Hex(body.ticket), now()).first<{ user_id: string | null }>();
  const user = row?.user_id ? await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND merged_into IS NULL').bind(row.user_id).first<UserRow>() : null;
  if (!user) throw new HttpError(410, 'ticket_expired', 'That CRASHOUT sign-in expired. Start again.');
  const token = await createSession(c.env, user.id, c.req.headers.get('user-agent'));
  return json({ token, user: publicUser(user) });
}
