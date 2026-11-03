import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateInitData } from '../worker/src/telegram';

const TOKEN = '123456:TEST-token-for-unit-tests';

/** Builds initData exactly as Telegram signs it (independent implementation with node:crypto). */
function sign(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 4242, first_name: 'Ada', username: 'ada' });

describe('Telegram Mini App initData validation (server side)', () => {
  test('accepts a correctly signed, fresh payload and exposes the start parameter', async () => {
    const r = await validateInitData(sign({ user, auth_date: String(now), query_id: 'AAE', start_param: 'K7ZQ2M4P' }), TOKEN);
    assert.ok(r);
    assert.equal(r!.user.id, 4242);
    assert.equal(r!.startParam, 'K7ZQ2M4P');
  });

  test('rejects a tampered user id', async () => {
    const good = sign({ user, auth_date: String(now) });
    const forged = good.replace(encodeURIComponent('"id":4242'), encodeURIComponent('"id":1'));
    assert.notEqual(forged, good);
    assert.equal(await validateInitData(forged, TOKEN), null);
  });

  test('rejects a payload signed with another bot token', async () => {
    assert.equal(await validateInitData(sign({ user, auth_date: String(now) }, '999:other'), TOKEN), null);
  });

  test('rejects stale auth_date and missing hash', async () => {
    assert.equal(await validateInitData(sign({ user, auth_date: String(now - 2 * 86400) }), TOKEN), null);
    assert.equal(await validateInitData(`user=${encodeURIComponent(user)}&auth_date=${now}`, TOKEN), null);
    assert.equal(await validateInitData('', TOKEN), null);
  });
});
