import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { startDevServer, type DevServer } from '../dev/server';
import { Client } from './support/client';

const ADAPTER_KEY = 'test-only-shyst-adapter-key-which-is-long-enough';
const TOKEN = 'a'.repeat(64);
let server: DevServer;
let gateway: Server;
let gatewayUrl = '';
let gatewayStatus = 200;
const calls: { headers: Record<string, string | string[] | undefined>; body: any }[] = [];

before(async () => {
  gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* deliberately malformed requests remain observable */ }
    calls.push({ headers: req.headers, body });
    res.writeHead(gatewayStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(gatewayStatus === 200 ? { link_id: 'link_test_123' } : { error: 'rejected' }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
  server = await startDevServer({
    quiet: true,
    staticDir: null,
    extraEnv: {
      CRASHOUT_SHYST_ADAPTER_KEY: ADAPTER_KEY,
      CRASHOUT_LINK_GATEWAY_URL: gatewayUrl,
    },
  });
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve()));
});

describe('Crashout SHYST adapter', () => {
  test('requires a valid SHYST session before contacting Crashout', async () => {
    const anonymous = new Client(server.url, 'anonymous');
    const response = await anonymous.api('POST', '/api/me/crashout/link', { token: TOKEN });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });

  test('refuses to operate when the server-side adapter credential is absent', async () => {
    const player = await Client.register(server.url, 'linkmissing');
    const key = (server.env as any).CRASHOUT_SHYST_ADAPTER_KEY;
    delete (server.env as any).CRASHOUT_SHYST_ADAPTER_KEY;
    try {
      const response = await player.api('POST', '/api/me/crashout/link', { token: TOKEN });
      assert.equal(response.status, 503);
      assert.equal(response.data.error, 'crashout_link_unavailable');
      assert.equal(calls.length, 0);
    } finally {
      (server.env as any).CRASHOUT_SHYST_ADAPTER_KEY = key;
    }
  });

  test('rejects malformed and non-hex one-time tokens without contacting the gateway', async () => {
    const player = await Client.register(server.url, 'linkinvalid');
    for (const token of ['short', 'g'.repeat(64), 'A'.repeat(64), 42, null]) {
      const response = await player.api('POST', '/api/me/crashout/link', { token });
      assert.equal(response.status, 400);
      assert.equal(response.data.error, 'invalid_link_token');
    }
    assert.equal(calls.length, 0);
  });

  test('sends only the authenticated SHYST player id through the server-side gateway', async () => {
    const player = await Client.register(server.url, 'linksuccess');
    const response = await player.api('POST', '/api/me/crashout/link', { token: TOKEN, externalPlayerId: 'forged-player-id' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual(response.data, { ok: true, linked: true, destination: 'shyst', linkId: 'link_test_123' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['x-crashout-adapter-key'], ADAPTER_KEY);
    assert.deepEqual(calls[0].body, { game_key: 'shyst', token: TOKEN, external_player_id: player.user.id });
    assert.notEqual(calls[0].body.external_player_id, 'forged-player-id');
    assert.ok(!JSON.stringify(response.data).includes(ADAPTER_KEY));
  });

  test('does not report success when the central gateway rejects a stale, replayed, or wrong-destination token', async () => {
    const player = await Client.register(server.url, 'linkrejected');
    gatewayStatus = 409;
    try {
      const response = await player.api('POST', '/api/me/crashout/link', { token: TOKEN });
      assert.equal(response.status, 409);
      assert.equal(response.data.error, 'crashout_link_rejected');
      assert.equal(response.data.linked, undefined);
    } finally {
      gatewayStatus = 200;
    }
  });
});
