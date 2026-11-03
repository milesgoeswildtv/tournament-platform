import type { Env } from './env';
import { HttpError, json, readJson, type RouteCtx } from './http';
import { timingSafeEqual } from './security';
import { escapeHtml, sendTelegram } from './telegram';

/**
 * Telegram webhook. Telegram calls this with the secret registered by
 * scripts/telegram-setup.mjs in the X-Telegram-Bot-Api-Secret-Token header.
 */
export async function telegramWebhook(c: RouteCtx): Promise<Response> {
  const env = c.env;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) throw new HttpError(503, 'telegram_not_configured');
  const secret = c.req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!timingSafeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) throw new HttpError(401, 'bad_secret');
  const update = await readJson<{ message?: { chat: { id: number; type: string }; text?: string; from?: { first_name?: string } } }>(c.req, 65_536);
  const msg = update.message;
  if (msg?.text && msg.chat.type === 'private') c.exec.waitUntil(handleCommand(env, msg.chat.id, msg.text, msg.from?.first_name));
  return json({ ok: true });
}

async function handleCommand(env: Env, chatId: number, text: string, firstName?: string) {
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  const chat = String(chatId);
  const name = firstName ? escapeHtml(firstName) : 'there';
  if (cmd === '/start') {
    const code = (arg ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) {
      const inv = await env.DB.prepare('SELECT t.title FROM invites i JOIN tournaments t ON t.id = i.tournament_id WHERE i.code = ?').bind(code).first<{ title: string }>();
      if (inv) {
        await sendTelegram(env, chat, `You're invited to <b>${escapeHtml(inv.title)}</b>.\nTap below to open the lobby.`, `/j/${code}`, 'Join tournament');
        return;
      }
    }
    await sendTelegram(
      env,
      chat,
      `Hey ${name}. This is <b>NAME TBD</b> — sponsored elimination tournaments.\n\nTap below to open the app. Have an invite code? Send <code>/join CODE</code>.`,
      '/',
      'Open',
    );
    return;
  }
  if (cmd === '/join') {
    const code = (arg ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return void (await sendTelegram(env, chat, 'Send the code like this: <code>/join ABCD2345</code>'));
    await sendTelegram(env, chat, `Opening invite <code>${escapeHtml(code)}</code>.`, `/j/${code}`, 'Join tournament');
    return;
  }
  if (cmd === '/help') {
    await sendTelegram(env, chat, '/start — open the app\n/join CODE — open an invite\nNotifications for your tournaments arrive here automatically.');
  }
}
