/**
 * Configures the Telegram bot for this deployment (run by CI after deploy,
 * or by hand). Needs: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL, API_URL.
 *
 *   - webhook  → ${API_URL}/api/telegram/webhook (with the secret header)
 *   - commands → /start, /join, /help
 *   - menu button → opens the web app as a Mini App
 *   - name and descriptions → SHYST
 */
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, APP_URL: app, API_URL: apiUrl } = process.env;
if (!token || !secret || !app || !apiUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL and API_URL.');
  process.exit(1);
}
const call = async (method, body, { tolerateRateLimit = false } = {}) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  console.log(`${method}: ${data.ok ? 'ok' : data.description}`);
  if (!data.ok && !(tolerateRateLimit && data.error_code === 429)) process.exitCode = 1;
  return data;
};
await call('setWebhook', { url: `${apiUrl}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Open the app' },
    { command: 'join', description: 'Open an invite: /join CODE' },
    { command: 'help', description: 'What this bot does' },
  ],
});
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: app } } });
// Telegram rate-limits bot profile edits; a 429 here must not block app deployment.
await call('setMyName', { name: 'SHYST' }, { tolerateRateLimit: true });
await call('setMyShortDescription', { short_description: 'SHYST: sponsored elimination tournaments.' });
await call('setMyDescription', { description: 'SHYST runs sponsored elimination tournaments. Join with an invite, survive the stage, take the stage. Tap Play to open SHYST.' });
