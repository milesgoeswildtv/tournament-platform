import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { startDevServer, type DevServer } from '../dev/server';
import { Client } from './support/client';

const CLIENT_ID = 'shyst-staging-client';
const CLIENT_SECRET = 'test-only-confidential-client-secret';
const ADAPTER_KEY = 'test-only-shyst-adapter-key-with-more-than-32-characters';
const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'shyst-test-key', alg: 'RS256', use: 'sig' };
let mock: Server;
let mockOrigin = '';
let issuer = '';
let server: DevServer;
let mappedPlayerId: string | null = null;
let codeCounter = 0;
let badSignature = false;
const nonceByCode = new Map<string, string>();
const claims: { external_player_id: string; game_key: string }[] = [];

function signedIdToken(nonce: string) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'shyst-test-key', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: issuer, aud: CLIENT_ID, sub: randomUUID(),
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, nonce,
  }));
  const input = `${head}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = b64url(signer.sign(privateKey));
  return badSignature ? `${input}.${signature.slice(0, -2)}xx` : `${input}.${signature}`;
}

before(async () => {
  mock = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/auth/v1/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${mockOrigin}/auth/v1/oauth/authorize`,
        token_endpoint: `${mockOrigin}/auth/v1/oauth/token`,
        jwks_uri: `${mockOrigin}/auth/v1/.well-known/jwks.json`,
      });
    }
    if (req.method === 'GET' && req.url === '/auth/v1/.well-known/jwks.json') return send(200, { keys: [jwk] });
    if (req.method === 'POST' && req.url === '/auth/v1/oauth/token') {
      const form = new URLSearchParams(raw);
      const expected = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
      if (req.headers.authorization !== expected) return send(401, { error: 'invalid_client' });
      const code = form.get('code') ?? '';
      const nonce = nonceByCode.get(code);
      if (!nonce || form.get('grant_type') !== 'authorization_code' || !form.get('code_verifier')) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'test-access-token', token_type: 'bearer', id_token: signedIdToken(nonce) });
    }
    if (req.method === 'POST' && req.url === '/functions/v1/resolve-destination-identity') {
      const body = JSON.parse(raw);
      return send(200, { ok: true, game_key: body.game_key, linked: !!mappedPlayerId, external_player_id: mappedPlayerId });
    }
    if (req.method === 'POST' && req.url === '/functions/v1/claim-destination-identity') {
      const body = JSON.parse(raw);
      claims.push({ game_key: body.game_key, external_player_id: body.external_player_id });
      mappedPlayerId = body.external_player_id;
      return send(200, { ok: true, linked: true, already_linked: false, link_id: 'test-link' });
    }
    return send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  mockOrigin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  issuer = `${mockOrigin}/auth/v1`;
  server = await startDevServer({
    quiet: true,
    staticDir: null,
    extraEnv: {
      CRASHOUT_OIDC_ISSUER: issuer,
      CRASHOUT_OIDC_CLIENT_ID: CLIENT_ID,
      CRASHOUT_OIDC_CLIENT_SECRET: CLIENT_SECRET,
      CRASHOUT_SHYST_ADAPTER_KEY: ADAPTER_KEY,
      CRASHOUT_IDENTITY_API_URL: `${mockOrigin}/functions/v1`,
    },
  });
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
});

async function authorize(purpose: 'link' | 'sign_in', player?: Client) {
  const start = await (player ?? new Client(server.url, 'oidc-anon')).api('POST', '/api/auth/crashout/start', { purpose });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const authUrl = new URL(start.data.url);
  assert.equal(authUrl.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authUrl.searchParams.get('code_challenge'));
  const code = `test-code-${++codeCounter}`;
  nonceByCode.set(code, authUrl.searchParams.get('nonce')!);
  const callback = await fetch(`${server.url}/api/auth/crashout/callback?${new URLSearchParams({ code, state: authUrl.searchParams.get('state')! })}`, { redirect: 'manual' });
  assert.equal(callback.status, 302);
  return { location: callback.headers.get('location') ?? '', state: authUrl.searchParams.get('state')! };
}

