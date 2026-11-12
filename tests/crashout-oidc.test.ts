import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer, type DevServer } from '../dev/server';
import { Client } from './support/client';

let server: DevServer;
before(async () => { server = await startDevServer({ quiet: true, staticDir: null }); });
after(async () => { await server.close(); });

describe('CRASHOUT OIDC route safety', () => {
  test('does not advertise SSO until every server-side credential is configured', async () => {
    const response = await fetch(`${server.url}/api/auth/providers`);
    const data = await response.json() as { crashout: boolean };
    assert.equal(data.crashout, false);
  });

  test('requires an existing SHYST session before starting a legacy account claim', async () => {
    const anonymous = new Client(server.url, 'anonymous');
    const response = await anonymous.api('POST', '/api/auth/crashout/start', { purpose: 'link' });
    assert.equal(response.status, 401);
    assert.equal(response.data.error, 'unauthorized');
  });

  test('fails closed when CRASHOUT OIDC is not configured', async () => {
    const anonymous = new Client(server.url, 'anonymous');
    const response = await anonymous.api('POST', '/api/auth/crashout/start', { purpose: 'sign_in' });
    assert.equal(response.status, 503);
    assert.equal(response.data.error, 'crashout_sso_not_configured');
  });

  test('does not exchange malformed or replayable browser tickets', async () => {
    const anonymous = new Client(server.url, 'anonymous');
    const malformed = await anonymous.api('POST', '/api/auth/crashout/exchange', { ticket: 'not-a-ticket' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.data.error, 'invalid_ticket');
    const unknown = await anonymous.api('POST', '/api/auth/crashout/exchange', { ticket: 'A'.repeat(43) });
    assert.equal(unknown.status, 410);
    assert.equal(unknown.data.error, 'ticket_expired');
  });

  test('expires unknown callbacks without creating a player or session', async () => {
    const response = await fetch(`${server.url}/api/auth/crashout/callback?code=fake&state=not-a-valid-state`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location') ?? '', /\/auth\?crashout=expired$/);
  });
});
