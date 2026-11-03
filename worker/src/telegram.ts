import type { Env } from './env';
import { hex, hmacSha256, timingSafeEqual } from './security';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface ValidInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
}

/**
 * Validates Telegram Mini App initData on the server.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * The browser's copy of the user is never trusted; only this signed payload is.
 */
export async function validateInitData(initData: string, botToken: string, maxAgeSec = 86_400, nowMs = Date.now()): Promise<ValidInitData | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== 'hash') pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const expected = hex(await hmacSha256(new Uint8Array(secret), pairs.join('\n')));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowMs / 1000 - authDate > maxAgeSec) return null;
  let user: TelegramUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'number') return null;
  return { user, authDate, startParam: params.get('start_param') };
}

export function telegramConfigured(env: Env): boolean {
  return !!env.TELEGRAM_BOT_TOKEN;
}

export async function tgApi(env: Env, method: string, body: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean };
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

/** Link that opens the Mini App directly (when a short name is registered), else the web app. */
export function miniAppLink(env: Env, startParam?: string): string {
  if (env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_MINIAPP_SHORTNAME) {
    const q = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '';
    return `https://t.me/${env.TELEGRAM_BOT_USERNAME}/${env.TELEGRAM_MINIAPP_SHORTNAME}${q}`;
  }
  return startParam ? `${env.APP_URL}/j/${encodeURIComponent(startParam)}` : env.APP_URL;
}

export function openButton(env: Env, label: string, path = '') {
  return { inline_keyboard: [[{ text: label, web_app: { url: `${env.APP_URL}${path}` } }]] };
}

export async function sendTelegram(env: Env, chatId: string, text: string, path?: string, label = 'Open') {
  return tgApi(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(path !== undefined ? { reply_markup: openButton(env, label, path) } : {}),
  });
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
