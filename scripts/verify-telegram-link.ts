/**
 * Production check of Telegram account linking, against a deployed API.
 * Proves the identity relationship through the live Worker and D1, not the UI
 * label: one SHYST player, Telegram attached to it, no duplicates.
 *
 *   E2E_API_URL=https://….workers.dev TELEGRAM_BOT_TOKEN=… node --import tsx scripts/verify-telegram-link.ts
 *
 * Uses a fresh QA account and a synthetic Telegram user id (never a real one).
 * The webhook secret is derived from the token exactly as the deploy job does.
 * The bot's confirmation message to the synthetic chat fails harmlessly.
 */
import { createHash, createHmac, randomInt } from 'node:crypto';

const API = (process.env.E2E_API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
if (!API || !TOKEN) {
  console.log('skipped: set E2E_API_URL and TELEGRAM_BOT_TOKEN');
  process.exit(0);
}
const HOOK = process.env.TELEGRAM_WEBHOOK_SECRET || createHash('sha256').update(`webhook:${TOKEN}`).digest('hex').slice(0, 48);
const TG = 7_000_000_000_000 + randomInt(1, 999_999_999); // synthetic, far outside real Telegram ids
const handle = `qa_link_${Date.now().toString(36)}`;
const password = `qa-${Math.random().toString(36).slice(2)}-pass`;

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json().catch(() => null)) as any };
};
const check = (ok: unknown, msg: string) => {
  if (!ok) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
};
const initData = () => {
  const f: Record<string, string> = { user: JSON.stringify({ id: TG, first_name: 'QA', username: 'qa_link_bot_test' }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const c = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  return new URLSearchParams({ ...f, hash: createHmac('sha256', secret).update(c).digest('hex') }).toString();
};
const botStart = (param: string) =>
  fetch(`${API}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': HOOK },
    body: JSON.stringify({ message: { chat: { id: TG, type: 'private' }, from: { id: TG, first_name: 'QA' }, text: `/start ${param}` } }),
  });

// 1. account creation
const reg = await call('POST', '/api/auth/register', { handle, password, displayName: 'QA Link' });
check(reg.status === 201, `account created: ${handle} #${reg.data?.user?.tag}`);
const original = reg.data.user;

// 2. link through the bot
const link = await call('POST', '/api/me/telegram/link', undefined, reg.data.token);
check(link.status === 200 && link.data.linked === false && /start=link_/.test(link.data.botUrl), `link token issued (${link.data?.botUrl?.split('?')[0]})`);
const param = new URL(link.data.botUrl).searchParams.get('start')!;
const hook = await botStart(param);
check(hook.status === 200, 'bot /start link_… accepted by the webhook');
const me = await call('GET', '/api/me', undefined, reg.data.token);
check(me.data.telegram.linked === true, 'original player now reports Telegram linked');

// 3. Telegram sign-in resolves to the original player (no browser session, like the Mini App)
const tg1 = await call('POST', '/api/auth/telegram', { initData: initData() });
check(tg1.status === 200 && tg1.data.user.id === original.id && tg1.data.user.tag === original.tag, `Mini App sign-in resolves to the original player #${tg1.data?.user?.tag}`);

// 4. logout and login keep the association
await call('POST', '/api/auth/logout', undefined, reg.data.token);
check((await call('GET', '/api/me', undefined, reg.data.token)).status === 401, 'logout ends the session');
const back = await call('POST', '/api/auth/login', { handle, password });
check(back.status === 200 && back.data.user.id === original.id && back.data.user.telegram === true, 'password login: same player, still linked');

// 5. repeated linking and repeated Telegram sign-in create nothing
const again = await call('POST', '/api/me/telegram/link', undefined, back.data.token);
check(again.data.linked === true, 'a repeat link request reports already linked');
await botStart(param);
for (let i = 0; i < 2; i++) {
  const r = await call('POST', '/api/auth/telegram', { initData: initData() });
  check(r.data.user.id === original.id, `repeat Telegram sign-in ${i + 1} → same player`);
}
const other = await call('POST', '/api/auth/register', { handle: `${handle}_b`, password, displayName: 'QA Other' });
const steal = await call('POST', '/api/me/telegram/link', undefined, other.data.token);
await botStart(new URL(steal.data.botUrl).searchParams.get('start')!);
check((await call('GET', '/api/me', undefined, other.data.token)).data.telegram.linked === false, 'a second SHYST player cannot take the linked Telegram account');
const final = await call('POST', '/api/auth/telegram', { initData: initData() });
check(final.data.user.id === original.id, 'Telegram still resolves to the original player');
console.log(`\nproduction linking verified against ${API}: player #${original.tag}, synthetic Telegram ${TG}`);