describe('CRASHOUT OIDC staging flow', () => {
  test('advertises the provider only when server-side configuration exists', async () => {
    const response = await fetch(`${server.url}/api/auth/providers`);
    const data = await response.json() as { crashout: boolean };
    assert.equal(data.crashout, true);
    const secret = server.env.CRASHOUT_OIDC_CLIENT_SECRET;
    delete server.env.CRASHOUT_OIDC_CLIENT_SECRET;
    try {
      const unavailable = await new Client(server.url, 'no-config').api('POST', '/api/auth/crashout/start', { purpose: 'sign_in' });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.data.error, 'crashout_sso_not_configured');
    } finally {
      server.env.CRASHOUT_OIDC_CLIENT_SECRET = secret;
    }
  });

  test('requires an existing SHYST session before starting a legacy account claim', async () => {
    const anonymous = new Client(server.url, 'anonymous');
    const response = await anonymous.api('POST', '/api/auth/crashout/start', { purpose: 'link' });
    assert.equal(response.status, 401);
  });

  test('creates a new non-admin SHYST player from a verified CRASHOUT subject, then exchanges a one-use ticket', async () => {
    mappedPlayerId = null;
    const beforeClaims = claims.length;
    const result = await authorize('sign_in');
    assert.match(result.location, /^http:\/\/127\.0\.0\.1:\d+\/auth#crashout-ticket=/);
    const ticket = new URL(result.location).hash.split('crashout-ticket=')[1];
    assert.ok(ticket);
    const anonymous = new Client(server.url, 'oidc-new-player');
    const exchange = await anonymous.api('POST', '/api/auth/crashout/exchange', { ticket });
    assert.equal(exchange.status, 200, JSON.stringify(exchange.data));
    assert.equal(exchange.data.user.isAdmin, false);
    assert.equal(exchange.data.user.name, 'CRASHOUT Player');
    assert.equal(claims.length, beforeClaims + 1);
    assert.equal(claims.at(-1)?.external_player_id, exchange.data.user.id);
    const replay = await anonymous.api('POST', '/api/auth/crashout/exchange', { ticket });
    assert.equal(replay.status, 410);
  });

  test('returns a returning CRASHOUT identity to its original SHYST player', async () => {
    const originalId = mappedPlayerId;
    assert.ok(originalId);
    const result = await authorize('sign_in');
    const ticket = new URL(result.location).hash.split('crashout-ticket=')[1];
    const exchange = await new Client(server.url, 'oidc-returning').api('POST', '/api/auth/crashout/exchange', { ticket });
    assert.equal(exchange.status, 200, JSON.stringify(exchange.data));
    assert.equal(exchange.data.user.id, originalId);
    assert.equal(claims.length, 1, 'returning login must not create another identity claim');
  });

  test('links only the authenticated existing SHYST player and preserves its id', async () => {
    const player = await Client.register(server.url, 'oidclinkexisting');
    const beforeClaims = claims.length;
    const result = await authorize('link', player);
    assert.match(result.location, /\/settings\?crashout=linked$/);
    assert.deepEqual(claims.at(-1), { game_key: 'shyst', external_player_id: player.user.id });
    assert.equal(claims.length, beforeClaims + 1);
  });

  test('rejects a forged ID-token signature and consumes the callback state', async () => {
    const player = new Client(server.url, 'oidc-forged');
    const start = await player.api('POST', '/api/auth/crashout/start', { purpose: 'sign_in' });
    const authUrl = new URL(start.data.url);
    const code = `test-code-${++codeCounter}`;
    nonceByCode.set(code, authUrl.searchParams.get('nonce')!);
    badSignature = true;
    try {
      const callback = await fetch(`${server.url}/api/auth/crashout/callback?${new URLSearchParams({ code, state: authUrl.searchParams.get('state')! })}`, { redirect: 'manual' });
      assert.match(callback.headers.get('location') ?? '', /\/auth\?crashout=failed$/);
      const replay = await fetch(`${server.url}/api/auth/crashout/callback?${new URLSearchParams({ code, state: authUrl.searchParams.get('state')! })}`, { redirect: 'manual' });
      assert.match(replay.headers.get('location') ?? '', /\/auth\?crashout=expired$/);
    } finally {
      badSignature = false;
    }
  });
});
