import type { Env } from './env';
import { HttpError, json, readJson, type RouteCtx } from './http';
import { timingSafeEqual } from './security';
import { escapeHtml, sendTelegram } from './telegram';
import { LINK_PREFIX, attachTelegram, consumeLinkToken } from './identity';

/**
 * Telegram webhook. Telegram calls this with the secret registered by
 * scripts/telegram-setup.mjs in the X-Telegram-Bot-Api-Secret-Token header.
 */
export async function telegramWebhook(c: RouteCtx): Promise<Response> {
  const env = c.env;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) throw new HttpError(503, 'telegram_not_configured');
  const secret = c.req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!timingSafeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) throw new HttpError(401, 'bad_secret');
  const update = await readJson<{ message?: { chat: { id: number; type: string }; text?: string; from?: { id?: number; first_name?: string; username?: string; is_bot?: boolean } } }>(c.req, 65_536);
  const msg = update.message;
  if (msg?.text && msg.chat.type === 'private') {
    const [cmd, arg] = msg.text.trim().split(/\s+/, 2);
    // Linking runs inside the request so its outcome is recorded before Telegram retries.
    if (cmd === '/start' && arg?.startsWith(LINK_PREFIX) && msg.from?.id && !msg.from.is_bot) {
      await linkFromBot(env, msg.chat.id, arg.slice(LINK_PREFIX.length), { id: String(msg.from.id), username: msg.from.username ?? null });
    } else {
      c.exec.waitUntil(handleCommand(env, msg.chat.id, msg.text, msg.from?.first_name));
    }
  }
  return json({ ok: true });
}

/**
 * /start link_<token>, sent by the link button in Settings. Telegram's webhook
 * is authenticated by the secret header, so `from.id` is the verified sender.
 */
async function linkFromBot(env: Env, chatId: number, token: string, tg: { id: string; username: string | null }) {
  const chat = String(chatId);
  const target = await consumeLinkToken(env, token, tg.id);
  if (!target) {
    await sendTelegram(env, chat, 'That link has expired or was already used. Open SHYST, go to Settings and tap <b>Link Telegram</b> again.', '/settings', 'Open SHYST');
    return;
  }
  const r = await attachTelegram(env, target, tg, 'bot');
  if (!r.ok) {
    await sendTelegram(env, chat, `Couldn’t link: ${escapeHtml(r.message)}`, '/settings', 'Open SHYST');
    return;
  }
  await sendTelegram(
    env,
    chat,
    `Linked. Telegram now signs you in as <b>${escapeHtml(r.user.display_name)}</b> (#${r.user.tag}) on SHYST.${r.reconciled ? `\nThe empty Telegram-only player #${r.reconciled.tag} was folded into this one.` : ''}`,
    '/',
    'Open SHYST',
  );
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
      `Hey ${name}. This is <b>SHYST</b> — sponsored elimination tournaments.\n\nTap below to open the app. Have an invite code? Send <code>/join CODE</code>.`,
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
